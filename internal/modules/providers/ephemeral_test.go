package providers

import (
	"gemini-web-to-api/internal/commons/configs"
	"go.uber.org/zap"
	"os"
	"testing"
)

func TestManagedCookieClientNeverWritesPlaintextAuthenticationCache(t *testing.T) {
	c := NewClient(&configs.Config{Gemini: configs.GeminiConfig{Secure1PSID: "private-account", Secure1PSIDTS: "private-timestamp", Ephemeral: true}}, zap.NewNop())
	defer c.Close()
	c.cacheDir = t.TempDir()
	if err := c.SaveCachedCookies(); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(c.cacheDir)
	if err != nil || len(files) != 0 {
		t.Fatal("managed account wrote authentication cache")
	}
	if _, err := c.LoadCachedCookies(); err == nil {
		t.Fatal("managed account loaded a shared cache")
	}
	if c.autoRefresh {
		t.Fatal("managed account started background refresh")
	}
}
