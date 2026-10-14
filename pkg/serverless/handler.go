// Package serverless exposes the HTTP entrypoint without requiring Vercel's
// generated handler/api package to import this module's internal packages.
package serverless

import (
	"net/http"
	"sync"

	"gemini-web-to-api/internal/commons/configs"
	"gemini-web-to-api/internal/hosting"
	"gemini-web-to-api/pkg/logger"
	"github.com/gofiber/fiber/v3/middleware/adaptor"
)

var once sync.Once
var handler http.HandlerFunc

func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(func() {
		cfg, err := configs.NewForHosting()
		if err != nil {
			return
		}
		log, err := logger.New(cfg.LogLevel)
		if err != nil {
			return
		}
		app, err := hosting.New(cfg, log)
		if err != nil {
			log.Error("Invalid hosting configuration")
			return
		}
		handler = adaptor.FiberApp(app.App)
	})
	if handler == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(503)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid server configuration. Check deployment environment variables."}}`))
		return
	}
	handler(w, r)
}
