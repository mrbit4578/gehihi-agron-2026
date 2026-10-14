package server

import (
	"embed"
	"gemini-web-to-api/internal/commons/configs"
	"gemini-web-to-api/internal/modules/providers"
	"github.com/gofiber/fiber/v3"
	"mime"
	"path"
)

//go:embed static/web/*
var webFiles embed.FS

func RegisterWebRoutes(app *fiber.App, client *providers.Client, cfg *configs.Config) {
	for _, filename := range []string{"index.html", "styles.css", "app.js", "favicon.svg"} {
		name := filename
		route := "/" + name
		if name == "index.html" {
			route = "/"
		}
		app.Get(route, func(c fiber.Ctx) error {
			body, err := webFiles.ReadFile("static/web/" + name)
			if err != nil {
				return fiber.ErrNotFound
			}
			c.Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
			c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
			return c.Send(body)
		})
	}
	app.Get("/status", func(c fiber.Ctx) error {
		c.Set("Cache-Control", "no-store")
		provider := "gemini-web"
		configured := cfg.Gemini.Cookies != ""
		if cfg.Server.UpstreamBaseURL != "" {
			provider = "openai-compatible"
			configured = true
		}
		return c.JSON(fiber.Map{
			"service": "gehihi-agron-2026", "provider": provider,
			"api_key_configured": cfg.Server.APIKey != "", "provider_configured": configured,
			"provider_ready": client.IsHealthy(), "serverless": cfg.Server.Serverless,
			"requested_model": "gemini-4-argon", "model_access": "verified_after_connection",
		})
	})
}
