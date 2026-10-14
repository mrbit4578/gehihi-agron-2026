package handler

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVercelHandlerServesOriginalRewrittenPath(t *testing.T) {
	t.Setenv("VERCEL", "1")
	t.Setenv("GEMINI_COOKIES", "")
	t.Setenv("GEMINI_AUTH_USER", "")
	t.Setenv("UPSTREAM_BASE_URL", "")
	t.Setenv("API_KEY", "")
	for _, test := range []struct {
		path   string
		status int
		body   string
	}{
		{"/health", 200, `"status":"ok"`},
		{"/status", 200, `"serverless":true`},
		{"/openai/v1/models", 503, "API_KEY"},
	} {
		w := httptest.NewRecorder()
		Handler(w, httptest.NewRequest("GET", test.path, nil))
		if w.Code != test.status || !strings.Contains(w.Body.String(), test.body) {
			t.Errorf("%s returned %d %s", test.path, w.Code, w.Body.String())
		}
	}
}
