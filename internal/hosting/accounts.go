package hosting

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"gemini-web-to-api/internal/commons/configs"
	"gemini-web-to-api/internal/modules/providers"
	"gemini-web-to-api/internal/server"
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/valyala/fasthttp"
	"go.uber.org/zap"
)

// Only accountSecret is persisted, encrypted; it is never used as an API response.
type accountSecret struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Cookie string `json:"cookie"`
	Slot   string `json:"slot"`
}
type accountBackend struct {
	verify func(context.Context) ([]string, error)
	serve  fasthttp.RequestHandler
	close  func()
}
type accountEntry struct {
	secret   accountSecret
	backend  *accountBackend
	status   string
	code     string
	models   []string
	checking bool
	inflight int
	requests int
	errors   int
	lastMS   int64
	totalMS  int64
	verifyMS int64
}
type accountManager struct {
	mu             sync.Mutex
	entries        []*accountEntry
	active         string
	rotation       bool
	conversations  map[[32]byte]string
	store          string
	key            string
	defaultClient  *providers.Client
	defaultMetrics accountEntry
	factory        func(accountSecret) (*accountBackend, error)
}

func newAccountManager(cfg *configs.Config, log *zap.Logger, client *providers.Client) (*accountManager, error) {
	m := &accountManager{active: "default", store: cfg.Server.AccountStorePath, key: cfg.Server.APIKey, defaultClient: client}
	m.factory = func(secret accountSecret) (*accountBackend, error) {
		copyCfg := *cfg
		copyCfg.Gemini = cfg.Gemini
		copyCfg.Gemini.BrowserRelayURL = ""
		copyCfg.Gemini.Cookies, copyCfg.Gemini.AuthUser = secret.Cookie, secret.Slot
		copyCfg.Gemini.Secure1PSID = accountCookieValue(secret.Cookie, "__Secure-1PSID")
		copyCfg.Gemini.Secure1PSIDTS = accountCookieValue(secret.Cookie, "__Secure-1PSIDTS")
		copyCfg.Gemini.Ephemeral = true
		copyCfg.RateLimit.Enabled = false // outer app already authenticates and rate limits
		runtime, err := newRuntime(&copyCfg, log, false)
		if err != nil {
			return nil, err
		}
		return &accountBackend{
			verify: func(ctx context.Context) ([]string, error) {
				if err := runtime.Client.Init(ctx); err != nil {
					return nil, err
				}
				models := runtime.Client.ListModelsIDs()
				if containsModel(models, "gemini-4-argon") {
					if _, err := runtime.Client.GenerateContent(ctx, "Chỉ trả lời một từ: OK.", providers.WithModel("gemini-4-argon")); err != nil {
						return models, err
					}
				}
				return models, nil
			}, serve: runtime.App.Handler(), close: runtime.Close,
		}, nil
	}
	if m.store != "" {
		data, err := os.ReadFile(m.store)
		if err != nil && !os.IsNotExist(err) {
			return nil, errors.New("cannot read account vault")
		}
		if err == nil {
			plain, err := openAccountVault(m.key, data)
			if err != nil {
				return nil, errors.New("cannot decrypt account vault; restore the original workspace API_KEY")
			}
			var records []accountSecret
			if json.Unmarshal(plain, &records) != nil || len(records) > 12 {
				return nil, errors.New("invalid account vault")
			}
			for _, record := range records {
				if !validAccountSecret(record) {
					m.close()
					return nil, errors.New("invalid account vault entry")
				}
				backend, err := m.factory(record)
				if err != nil {
					m.close()
					return nil, errors.New("cannot restore account backend")
				}
				m.entries = append(m.entries, &accountEntry{secret: record, backend: backend, status: "unverified"})
			}
		}
	}
	return m, nil
}

func accountCookieValue(cookie, name string) string {
	for _, item := range strings.Split(cookie, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(item), "=")
		if ok && key == name {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func validAccountSecret(a accountSecret) bool {
	_, err := uuid.Parse(a.ID)
	if err != nil || len(a.Label) < 1 || len(a.Label) > 80 || len(a.Cookie) > 65536 || strings.ContainsAny(a.Cookie, "\r\n") {
		return false
	}
	if a.Slot != "" {
		n, err := strconv.Atoi(a.Slot)
		if err != nil || n < 0 || n > 99 {
			return false
		}
	}
	return accountCookieValue(a.Cookie, "__Secure-1PSID") != "" && accountCookieValue(a.Cookie, "__Secure-1PSIDTS") != ""
}
func vaultCipher(key string) (cipher.AEAD, error) {
	if len(key) < 16 {
		return nil, errors.New("workspace key too short for account vault")
	}
	digest := sha256.Sum256([]byte("gehihi/account-vault/v1\x00" + key))
	block, err := aes.NewCipher(digest[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func sealAccountVault(key string, plain []byte) ([]byte, error) {
	aead, err := vaultCipher(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, plain, []byte("gehihi-accounts-v1")), nil
}
func openAccountVault(key string, data []byte) ([]byte, error) {
	aead, err := vaultCipher(key)
	if err != nil {
		return nil, err
	}
	if len(data) < aead.NonceSize() {
		return nil, errors.New("invalid vault")
	}
	return aead.Open(nil, data[:aead.NonceSize()], data[aead.NonceSize():], []byte("gehihi-accounts-v1"))
}

// Caller holds the mutex. A failed durable write never publishes a new account set.
func (m *accountManager) save(entries []*accountEntry) error {
	if m.store == "" {
		return nil
	}
	records := make([]accountSecret, 0, len(entries))
	for _, a := range entries {
		records = append(records, a.secret)
	}
	plain, err := json.Marshal(records)
	if err != nil {
		return err
	}
	data, err := sealAccountVault(m.key, plain)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(m.store), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(m.store), ".vault-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, m.store)
}
func (m *accountManager) find(id string) *accountEntry {
	for _, a := range m.entries {
		if a.secret.ID == id {
			return a
		}
	}
	return nil
}
func containsModel(models []string, id string) bool {
	for _, model := range models {
		if model == id {
			return true
		}
	}
	return false
}
func (m *accountManager) verify(ctx context.Context, a *accountEntry) {
	start := time.Now()
	models, err := a.backend.verify(ctx)
	m.mu.Lock()
	defer m.mu.Unlock()
	a.checking = false
	a.verifyMS = time.Since(start).Milliseconds()
	a.models = models
	a.code = ""
	if err != nil {
		a.status = "invalid"
		a.code, _ = providers.SafeInitializationDiagnostic(err)
		if len(models) > 0 {
			a.code = "account_generation_probe_failed"
		}
		return
	}
	if !containsModel(models, "gemini-4-argon") {
		a.status = "no_argon"
		a.code = "model_not_available"
		return
	}
	a.status = "ready"
}
func accountSummary(a *accountEntry) fiber.Map {
	var average any
	var last any
	if a.requests > 0 {
		average = a.totalMS / int64(a.requests)
		last = a.lastMS
	}
	return fiber.Map{"id": a.secret.ID, "label": a.secret.Label, "slot": a.secret.Slot, "source": "cookie", "status": a.status, "code": a.code, "models": a.models,
		"inflight": a.inflight, "requests": a.requests, "errors": a.errors, "last_latency_ms": last, "average_latency_ms": average, "verification_ms": a.verifyMS,
		"credit": fiber.Map{"available": false, "remaining": nil, "reason": "Backend chưa có nguồn số dư credit đã xác minh từ Google."}}
}
func accountError(c fiber.Ctx, status int, message string) error {
	return c.Status(status).JSON(fiber.Map{"error": fiber.Map{"type": "account_management_error", "message": message}})
}

func (m *accountManager) register(app *fiber.App) {
	const base = "/openai/v1/accounts"
	app.Get(base, func(c fiber.Ctx) error {
		m.mu.Lock()
		defer m.mu.Unlock()
		status := "unverified"
		if m.defaultClient.IsHealthy() {
			status = "ready"
		}
		first := accountSummary(&m.defaultMetrics)
		first["id"] = "default"
		first["label"] = "Phiên mặc định trên máy"
		first["source"] = "configured"
		first["status"] = status
		first["models"] = m.defaultClient.ListModelsIDs()
		items := []fiber.Map{first}
		for _, a := range m.entries {
			items = append(items, accountSummary(a))
		}
		return c.JSON(fiber.Map{"accounts": items, "active_id": m.active, "rotation": m.rotation, "persistent": m.store != "", "rotation_policy": "round_robin_conversation_no_replay"})
	})
	app.Post(base, func(c fiber.Ctx) error {
		var input struct {
			Label    string `json:"label"`
			Cookie   string `json:"cookie"`
			Slot     string `json:"slot"`
			Activate bool   `json:"activate"`
		}
		if len(c.Body()) > 70000 || json.Unmarshal(c.Body(), &input) != nil {
			return accountError(c, 400, "Dữ liệu tài khoản không hợp lệ.")
		}
		record := accountSecret{ID: uuid.NewString(), Label: strings.TrimSpace(input.Label), Cookie: strings.TrimSpace(input.Cookie), Slot: strings.TrimSpace(input.Slot)}
		if !validAccountSecret(record) {
			return accountError(c, 400, "Nhập tên, Cookie header đầy đủ gồm __Secure-1PSID và __Secure-1PSIDTS, slot từ 0 đến 99 hoặc để trống.")
		}
		m.mu.Lock()
		if len(m.entries) >= 12 {
			m.mu.Unlock()
			return accountError(c, 409, "Tối đa 12 tài khoản đã lưu.")
		}
		for _, a := range m.entries {
			if accountCookieValue(a.secret.Cookie, "__Secure-1PSID") == accountCookieValue(record.Cookie, "__Secure-1PSID") && a.secret.Slot == record.Slot {
				m.mu.Unlock()
				return accountError(c, 409, "Phiên này đã được thêm. Xóa bản cũ trước khi nhập Cookie thay thế.")
			}
		}
		backend, err := m.factory(record)
		if err != nil {
			m.mu.Unlock()
			return accountError(c, 500, "Không tạo được phiên tài khoản.")
		}
		a := &accountEntry{secret: record, backend: backend, status: "checking", checking: true}
		next := append(append([]*accountEntry{}, m.entries...), a)
		if err = m.save(next); err != nil {
			m.mu.Unlock()
			backend.close()
			return accountError(c, 500, "Không lưu được kho tài khoản mã hóa.")
		}
		m.entries = next
		m.mu.Unlock()
		ctx, cancel := context.WithTimeout(c.Context(), 90*time.Second)
		defer cancel()
		m.verify(ctx, a)
		m.mu.Lock()
		defer m.mu.Unlock()
		if input.Activate && a.status == "ready" {
			m.active = a.secret.ID
			m.rotation = false
			m.conversations = nil
		}
		return c.Status(201).JSON(fiber.Map{"account": accountSummary(a), "activated": m.active == a.secret.ID})
	})
	app.Post(base+"/select", func(c fiber.Ctx) error {
		var input struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(c.Body(), &input) != nil {
			return accountError(c, 400, "Chọn tài khoản hợp lệ.")
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		if input.ID != "default" {
			a := m.find(input.ID)
			if a == nil {
				return accountError(c, 404, "Không tìm thấy tài khoản.")
			}
			if a.status != "ready" || a.checking {
				return accountError(c, 409, "Kiểm tra lại phiên và quyền Argon trước khi chọn.")
			}
		}
		m.active = input.ID
		m.rotation = false
		m.conversations = nil
		return c.JSON(fiber.Map{"active_id": m.active, "rotation": false})
	})
	app.Post(base+"/rotation", func(c fiber.Ctx) error {
		var input struct {
			Enabled bool `json:"enabled"`
		}
		if json.Unmarshal(c.Body(), &input) != nil {
			return accountError(c, 400, "Chế độ xoay không hợp lệ.")
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		if input.Enabled {
			ready := 0
			for _, a := range m.entries {
				if a.status == "ready" {
					ready++
				}
			}
			if ready < 2 {
				return accountError(c, 409, "Cần ít nhất hai tài khoản Cookie đã xác minh quyền Argon để xoay tự động.")
			}
		}
		m.rotation = input.Enabled
		m.conversations = nil
		return c.JSON(fiber.Map{"rotation": m.rotation})
	})
	app.Post(base+"/:id/verify", func(c fiber.Ctx) error {
		m.mu.Lock()
		a := m.find(c.Params("id"))
		if a == nil {
			m.mu.Unlock()
			return accountError(c, 404, "Không tìm thấy tài khoản.")
		}
		if a.checking || a.inflight > 0 {
			m.mu.Unlock()
			return accountError(c, 409, "Chờ request đang chạy hoàn tất.")
		}
		a.checking = true
		a.status = "checking"
		m.mu.Unlock()
		ctx, cancel := context.WithTimeout(c.Context(), 90*time.Second)
		defer cancel()
		m.verify(ctx, a)
		m.mu.Lock()
		defer m.mu.Unlock()
		return c.JSON(fiber.Map{"account": accountSummary(a)})
	})
	app.Delete(base+"/:id", func(c fiber.Ctx) error {
		m.mu.Lock()
		defer m.mu.Unlock()
		a := m.find(c.Params("id"))
		if a == nil {
			return accountError(c, 404, "Không tìm thấy tài khoản.")
		}
		if a.inflight > 0 || a.checking {
			return accountError(c, 409, "Chờ request đang chạy hoàn tất trước khi xóa.")
		}
		next := []*accountEntry{}
		for _, entry := range m.entries {
			if entry != a {
				next = append(next, entry)
			}
		}
		if err := m.save(next); err != nil {
			return accountError(c, 500, "Không cập nhật được kho tài khoản.")
		}
		m.entries = next
		if m.active == a.secret.ID {
			m.active = "default"
		}
		m.rotation = false
		m.conversations = nil
		a.backend.close()
		return c.JSON(fiber.Map{"deleted": true})
	})
	app.Use(m.dispatch)
}

func isGeneration(path, method string) bool {
	if method != "POST" {
		return false
	}
	return strings.HasSuffix(path, "/chat/completions") || strings.HasSuffix(path, "/messages") || strings.HasSuffix(path, ":generateContent") || strings.HasSuffix(path, ":streamGenerateContent")
}

// Gemini/OpenAI clients send the full history. Pin its opening user message so
// concurrent tool turns cannot drift to another Google account. Only a hash is kept.
func conversationKey(body []byte) ([32]byte, bool) {
	var input map[string]json.RawMessage
	if json.Unmarshal(body, &input) != nil {
		return [32]byte{}, false
	}
	for _, field := range []string{"messages", "contents"} {
		var messages []map[string]json.RawMessage
		if json.Unmarshal(input[field], &messages) != nil {
			continue
		}
		for _, message := range messages {
			var role string
			_ = json.Unmarshal(message["role"], &role)
			if role == "user" {
				canonical, _ := json.Marshal(message)
				return sha256.Sum256(canonical), true
			}
		}
	}
	return [32]byte{}, false
}
func (m *accountManager) dispatch(c fiber.Ctx) error {
	if !server.IsAPIPath(c.Path()) {
		return c.Next()
	}
	generation := isGeneration(c.Path(), c.Method())
	m.mu.Lock()
	if m.rotation && generation {
		key, ok := conversationKey(c.Body())
		if !ok {
			m.mu.Unlock()
			return accountError(c, 409, "Xoay tài khoản cần lịch sử có tin nhắn user đầu tiên để giữ nguyên tài khoản trong các lượt gọi công cụ.")
		}
		if pinned, exists := m.conversations[key]; exists {
			m.active = pinned
		} else {
			ready := []*accountEntry{}
			index := -1
			for _, a := range m.entries {
				if a.status == "ready" && !a.checking {
					if a.secret.ID == m.active {
						index = len(ready)
					}
					ready = append(ready, a)
				}
			}
			if len(ready) == 0 {
				m.mu.Unlock()
				return accountError(c, 503, "Không còn tài khoản đã xác minh sẵn sàng. Kiểm tra lại phiên.")
			}
			if len(m.conversations) >= 512 {
				m.mu.Unlock()
				return accountError(c, 409, "Đã đạt 512 cuộc trò chuyện được ghim. Tắt và bật lại xoay để bắt đầu phiên quản lý mới.")
			}
			m.active = ready[(index+1)%len(ready)].secret.ID
			if m.conversations == nil {
				m.conversations = make(map[[32]byte]string)
			}
			m.conversations[key] = m.active
		}
	}
	a := m.find(m.active)
	if m.active != "default" && (a == nil || a.status != "ready" || a.checking) {
		m.mu.Unlock()
		return accountError(c, 503, "Tài khoản đã chọn chưa sẵn sàng. Kiểm tra phiên hoặc chọn tài khoản khác.")
	}
	if a == nil {
		a = &m.defaultMetrics
	}
	if generation {
		a.inflight++
	}
	id := m.active
	var handler fasthttp.RequestHandler
	if a.backend != nil {
		handler = a.backend.serve
	}
	m.mu.Unlock()
	start := time.Now()
	var err error
	if handler == nil {
		err = c.Next()
	} else {
		handler(c.RequestCtx())
	}
	c.Set("X-Gehihi-Account", id)
	if generation {
		// This backend already buffers Google replies. Preserve SSE bytes while
		// waiting for its writer to finish so latency includes generation time.
		if c.Response().IsBodyStream() {
			body, readErr := io.ReadAll(io.LimitReader(c.Response().BodyStream(), (64<<20)+1))
			if readErr != nil || len(body) > 64<<20 {
				c.Response().SetStatusCode(502)
				c.Response().Header.SetContentType("application/json")
				c.Response().SetBodyString(`{"error":{"message":"Không đọc được phản hồi đầy đủ từ backend."}}`)
			} else {
				c.Response().SetBody(body)
			}
		}
		status := c.Response().StatusCode()
		m.mu.Lock()
		a.inflight--
		a.requests++
		a.lastMS = time.Since(start).Milliseconds()
		a.totalMS += a.lastMS
		if status >= 400 {
			a.errors++
		}
		if status == 429 {
			a.status = "limited"
			a.code = "google_rate_limited"
		}
		if a.backend != nil && (status == 401 || status == 403 || status == 503) {
			a.status = "invalid"
			a.code = "account_request_failed"
		}
		m.mu.Unlock()
	}
	return err
}

func (m *accountManager) close() {
	for _, a := range m.entries {
		a.backend.close()
	}
}
