package hosting

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
)

func TestGeminiGatewayBuffersActualJSONForStreamingSDK(t *testing.T) {
	const reply = "{\n\"modelVersion\":\"gemini-4-argon\",\n\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"Hello\\nworld\"},{\"functionCall\":{\"name\":\"read_file\",\"args\":{\"path\":\"README.md\"}}}]}}]}"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gemini/v1beta/models/gemini-4-argon:generateContent" || r.URL.Query().Get("alt") != "" {
			t.Error("streaming request was not translated to JSON generation")
		}
		if r.Header.Get("Authorization") != "Bearer backend-test-key" || r.Header.Get("Cookie") != "" || r.Header.Get("x-goog-api-key") != "" {
			t.Error("client credentials leaked to backend")
		}
		w.Header().Set("Set-Cookie", "upstream-private-cookie")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, reply)
	}))
	defer upstream.Close()
	cfg := testConfig()
	cfg.Server.UpstreamBaseURL = upstream.URL + "/openai/v1"
	cfg.Server.UpstreamGeminiBaseURL = upstream.URL + "/gemini/v1beta"
	cfg.Server.UpstreamAPIKey = "backend-test-key"
	runtime, err := New(cfg, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	req := httptest.NewRequest("POST", "/gemini/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse", strings.NewReader(`{"contents":[]}`))
	req.Header.Set("Authorization", "Bearer "+cfg.Server.APIKey)
	req.Header.Set("Cookie", "client-private-cookie")
	res, err := runtime.App.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") || res.Header.Get("Set-Cookie") != "" {
		t.Fatal("incorrect SSE gateway response")
	}
	payload := strings.TrimSuffix(strings.TrimPrefix(string(body), "data: "), "\n\n")
	var want, got any
	_ = json.Unmarshal([]byte(reply), &want)
	if json.Unmarshal([]byte(payload), &got) != nil {
		t.Fatal("SDK could not decode event")
	}
	wantJSON, _ := json.Marshal(want)
	gotJSON, _ := json.Marshal(got)
	if string(wantJSON) != string(gotJSON) {
		t.Fatal("model identity or tool response changed")
	}
}

func TestGeminiGatewayPreservesProviderFailure(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"error":{"message":"permission denied","code":403}}`)
	}))
	defer upstream.Close()
	cfg := testConfig()
	cfg.Server.UpstreamGeminiBaseURL = upstream.URL + "/v1beta"
	proxy, err := newGeminiGateway(cfg)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	proxy.ServeHTTP(recorder, httptest.NewRequest("POST", "/gemini/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse", strings.NewReader(`{}`)))
	if recorder.Code != 403 || strings.HasPrefix(recorder.Body.String(), "data:") || recorder.Header().Get("Content-Type") != "application/json" {
		t.Fatal("provider error was converted to successful streaming output")
	}
}

func TestGeminiGatewayRejectsUnsafeBackendURLs(t *testing.T) {
	for _, base := range []string{"http://example.com/v1beta", "https://user:secret@example.com/v1beta", "https://example.com/v1beta?key=secret", "https://example.com/v1beta#fragment"} {
		cfg := testConfig()
		cfg.Server.Serverless = true
		cfg.Server.UpstreamGeminiBaseURL = base
		if _, err := newGeminiGateway(cfg); err == nil {
			t.Fatal("unsafe Gemini backend URL accepted")
		}
	}
}
