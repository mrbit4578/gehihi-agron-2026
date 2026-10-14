package hosting

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"gemini-web-to-api/internal/commons/configs"
	"go.uber.org/zap"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testConfig() *configs.Config {
	return &configs.Config{Server: configs.ServerConfig{Port: "4981", APIKey: "workspace-test-key"}, AllowUnconfigured: true}
}

func TestConnectionCheckRequiresAuthenticationAndNeverReturnsCookie(t *testing.T) {
	cfg := testConfig()
	cfg.Gemini.Cookies = "private-session-cookie"
	cfg.Gemini.AuthUser = "2"
	runtime, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	for _, tc := range []struct {
		key, cookie string
		status      int
		match       bool
	}{
		{"", cfg.Gemini.Cookies, 401, false},
		{cfg.Server.APIKey, cfg.Gemini.Cookies, 200, true},
		{cfg.Server.APIKey, "different-session", 200, false},
	} {
		digest := fmt.Sprintf("%x", sha256.Sum256([]byte(tc.cookie)))
		req := httptest.NewRequest("POST", "/openai/v1/connection-check", strings.NewReader(`{"cookie_digest":"`+digest+`"}`))
		req.Header.Set("Authorization", "Bearer "+tc.key)
		res, err := runtime.App.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != tc.status || strings.Contains(string(body), cfg.Gemini.Cookies) || strings.Contains(string(body), digest) {
			t.Fatal("connection check leaked a credential or bypassed authentication")
		}
		if tc.status == 200 {
			var result struct {
				Match bool   `json:"cookie_matches"`
				Slot  string `json:"account_slot"`
			}
			if json.Unmarshal(body, &result) != nil || result.Match != tc.match || result.Slot != "2" {
				t.Fatal("incorrect configuration comparison")
			}
		}
	}
}

func TestPublicUIAndFailClosedAPI(t *testing.T) {
	cfg := testConfig()
	runtime, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	for _, test := range []struct {
		path, key string
		status    int
	}{
		{"/", "", 200}, {"/health", "", 200}, {"/status", "", 200},
		{"/openai/v1/models", "", 401}, {"/OPENAI/v1/models", "", 401},
		{"/v1/models", "wrong-key", 401}, {"/claude/v1/models", "", 401}, {"/gemini/v1beta/models", "", 401},
		{"/openai/v1/models", cfg.Server.APIKey, 503},
	} {
		req := httptest.NewRequest("GET", test.path, nil)
		if test.key != "" {
			req.Header.Set("Authorization", "Bearer "+test.key)
		}
		res, err := runtime.App.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != test.status {
			t.Errorf("%s status=%d want=%d body=%s", test.path, res.StatusCode, test.status, body)
		}
		if strings.Contains(string(body), cfg.Server.APIKey) {
			t.Errorf("%s leaks API key", test.path)
		}
		if test.path == "/" && !strings.Contains(res.Header.Get("Content-Security-Policy"), "script-src 'self'") {
			t.Error("UI missing CSP")
		}
	}
	cfg.Server.APIKey = ""
	res, err := runtime.App.Test(httptest.NewRequest("GET", "/v1/models", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 503 {
		t.Fatalf("missing API_KEY status=%d", res.StatusCode)
	}
}

func TestGatewayKeepsCredentialsServerSideAndModelTruthful(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected upstream path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer upstream-test-secret" {
			t.Error("missing upstream authentication")
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("x-api-key") != "" {
			t.Error("client credentials forwarded upstream")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "session=upstream-secret")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"actual-account-model"}]}`))
	}))
	defer upstream.Close()
	cfg := testConfig()
	cfg.Server.UpstreamBaseURL = upstream.URL + "/v1"
	cfg.Server.UpstreamAPIKey = "upstream-test-secret"
	runtime, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	for _, path := range []string{"/openai/v1/models", "/v1/models"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("x-api-key", cfg.Server.APIKey)
		req.Header.Set("Cookie", "browser-secret=private")
		res, err := runtime.App.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		var data struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		err = json.NewDecoder(res.Body).Decode(&data)
		res.Body.Close()
		if err != nil || res.StatusCode != 200 || len(data.Data) != 1 || data.Data[0].ID != "actual-account-model" {
			t.Fatalf("gateway response incorrect: status %d data %+v error %v", res.StatusCode, data, err)
		}
		if res.Header.Get("Set-Cookie") != "" {
			t.Fatal("upstream cookie leaked to browser")
		}
	}
}

func TestServerlessRejectsProcessLocalJobsBeforeCallingGoogle(t *testing.T) {
	cfg := testConfig()
	cfg.Server.Serverless = true
	cfg.Gemini.Cookies = "test"
	cfg.Gemini.Secure1PSID = "test"
	cfg.Gemini.Secure1PSIDTS = "test"
	runtime, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	for _, path := range []string{"/openai/v1/videos", "/openai/v1/audio/speech", "/gemini/v1beta/interactions", "/gemini/v1beta/models/test:predictLongRunning", "/gemini/v1beta/models/test-music:generateContent", "/gemini/v1beta/deepresearch"} {
		req := httptest.NewRequest("POST", path, strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+cfg.Server.APIKey)
		req.Header.Set("Content-Type", "application/json")
		res, err := runtime.App.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 501 {
			t.Errorf("%s status %d want 501", path, res.StatusCode)
		}
	}
	req := httptest.NewRequest("POST", "/openai/v1/chat/completions", strings.NewReader(`{"model":"gemini-pro-music","messages":[{"role":"user","content":"song"}]}`))
	req.Header.Set("Authorization", "Bearer "+cfg.Server.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := runtime.App.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 501 {
		t.Errorf("music suffix bypassed serverless guard: status %d", res.StatusCode)
	}
}

func TestGatewayRejectsInsecureOrCredentialBearingURL(t *testing.T) {
	for _, base := range []string{"http://example.com/v1", "https://user:password@example.com/v1", "https://example.com/v1?api_key=secret", "file:///etc/passwd", "http://localhost:1234/v1"} {
		cfg := testConfig()
		cfg.Server.UpstreamBaseURL = base
		cfg.Server.Serverless = true
		if _, err := newGateway(cfg); err == nil {
			t.Errorf("accepted invalid gateway %s", base)
		}
	}
}

func TestAuthenticatedRateLimit(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimit = configs.RateLimitConfig{Enabled: true, WindowMs: 60000, MaxRequests: 1}
	runtime, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	for i, want := range []int{503, 429} {
		req := httptest.NewRequest("GET", "/openai/v1/models", nil)
		req.Header.Set("Authorization", "Bearer "+cfg.Server.APIKey)
		res, err := runtime.App.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("request %d status %d want %d", i, res.StatusCode, want)
		}
	}
}
