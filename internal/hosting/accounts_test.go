package hosting

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gemini-web-to-api/internal/modules/providers"
	"github.com/valyala/fasthttp"
	"go.uber.org/zap"
)

func accountFixture(t *testing.T, persistent bool) (*Runtime, func(string, string, any, string) (int, map[string]any, string)) {
	t.Helper()
	cfg := testConfig()
	if persistent {
		cfg.Server.AccountStorePath = filepath.Join(t.TempDir(), "vault.enc")
	}
	r, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	r.accounts.factory = func(secret accountSecret) (*accountBackend, error) {
		return &accountBackend{verify: func(context.Context) ([]string, error) {
			if strings.Contains(secret.Label, "invalid") {
				return nil, &providers.SessionInitializationError{Code: "session_login_required", Stage: "session"}
			}
			if strings.Contains(secret.Label, "no argon") {
				return []string{"gemini-3.8-flash"}, nil
			}
			return []string{"gemini-4-argon"}, nil
		}, serve: func(ctx *fasthttp.RequestCtx) {
			if secret.Label == "limited" {
				ctx.SetStatusCode(429)
				ctx.SetBodyString(`{"error":"limited"}`)
				return
			}
			if strings.Contains(string(ctx.Path()), "streamGenerateContent") {
				ctx.SetContentType("text/event-stream")
				ctx.SetBodyStreamWriter(func(w *bufio.Writer) {
					time.Sleep(20 * time.Millisecond)
					_, _ = w.WriteString("data: {\"model\":\"gemini-4-argon\"}\n\n")
				})
				return
			}
			ctx.SetContentType("application/json")
			_, _ = ctx.WriteString(`{"model":"gemini-4-argon","account":"` + secret.ID + `"}`)
		}, close: func() {}}, nil
	}
	call := func(method, path string, body any, key string) (int, map[string]any, string) {
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		res, err := r.App.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		_ = json.Unmarshal(raw, &result)
		if strings.Contains(string(raw), "private-cookie-") {
			t.Fatal("account API leaked Cookie")
		}
		return res.StatusCode, result, string(raw)
	}
	return r, call
}
func addAccount(t *testing.T, call func(string, string, any, string) (int, map[string]any, string), label string, activate bool) string {
	t.Helper()
	status, data, _ := call("POST", "/openai/v1/accounts", map[string]any{"label": label, "cookie": "__Secure-1PSID=private-cookie-" + label + "; __Secure-1PSIDTS=private-cookie-ts", "slot": "", "activate": activate}, "workspace-test-key")
	if status != 201 {
		t.Fatalf("account add status %d: %v", status, data)
	}
	return data["account"].(map[string]any)["id"].(string)
}
func TestAccountRoutesAuthenticateAndVerifyBeforeSelection(t *testing.T) {
	_, call := accountFixture(t, false)
	for _, method := range []string{"GET", "POST", "DELETE"} {
		status, _, _ := call(method, "/openai/v1/accounts", nil, "")
		if status != 401 {
			t.Fatalf("unauthenticated %s: %d", method, status)
		}
	}
	status, _, _ := call("POST", "/openai/v1/accounts", map[string]string{"label": "broken", "cookie": "not-a-cookie"}, "workspace-test-key")
	if status != 400 {
		t.Fatal("accepted invalid Cookie")
	}
	bad := addAccount(t, call, "invalid session", true)
	status, data, _ := call("GET", "/openai/v1/accounts", nil, "workspace-test-key")
	if status != 200 || data["active_id"] != "default" {
		t.Fatal("invalid session became active")
	}
	status, _, _ = call("POST", "/openai/v1/accounts/select", map[string]string{"id": bad}, "workspace-test-key")
	if status != 409 {
		t.Fatal("selected unverified session")
	}
	noArgon := addAccount(t, call, "no argon", true)
	status, _, _ = call("POST", "/openai/v1/accounts/select", map[string]string{"id": noArgon}, "workspace-test-key")
	if status != 409 {
		t.Fatal("selected account without Argon")
	}
	id := addAccount(t, call, "valid", true)
	_, data, _ = call("GET", "/openai/v1/accounts", nil, "workspace-test-key")
	if data["active_id"] != id {
		t.Fatal("verified account was not selected")
	}
	_, _, raw := call("POST", "/gemini/v1beta/models/gemini-4-argon:generateContent", map[string]any{"contents": []any{}}, "workspace-test-key")
	if !strings.Contains(raw, id) {
		t.Fatal("Gemini request did not reach selected account")
	}
	_, _, raw = call("POST", "/v1/chat/completions", map[string]any{}, "workspace-test-key")
	if !strings.Contains(raw, id) {
		t.Fatal("OpenAI alias did not reach selected account")
	}
	_, data, _ = call("GET", "/openai/v1/accounts", nil, "workspace-test-key")
	accounts := data["accounts"].([]any)
	current := accounts[len(accounts)-1].(map[string]any)
	if current["requests"] != float64(2) || current["credit"].(map[string]any)["remaining"] != nil {
		t.Fatal("incorrect metrics or fabricated credits")
	}
}
func TestAccountRotationPinsConversationsAndDoesNotReplayErrors(t *testing.T) {
	_, call := accountFixture(t, false)
	a := addAccount(t, call, "first", false)
	b := addAccount(t, call, "limited", false)
	status, _, _ := call("POST", "/openai/v1/accounts/rotation", map[string]bool{"enabled": true}, "workspace-test-key")
	if status != 200 {
		t.Fatal("rotation not enabled")
	}
	request := func(prompt string) map[string]any {
		return map[string]any{"messages": []any{map[string]string{"role": "user", "content": prompt}}}
	}
	_, _, raw := call("POST", "/openai/v1/chat/completions", request("conversation A"), "workspace-test-key")
	if !strings.Contains(raw, a) {
		t.Fatal("first account not used")
	}
	status, _, _ = call("POST", "/openai/v1/chat/completions", request("conversation B"), "workspace-test-key")
	if status != 429 {
		t.Fatal("failed request was replayed or hidden")
	}
	_, _, raw = call("POST", "/openai/v1/chat/completions", request("conversation A"), "workspace-test-key")
	if !strings.Contains(raw, a) {
		t.Fatal("conversation drifted")
	}
	status, _, _ = call("POST", "/openai/v1/chat/completions", request("conversation B"), "workspace-test-key")
	if status != 503 {
		t.Fatal("limited conversation silently moved to another account")
	}
	_, data, _ := call("GET", "/openai/v1/accounts", nil, "workspace-test-key")
	for _, value := range data["accounts"].([]any) {
		entry := value.(map[string]any)
		if entry["id"] == b && entry["requests"] != float64(1) {
			t.Fatal("request replayed")
		}
	}
}
func TestAccountVaultEncryptedRestoreAndDelete(t *testing.T) {
	r, call := accountFixture(t, true)
	id := addAccount(t, call, "persist", true)
	data, err := os.ReadFile(r.accounts.store)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("private-cookie")) || bytes.Contains(data, []byte("persist")) {
		t.Fatal("vault plaintext")
	}
	if _, err := openAccountVault("another-workspace-key", data); err == nil {
		t.Fatal("vault decrypted with wrong key")
	}
	tampered := append([]byte{}, data...)
	tampered[len(tampered)-1] ^= 1
	if _, err := openAccountVault(r.accounts.key, tampered); err == nil {
		t.Fatal("vault accepted tampering")
	}
	cfg := testConfig()
	cfg.Server.AccountStorePath = r.accounts.store
	restored, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if len(restored.accounts.entries) != 1 || restored.accounts.entries[0].secret.ID != id || restored.accounts.entries[0].status != "unverified" || restored.accounts.active != "default" {
		t.Fatal("unsafe or incomplete restore")
	}
	status, _, _ := call("DELETE", "/openai/v1/accounts/"+id, nil, "workspace-test-key")
	if status != 200 {
		t.Fatal("delete failed")
	}
	data, _ = os.ReadFile(r.accounts.store)
	plain, err := openAccountVault(r.accounts.key, data)
	if err != nil || string(plain) != "[]" {
		t.Fatal("deleted Cookie persisted")
	}
}
func TestAccountStreamMetricsIncludeCompleteResponse(t *testing.T) {
	_, call := accountFixture(t, false)
	addAccount(t, call, "stream", true)
	status, _, raw := call("POST", "/gemini/v1beta/models/gemini-4-argon:streamGenerateContent", map[string]any{}, "workspace-test-key")
	if status != 200 || !strings.Contains(raw, "data: ") {
		t.Fatal("stream response truncated")
	}
	_, data, _ := call("GET", "/openai/v1/accounts", nil, "workspace-test-key")
	entry := data["accounts"].([]any)[1].(map[string]any)
	if entry["last_latency_ms"].(float64) < 15 || entry["inflight"] != float64(0) {
		t.Fatal("latency excluded generation or in-flight count leaked")
	}
}
func TestConversationKeyIncludesOpeningUserAndKeepsToolTurnsPinned(t *testing.T) {
	one, _ := conversationKey([]byte(`{"contents":[{"role":"user","parts":[{"text":"first"}]}]}`))
	two, ok := conversationKey([]byte(`{"contents":[{"parts":[{"text":"first"}],"role":"user"},{"role":"model","parts":[{"functionCall":{"name":"read"}}]},{"role":"user","parts":[{"functionResponse":{"name":"read"}}]}]}`))
	if !ok || one != two {
		t.Fatal("tool turn changed account key")
	}
}
func TestConcurrentAccountSelectionAndRequest(t *testing.T) {
	r, call := accountFixture(t, false)
	id := addAccount(t, call, "concurrent", true)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _ = call("POST", "/openai/v1/chat/completions", map[string]string{}, "workspace-test-key")
		}()
	}
	wg.Wait()
	r.accounts.mu.Lock()
	a := r.accounts.find(id)
	count := a.requests
	flight := a.inflight
	r.accounts.mu.Unlock()
	if count != 8 || flight != 0 {
		t.Fatal("concurrent metrics lost")
	}
}
