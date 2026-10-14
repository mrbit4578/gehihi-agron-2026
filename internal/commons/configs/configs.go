package configs

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Gemini            GeminiConfig
	Claude            ClaudeConfig
	OpenAI            OpenAIConfig
	Server            ServerConfig
	RateLimit         RateLimitConfig
	LogLevel          string
	AllowUnconfigured bool
}

type RateLimitConfig struct {
	Enabled     bool
	WindowMs    int
	MaxRequests int
}

type GeminiConfig struct {
	Secure1PSID     string
	Secure1PSIDTS   string
	AuthUser        string
	RefreshInterval int
	MaxRetries      int
	Cookies         string
	Temporary       bool
}

type ClaudeConfig struct {
	APIKey  string
	Model   string
	Cookies string
}

type OpenAIConfig struct {
	APIKey  string
	Model   string
	Cookies string
}

type ServerConfig struct {
	Port            string
	APIKey          string
	AllowedOrigins  []string
	UpstreamBaseURL string
	UpstreamAPIKey  string
	Serverless      bool
}

const (
	defaultServerPort            = "4981"
	defaultGeminiRefreshInterval = 1440
	// Rotating cookies more often than this looks automated to Google and
	// tends to get the session flagged or blocked.
	minGeminiRefreshInterval = 10
	defaultGeminiMaxRetries  = 3
	defaultLogLevel          = "info"
)

func New() (*Config, error) {
	return load(false)
}

// NewForHosting keeps the UI available while credentials are being configured.
// API routes still fail closed until API_KEY and provider credentials are set.
func NewForHosting() (*Config, error) {
	return load(true)
}

func load(allowUnconfigured bool) (*Config, error) {
	// Load .env file if it exists
	_ = godotenv.Load(".env.local")
	_ = godotenv.Load(".env")

	var cfg Config
	cfg.AllowUnconfigured = allowUnconfigured

	// Server
	cfg.Server.Port = getEnv("PORT", defaultServerPort)
	cfg.Server.APIKey = strings.TrimSpace(os.Getenv("API_KEY"))
	cfg.Server.UpstreamBaseURL = strings.TrimSpace(os.Getenv("UPSTREAM_BASE_URL"))
	cfg.Server.UpstreamAPIKey = strings.TrimSpace(os.Getenv("UPSTREAM_API_KEY"))
	cfg.Server.Serverless = os.Getenv("VERCEL") == "1"
	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" && origin != "*" {
			cfg.Server.AllowedOrigins = append(cfg.Server.AllowedOrigins, origin)
		}
	}

	// General
	cfg.LogLevel = getEnv("LOG_LEVEL", defaultLogLevel)

	// Rate Limit
	cfg.RateLimit.Enabled = getEnvBool("RATE_LIMIT_ENABLED", true)
	cfg.RateLimit.WindowMs = getEnvInt("RATE_LIMIT_WINDOW_MS", 60000)
	cfg.RateLimit.MaxRequests = getEnvInt("RATE_LIMIT_MAX_REQUESTS", 10)
	if cfg.RateLimit.WindowMs < 1000 {
		cfg.RateLimit.WindowMs = 60000
	}
	if cfg.RateLimit.MaxRequests < 1 {
		cfg.RateLimit.MaxRequests = 10
	}

	// Gemini
	cfg.Gemini.Cookies = os.Getenv("GEMINI_COOKIES")
	cfg.Gemini.AuthUser = strings.TrimSpace(os.Getenv("GEMINI_AUTH_USER"))
	cfg.Gemini.Secure1PSID = cookieValue(cfg.Gemini.Cookies, "__Secure-1PSID")
	cfg.Gemini.Secure1PSIDTS = cookieValue(cfg.Gemini.Cookies, "__Secure-1PSIDTS")
	cfg.Gemini.RefreshInterval = getEnvInt("GEMINI_REFRESH_INTERVAL", defaultGeminiRefreshInterval)
	if cfg.Gemini.RefreshInterval <= 0 {
		cfg.Gemini.RefreshInterval = defaultGeminiRefreshInterval
	} else if cfg.Gemini.RefreshInterval < minGeminiRefreshInterval {
		cfg.Gemini.RefreshInterval = minGeminiRefreshInterval
	}
	cfg.Gemini.MaxRetries = getEnvInt("GEMINI_MAX_RETRIES", defaultGeminiMaxRetries)
	if cfg.Gemini.MaxRetries < 1 || cfg.Gemini.MaxRetries > 5 {
		cfg.Gemini.MaxRetries = defaultGeminiMaxRetries
	}
	cfg.Gemini.Temporary = getEnvBool("GEMINI_TEMPORARY", false)
	if cfg.Gemini.AuthUser != "" {
		if n, err := strconv.Atoi(cfg.Gemini.AuthUser); err != nil || n < 0 {
			return nil, fmt.Errorf("invalid GEMINI_AUTH_USER value: %q (must be a non-negative account slot)", cfg.Gemini.AuthUser)
		}
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func cookieValue(header, wanted string) string {
	for _, pair := range strings.Split(header, ";") {
		name, value, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if ok && strings.TrimSpace(name) == wanted {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// Validate checks if the configuration has required values
func (c *Config) Validate() error {
	var missingVars []string

	if strings.TrimSpace(c.Gemini.Cookies) == "" && !c.AllowUnconfigured {
		missingVars = append(missingVars, "GEMINI_COOKIES")
	} else if c.Gemini.Cookies != "" && (c.Gemini.Secure1PSID == "" || c.Gemini.Secure1PSIDTS == "") {
		return fmt.Errorf("GEMINI_COOKIES must contain __Secure-1PSID and __Secure-1PSIDTS")
	}

	// Check Server port is valid
	if c.Server.Port == "" {
		c.Server.Port = defaultServerPort
	}

	if port, err := strconv.Atoi(c.Server.Port); err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("invalid PORT value: %q (must be a number)", c.Server.Port)
	}

	if len(missingVars) > 0 {
		return fmt.Errorf("missing required environment variables: %v. Please set them before running the application", missingVars)
	}

	return nil
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(valueStr)
	if err != nil {
		return defaultValue
	}
	return value
}

func getEnvBool(key string, defaultValue bool) bool {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.ParseBool(valueStr)
	if err != nil {
		return defaultValue
	}
	return value
}
