package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"strings"
	"time"

	"gemini-web-to-api/internal/commons/configs"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/limiter"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"go.uber.org/fx"
	"go.uber.org/zap"
)

// New creates a new Fiber app instance
func NewGeminiWebToAPI(log *zap.Logger, cfg *configs.Config) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:   "Gehihi · Gemini Gateway",
		BodyLimit: 4 << 20,
	})

	if len(cfg.Server.AllowedOrigins) > 0 {
		app.Use(cors.New(cors.Config{
			AllowOrigins:     cfg.Server.AllowedOrigins,
			AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With", "x-api-key", "anthropic-version"},
			AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
			AllowCredentials: false,
		}))
	}

	app.Use(recover.New())
	app.Use(func(c fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("Referrer-Policy", "no-referrer")
		c.Set("X-Frame-Options", "DENY")
		if IsAPIPath(c.Path()) {
			c.Set("Cache-Control", "no-store")
			if cfg.Server.APIKey == "" {
				return c.Status(503).JSON(fiber.Map{"error": fiber.Map{"message": "Server chưa cấu hình API_KEY.", "type": "configuration_error"}})
			}
			key := c.Get("x-api-key")
			if auth := c.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
				key = strings.TrimPrefix(auth, "Bearer ")
			}
			if key == "" {
				key = c.Get("x-goog-api-key")
			}
			expected, provided := sha256.Sum256([]byte(cfg.Server.APIKey)), sha256.Sum256([]byte(key))
			if key == "" || subtle.ConstantTimeCompare(expected[:], provided[:]) != 1 {
				return c.Status(401).JSON(fiber.Map{"error": fiber.Map{"message": "Khóa truy cập không hợp lệ.", "type": "authentication_error"}})
			}
		}
		return c.Next()
	})

	if cfg.RateLimit.Enabled {
		app.Use(limiter.New(limiter.Config{
			Max:          cfg.RateLimit.MaxRequests,
			Expiration:   time.Duration(cfg.RateLimit.WindowMs) * time.Millisecond,
			Next:         func(c fiber.Ctx) bool { return !IsAPIPath(c.Path()) },
			KeyGenerator: func(c fiber.Ctx) string { return "gateway" },
			LimitReached: func(c fiber.Ctx) error {
				c.Set("Retry-After", "60")
				return c.Status(429).JSON(fiber.Map{"error": fiber.Map{"message": "Đã đạt giới hạn yêu cầu. Vui lòng thử lại sau.", "type": "rate_limit_error"}})
			},
		}))
	}

	app.Get("/docs", ScalarUI)
	app.Get("/openapi.json", OpenAPISpec)

	app.Get("/health", HealthCheck)

	return app
}

func HealthCheck(c fiber.Ctx) error {
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "ok",
		"service": "gemini-web-to-api",
	})
}

func IsAPIPath(path string) bool {
	path = strings.ToLower(path)
	for _, prefix := range []string{"/openai", "/claude", "/gemini", "/v1"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// Register404Handler registers the 404 handler for unmatched routes
// This must be called AFTER all other routes are registered
func Register404Handler(app *fiber.App) {
	app.All("*", func(c fiber.Ctx) error {
		method := c.Method()
		path := c.Path()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"status":  fiber.StatusNotFound,
			"error":   "Not Found",
			"message": fmt.Sprintf("Cannot %s %s", method, path),
		})
	})
}

// RegisterFiberLifecycle registers the Fiber app lifecycle hooks
func RegisterFiberLifecycle(lc fx.Lifecycle, app *fiber.App, cfg *configs.Config, log *zap.Logger) {
	port := cfg.Server.Port
	address := fmt.Sprintf(":%s", port)

	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			Register404Handler(app)
			log.Info("Starting server", zap.String("address", address))
			// Start server in a goroutine to not block
			go func() {
				if err := app.Listen(address); err != nil {
					log.Error("Server error", zap.Error(err))
				}
			}()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			log.Info("Shutting down server")
			return app.ShutdownWithContext(ctx)
		},
	})
}
