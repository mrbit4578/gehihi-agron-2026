package hosting

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"gemini-web-to-api/internal/commons/configs"
	"gemini-web-to-api/internal/modules/claude"
	"gemini-web-to-api/internal/modules/gemini"
	"gemini-web-to-api/internal/modules/openai"
	"gemini-web-to-api/internal/modules/providers"
	"gemini-web-to-api/internal/server"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/adaptor"
	"go.uber.org/zap"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Runtime struct {
	App        *fiber.App
	Client     *providers.Client
	controller *gemini.GeminiController
}

func New(cfg *configs.Config, log *zap.Logger) (*Runtime, error) {
	app := server.NewGeminiWebToAPI(log, cfg)
	client := providers.NewClient(cfg, log)
	runtime := &Runtime{App: app, Client: client}
	server.RegisterWebRoutes(app, client, cfg)
	// Runs after workspace authentication and before provider initialization.
	// Compare an opaque digest without returning credentials or their digest.
	app.Post("/openai/v1/connection-check", func(c fiber.Ctx) error {
		var input struct {
			CookieDigest string `json:"cookie_digest"`
		}
		if json.Unmarshal(c.Body(), &input) != nil {
			return c.SendStatus(400)
		}
		provided, err := hex.DecodeString(input.CookieDigest)
		if err != nil || len(provided) != sha256.Size {
			return c.SendStatus(400)
		}
		expected := sha256.Sum256([]byte(strings.TrimSpace(cfg.Gemini.Cookies)))
		return c.JSON(fiber.Map{
			"cookie_matches": subtle.ConstantTimeCompare(expected[:], provided) == 1,
			"account_slot":   strings.TrimSpace(cfg.Gemini.AuthUser),
		})
	})
	if cfg.Server.UpstreamBaseURL != "" {
		proxy, err := newGateway(cfg)
		if err != nil {
			return nil, err
		}
		app.All("/openai/v1/*", adaptor.HTTPHandler(proxy))
		app.All("/v1/*", adaptor.HTTPHandler(proxy))
		if cfg.Server.UpstreamGeminiBaseURL != "" {
			geminiProxy, err := newGeminiGateway(cfg)
			if err != nil {
				return nil, err
			}
			app.All("/gemini/v1beta/*", adaptor.HTTPHandler(geminiProxy))
		}
	} else {
		var initMu sync.Mutex
		app.Use(func(c fiber.Ctx) error {
			if !server.IsAPIPath(c.Path()) {
				return c.Next()
			}
			if cfg.Gemini.Cookies == "" {
				return c.Status(503).JSON(fiber.Map{"error": fiber.Map{"message": "Server chưa cấu hình GEMINI_COOKIES.", "type": "configuration_error"}})
			}
			var requestModel struct {
				Model string `json:"model"`
			}
			if cfg.Server.Serverless {
				_ = json.Unmarshal(c.Body(), &requestModel)
			}
			if cfg.Server.Serverless && (unsupportedServerlessPath(c.Path()) || strings.HasSuffix(strings.ToLower(requestModel.Model), "-music") || strings.Contains(strings.ToLower(c.Path()), "-music:")) {
				return c.Status(501).JSON(fiber.Map{"error": fiber.Map{"message": "Tác vụ này cần backend Docker chạy liên tục; Vercel hỗ trợ chat và danh sách model.", "type": "unsupported_on_serverless"}})
			}
			if !initMu.TryLock() {
				c.Set("Retry-After", "2")
				return c.Status(503).JSON(fiber.Map{"error": fiber.Map{"message": "Provider đang khởi tạo. Vui lòng thử lại sau.", "type": "provider_initializing"}})
			}
			var initErr error
			if !client.IsHealthy() {
				ctx, cancel := context.WithTimeout(c.Context(), 90*time.Second)
				initErr = client.Init(ctx)
				cancel()
			}
			initMu.Unlock()
			if initErr != nil {
				code, upstreamStatus := providers.SafeInitializationDiagnostic(initErr)
				log.Warn("Provider initialization failed", zap.String("code", code), zap.Int("upstream_status", upstreamStatus))
				return c.Status(503).JSON(fiber.Map{"error": fiber.Map{"message": "Khóa workspace đã được chấp nhận, nhưng chưa khởi tạo được phiên Gemini. Kiểm tra trạng thái phiên và quyền tài khoản.", "type": "provider_unavailable", "code": code, "upstream_status": upstreamStatus, "account_status": providers.SafeAccountStatus(initErr)}})
			}
			return c.Next()
		})
		oc := openai.NewOpenAIController(openai.NewOpenAIService(client, log), log)
		oc.Register(app.Group("/openai/v1"))
		oc.Register(app.Group("/v1"))
		claude.NewClaudeController(claude.NewClaudeService(client, log), log).Register(app.Group("/claude/v1"))
		runtime.controller = gemini.NewGeminiController(gemini.NewGeminiService(client, log), log)
		runtime.controller.Register(app.Group("/gemini/v1beta"))
	}
	server.Register404Handler(app)
	return runtime, nil
}

func unsupportedServerlessPath(path string) bool {
	path = strings.ToLower(path)
	for _, part := range []string{"/videos", "/interactions", "/deepresearch", "/operations/", ":predictlongrunning", "/files/", "/audio/", "/images/"} {
		if strings.Contains(path, part) {
			return true
		}
	}
	return false
}

func (r *Runtime) Close() {
	if r.controller != nil {
		r.controller.Close()
	}
	_ = r.Client.Close()
}

// The operator supplies an authenticated OpenAI-compatible gateway.
// Configuring a URL does not create free model access or an Antigravity account.
func newGateway(cfg *configs.Config) (*httputil.ReverseProxy, error) {
	target, err := url.Parse(cfg.Server.UpstreamBaseURL)
	if err != nil || target.Hostname() == "" || target.User != nil || target.RawQuery != "" || target.Fragment != "" {
		return nil, errors.New("UPSTREAM_BASE_URL must be an absolute API base URL without credentials or query parameters")
	}
	if target.Scheme != "https" && !(target.Scheme == "http" && !cfg.Server.Serverless && (target.Hostname() == "localhost" || target.Hostname() == "127.0.0.1")) {
		return nil, errors.New("UPSTREAM_BASE_URL must use HTTPS; local development permits localhost HTTP")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 240 * time.Second
	proxy := &httputil.ReverseProxy{
		Rewrite: func(p *httputil.ProxyRequest) {
			path := strings.TrimPrefix(strings.TrimPrefix(p.In.URL.Path, "/openai"), "/v1")
			p.SetURL(target)
			p.Out.URL.Path = strings.TrimRight(target.Path, "/") + path
			p.Out.URL.RawPath = ""
			p.Out.Header = make(http.Header)
			p.Out.Header.Set("Content-Type", p.In.Header.Get("Content-Type"))
			p.Out.Header.Set("Accept", p.In.Header.Get("Accept"))
			if cfg.Server.UpstreamAPIKey != "" {
				p.Out.Header.Set("Authorization", "Bearer "+cfg.Server.UpstreamAPIKey)
			}
		},
		Transport: transport,
		ModifyResponse: func(r *http.Response) error {
			r.Header.Del("Set-Cookie")
			r.Header.Set("Cache-Control", "no-store")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(502)
			_, _ = w.Write([]byte(`{"error":{"message":"Gateway không phản hồi. Kiểm tra UPSTREAM_BASE_URL trên server.","type":"upstream_error"}}`))
		},
	}
	return proxy, nil
}
