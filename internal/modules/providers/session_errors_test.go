package providers

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestSessionDiagnosticsNeverExposeAccountPageOrCredentials(t *testing.T) {
	const secret = "private-cookie-and-session-token"
	for _, tc := range []struct {
		status          int
		url, body, code string
	}{
		{200, "https://accounts.google.com/ServiceLogin?secret=" + secret, secret, "session_login_required"},
		{403, "https://gemini.google.com/app", secret, "google_access_denied"},
		{429, "https://gemini.google.com/app", secret, "google_rate_limited"},
		{200, "https://gemini.google.com/app", "recaptcha " + secret, "google_verification_required"},
		{200, "https://gemini.google.com/app", secret, "session_token_missing"},
	} {
		parsed, _ := url.Parse(tc.url)
		err := missingSessionTokenError(&http.Response{StatusCode: tc.status, Request: &http.Request{URL: parsed}}, tc.body)
		code, status := SafeInitializationDiagnostic(fmt.Errorf("wrapped: %w", err))
		if code != tc.code || status != tc.status || strings.Contains(err.Error(), secret) {
			t.Fatalf("unsafe or incorrect session diagnostic: code=%s status=%d", code, status)
		}
	}
	code, status := SafeInitializationDiagnostic(errors.New(secret))
	if code != "provider_initialization_failed" || status != 0 {
		t.Fatal("unknown error must stay redacted")
	}
}

func TestSessionTokenAcceptsFormattedBootstrapData(t *testing.T) {
	for _, body := range []string{
		`{"SNlM0e":"test-token"}`,
		"{\n  \"SNlM0e\" : \"test-token\"\n}",
		`[ "SNlM0e", "test-token" ]`,
		`{"thykhd":"test-token"}`,
		`["thykhd", "test-token"]`,
	} {
		match := accessTokenRegex.FindStringSubmatch(body)
		if len(match) < 2 {
			match = accessTokenFallbackRegex.FindStringSubmatch(body)
		}
		if len(match) < 2 || match[1] != "test-token" {
			t.Fatalf("valid formatted bootstrap token was missed for body: %s", body)
		}
	}
	for _, body := range []string{`{"dynamicKey":"AFWLunrelated_token"}`, `{"thykhd":""}`} {
		if accessTokenRegex.MatchString(body) || accessTokenFallbackRegex.MatchString(body) {
			t.Fatal("must not treat unrelated or empty values as session tokens")
		}
	}
}
