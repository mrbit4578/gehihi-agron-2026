package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gemini-web-to-api/internal/commons/configs"
	"go.uber.org/zap"
)

func TestBrowserRelayUsesPairedSessionWithoutForwardingCookies(t *testing.T) {
	const workspaceKey = "browser-relay-test-workspace-key"
	const staleCookie = "private-cookie-that-must-stay-local"
	calls := 0
	var relay *httptest.Server
	relay = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer "+workspaceKey {
			t.Fatal("missing relay authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/state" {
			_, _ = io.WriteString(w, `{"connected":true,"account_slot":"2"}`)
			return
		}
		var input struct {
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
			Body    string            `json:"body"`
		}
		data, _ := io.ReadAll(r.Body)
		if strings.Contains(string(data), staleCookie) || strings.Contains(string(data), workspaceKey) {
			t.Fatal("credential entered browser job")
		}
		if json.Unmarshal(data, &input) != nil {
			t.Fatal("invalid browser request")
		}
		var body string
		if strings.Contains(input.URL, "/u/2/app") {
			body = `{"SNlM0e":"synthetic-session-token","cfb2h":"test-build","FdrFJe":"test-session"}`
		} else if strings.Contains(input.URL, "rpcids=otAQ7b") {
			body = modelRPCFixture(t, nil, []any{8}, nil, modelRPCEntry("synthetic-argon-id", "Pro", "4 Argon", 3))
		} else {
			t.Fatal("unexpected browser endpoint")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": 200, "body": body, "content_type": "text/html"})
	}))
	defer relay.Close()
	cfg := &configs.Config{Server: configs.ServerConfig{APIKey: workspaceKey}, Gemini: configs.GeminiConfig{BrowserRelayURL: relay.URL, Cookies: staleCookie}}
	client := NewClient(cfg, zap.NewNop())
	defer client.Close()
	if err := client.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	models := client.ListModelsIDs()
	if len(models) != 1 || models[0] != "gemini-4-argon" || client.authUser != "2" || client.cookieHeader != "" || calls != 3 {
		t.Fatal("browser account/model metadata was not preserved")
	}
}

func TestBrowserRelayFailsClosedWhenBrowserIsOffline(t *testing.T) {
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/state" {
			t.Fatal("offline browser received provider request")
		}
		_, _ = io.WriteString(w, `{"connected":false,"account_slot":""}`)
	}))
	defer relay.Close()
	client := NewClient(&configs.Config{Server: configs.ServerConfig{APIKey: "test-relay-workspace-key"}, Gemini: configs.GeminiConfig{BrowserRelayURL: relay.URL}}, zap.NewNop())
	defer client.Close()
	err := client.Init(context.Background())
	code, _ := SafeInitializationDiagnostic(err)
	if err == nil || code != "browser_bridge_offline" || client.IsHealthy() {
		t.Fatal("offline browser was treated as ready")
	}
}

func TestBrowserRelayTransportPreservesHTTPFailureAndBlocksOtherHosts(t *testing.T) {
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"status":403,"body":"provider denied","content_type":"text/plain"}`)
	}))
	defer relay.Close()
	transport := &browserRelayTransport{baseURL: relay.URL, key: "test-relay-workspace-key"}
	request, _ := http.NewRequest("GET", "https://gemini.google.com/app", nil)
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("provider error became success")
	}
	request, _ = http.NewRequest("GET", "https://outside.example/app", nil)
	if _, err := transport.RoundTrip(request); err == nil {
		t.Fatal("browser transport accepted external host")
	}
}
