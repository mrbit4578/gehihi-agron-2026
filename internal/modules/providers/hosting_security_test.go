package providers

import (
	"errors"
	"gemini-web-to-api/internal/commons/configs"
	"go.uber.org/zap"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerlessCookieCacheAndLifecycle(t *testing.T) {
	cfg := &configs.Config{Server: configs.ServerConfig{Serverless: true}, Gemini: configs.GeminiConfig{Secure1PSID: "dummy", Secure1PSIDTS: "dummy-timestamp"}}
	c := NewClient(cfg, zap.NewNop())
	if c.autoRefresh {
		t.Fatal("serverless client starts background refresh")
	}
	if !strings.HasPrefix(c.cookieCacheDir(), os.TempDir()) {
		t.Fatal("serverless cache is outside writable temporary directory")
	}
	c.cacheDir = t.TempDir()
	if err := c.SaveCachedCookies(); err != nil {
		t.Fatal(err)
	}
	value, err := c.LoadCachedCookies()
	if err != nil || value != "dummy-timestamp" {
		t.Fatalf("cookie cache roundtrip %q %v", value, err)
	}
	files, err := filepath.Glob(filepath.Join(c.cacheDir, "*.txt"))
	if err != nil || len(files) != 1 {
		t.Fatalf("cache files %v error %v", files, err)
	}
	if err := c.ClearCookieCache(); err != nil {
		t.Fatal(err)
	}
	_ = c.Close()
	_ = c.Close()
}

func TestTransportErrorsDoNotExposeSessionTokens(t *testing.T) {
	inner := errors.New("network timeout")
	err := safeTransportError(&url.Error{Op: "Post", URL: "https://gemini.google.com/generate?at=private-session-token", Err: inner})
	if strings.Contains(err.Error(), "private-session-token") || !errors.Is(err, inner) {
		t.Fatalf("unsafe transport error %v", err)
	}
}
