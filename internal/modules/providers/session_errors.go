package providers

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// SessionInitializationError carries only safe diagnostic fields. Never attach
// a request URL, Cookie header, account page body, or session token here.
type SessionInitializationError struct {
	Code          string
	Stage         string
	HTTPStatus    int
	AccountStatus int
}

func (e *SessionInitializationError) Error() string {
	if e.HTTPStatus != 0 {
		return fmt.Sprintf("Gemini initialization failed: %s (HTTP status %d)", e.Code, e.HTTPStatus)
	}
	return "Gemini initialization failed: " + e.Code
}

func missingSessionTokenError(response *http.Response, body string) error {
	code := "session_token_missing"
	if response.StatusCode == http.StatusTooManyRequests {
		code = "google_rate_limited"
	} else if response.StatusCode == http.StatusForbidden {
		code = "google_access_denied"
	} else if response.Request != nil && response.Request.URL != nil && response.Request.URL.Hostname() == "accounts.google.com" {
		code = "session_login_required"
	} else if strings.Contains(body, "/sorry/") || strings.Contains(strings.ToLower(body), "recaptcha") {
		code = "google_verification_required"
	} else if strings.Contains(body, "Sign in") || strings.Contains(body, "ServiceLogin") {
		code = "session_login_required"
	}
	return &SessionInitializationError{Code: code, Stage: "session", HTTPStatus: response.StatusCode}
}

// SafeInitializationDiagnostic returns an allowlisted category, never err.Error().
func SafeInitializationDiagnostic(err error) (code string, upstreamStatus int) {
	var detail *SessionInitializationError
	if errors.As(err, &detail) {
		switch detail.Code {
		case "session_token_missing", "session_login_required", "session_network_error", "google_rate_limited", "google_access_denied", "google_verification_required", "model_discovery_failed", "account_models_unavailable":
			return detail.Code, detail.HTTPStatus
		}
	}
	return "provider_initialization_failed", 0
}

func SafeAccountStatus(err error) int {
	var detail *SessionInitializationError
	if errors.As(err, &detail) && detail.Code == "account_models_unavailable" {
		return detail.AccountStatus
	}
	return 0
}
