package configs

import (
	"strings"
	"testing"
)

func TestCookieValueExtractsAuthFromFullHeader(t *testing.T) {
	header := "NID=rollout; __Secure-1PSID=account=value; __Secure-1PSIDTS=timestamp; SIDCC=flags"
	if got := cookieValue(header, "__Secure-1PSID"); got != "account=value" {
		t.Fatalf("1PSID = %q", got)
	}
	if got := cookieValue(header, "__Secure-1PSIDTS"); got != "timestamp" {
		t.Fatalf("1PSIDTS = %q", got)
	}
}

func TestNewRejectsInvalidGeminiAuthUser(t *testing.T) {
	t.Setenv("GEMINI_COOKIES", "__Secure-1PSID=psid; __Secure-1PSIDTS=psidts")
	t.Setenv("GEMINI_AUTH_USER", "account-two")
	if _, err := New(); err == nil || !strings.Contains(err.Error(), "GEMINI_AUTH_USER") {
		t.Fatalf("expected invalid account slot error, got %v", err)
	}
}

func TestNewRequiresCompleteGeminiCookiesHeader(t *testing.T) {
	t.Setenv("GEMINI_COOKIES", "")
	// Legacy variables must not create a second authentication path.
	t.Setenv("GEMINI_1PSID", "legacy-psid")
	t.Setenv("GEMINI_1PSIDTS", "legacy-psidts")
	if _, err := New(); err == nil || !strings.Contains(err.Error(), "GEMINI_COOKIES") {
		t.Fatalf("expected GEMINI_COOKIES requirement, got %v", err)
	}

	t.Setenv("GEMINI_COOKIES", "NID=rollout; __Secure-1PSID=psid")
	if _, err := New(); err == nil || !strings.Contains(err.Error(), "__Secure-1PSIDTS") {
		t.Fatalf("expected incomplete Cookie header error, got %v", err)
	}
}

func TestNewDerivesAuthenticationFromGeminiCookies(t *testing.T) {
	t.Setenv("GEMINI_COOKIES", "NID=rollout; __Secure-1PSID=psid; __Secure-1PSIDTS=psidts")
	t.Setenv("GEMINI_AUTH_USER", "2")
	cfg, err := New()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Gemini.Secure1PSID != "psid" || cfg.Gemini.Secure1PSIDTS != "psidts" || cfg.Gemini.AuthUser != "2" {
		t.Fatalf("incorrect Gemini config derived from full Cookie header: %#v", cfg.Gemini)
	}
}

func TestBrowserRelayConfigurationRequiresLocalAuthenticatedBackend(t *testing.T) {
	valid := func() Config {
		return Config{Server: ServerConfig{APIKey: "test-browser-workspace-key", BindHost: "127.0.0.1"}, Gemini: GeminiConfig{BrowserRelayURL: "http://127.0.0.1:54985"}}
	}
	cfg := valid()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("browser mode should not require exported cookies: %v", err)
	}
	for _, target := range []string{"https://example.com", "http://localhost:54985", "http://user:pass@127.0.0.1:54985", "http://127.0.0.1:54985/path", "http://127.0.0.1:54985?key=x"} {
		cfg := valid()
		cfg.Gemini.BrowserRelayURL = target
		if cfg.Validate() == nil {
			t.Fatalf("accepted non-local or non-base relay URL: %s", target)
		}
	}
	cfg = valid()
	cfg.Server.Serverless = true
	if cfg.Validate() == nil {
		t.Fatal("accepted loopback relay on Vercel")
	}
	cfg = valid()
	cfg.Server.APIKey = ""
	if cfg.Validate() == nil {
		t.Fatal("accepted unauthenticated relay")
	}
}
