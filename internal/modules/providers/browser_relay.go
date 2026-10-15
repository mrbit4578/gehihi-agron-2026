package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type browserRelayTransport struct{ baseURL, key string }

func (t *browserRelayTransport) call(ctx context.Context, path string, input, output any) error {
	base, err := url.Parse(t.baseURL)
	if err != nil || base.Scheme != "http" || base.Hostname() != "127.0.0.1" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || base.Path != "" {
		return &SessionInitializationError{Code: "browser_bridge_offline", Stage: "browser"}
	}
	var body io.Reader
	if input != nil {
		data, _ := json.Marshal(input)
		body = bytes.NewReader(data)
	}
	method := http.MethodGet
	if input != nil {
		method = http.MethodPost
	}
	req, err := http.NewRequestWithContext(ctx, method, t.baseURL+path, body)
	if err != nil {
		return &SessionInitializationError{Code: "browser_bridge_offline", Stage: "browser"}
	}
	req.Header.Set("Authorization", "Bearer "+t.key)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 4 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &SessionInitializationError{Code: "browser_bridge_offline", Stage: "browser"}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return &SessionInitializationError{Code: "browser_bridge_offline", Stage: "browser", HTTPStatus: res.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (64<<20)+1))
	if err != nil || len(data) > 64<<20 || json.Unmarshal(data, output) != nil {
		return &SessionInitializationError{Code: "browser_bridge_invalid_reply", Stage: "browser"}
	}
	return nil
}

func (t *browserRelayTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" || req.URL.Host != "gemini.google.com" || req.URL.User != nil {
		return nil, &SessionInitializationError{Code: "browser_bridge_invalid_target", Stage: "browser"}
	}
	var body []byte
	if req.Body != nil {
		defer req.Body.Close()
		var err error
		body, err = io.ReadAll(io.LimitReader(req.Body, (4<<20)+1))
		if err != nil || len(body) > 4<<20 {
			return nil, &SessionInitializationError{Code: "browser_bridge_invalid_reply", Stage: "browser"}
		}
	}
	// Workspace credentials, Cookie and browser identity headers never leave this process.
	headers := make(map[string]string)
	for _, key := range []string{"Content-Type", "Accept", geminiModelHeaderKey, "x-goog-ext-73010989-jspb"} {
		if value := req.Header.Get(key); value != "" {
			headers[key] = value
		}
	}
	input := map[string]any{"url": req.URL.String(), "method": req.Method, "headers": headers, "body": string(body)}
	var reply struct {
		Status      int    `json:"status"`
		Body        string `json:"body"`
		ContentType string `json:"content_type"`
	}
	if err := t.call(req.Context(), "/fetch", input, &reply); err != nil {
		return nil, err
	}
	if reply.Status < 100 || reply.Status > 599 || len(reply.Body) > 32<<20 {
		return nil, &SessionInitializationError{Code: "browser_bridge_invalid_reply", Stage: "browser"}
	}
	header := make(http.Header)
	header.Set("Content-Type", reply.ContentType)
	header.Set("Content-Length", strconv.Itoa(len(reply.Body)))
	return &http.Response{StatusCode: reply.Status, Header: header, Body: io.NopCloser(strings.NewReader(reply.Body)), ContentLength: int64(len(reply.Body)), Request: req}, nil
}

func (c *Client) refreshBrowserSession(ctx context.Context) error {
	var state struct {
		Connected   bool   `json:"connected"`
		AccountSlot string `json:"account_slot"`
	}
	if err := c.browserRelay.call(ctx, "/state", nil, &state); err != nil {
		return err
	}
	if !state.Connected {
		return &SessionInitializationError{Code: "browser_bridge_offline", Stage: "browser"}
	}
	if state.AccountSlot != "" {
		if n, err := strconv.Atoi(state.AccountSlot); err != nil || n < 0 {
			return &SessionInitializationError{Code: "browser_bridge_invalid_reply", Stage: "browser"}
		}
	}
	client := &http.Client{Transport: c.browserRelay, Timeout: 60 * time.Second}
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, geminiAccountURL(EndpointInit, state.AccountSlot)+"?hl=en", nil)
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (32<<20)+1))
	if err != nil || len(data) > 32<<20 {
		return &SessionInitializationError{Code: "browser_bridge_invalid_reply", Stage: "browser"}
	}
	body := string(data)
	token := extractSessionToken(body)
	if token == "" {
		return missingSessionTokenError(response, body)
	}
	metadata := func(pattern interface{ FindStringSubmatch(string) []string }) string {
		if m := pattern.FindStringSubmatch(body); len(m) > 1 {
			return m[1]
		}
		return ""
	}
	build, session, language := metadata(buildLabelRegex), metadata(sessionIDRegex), metadata(languageRegex)
	if language == "" {
		language = "en"
	}
	generation := strings.ToUpper(uuid.NewString())
	models, err := fetchGeminiModels(ctx, client, token, "", build, session, language, generation, state.AccountSlot)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.at, c.cookieHeader, c.authUser = token, "", state.AccountSlot
	c.buildLabel, c.sessionID, c.language, c.generationID = build, session, language, generation
	c.cachedModels, c.healthy = models, true
	c.mu.Unlock()
	return nil
}
