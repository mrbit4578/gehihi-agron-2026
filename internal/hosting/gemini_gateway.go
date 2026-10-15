package hosting

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httputil"
	"strconv"
	"strings"

	"gemini-web-to-api/internal/commons/configs"
)

type bufferedGeminiKey struct{}

// The remote backend returns ordinary Gemini JSON. Streaming clients receive
// that actual response as one SSE event, so the tunnel itself needs no SSE.
func newGeminiGateway(cfg *configs.Config) (*httputil.ReverseProxy, error) {
	copyCfg := *cfg
	copyCfg.Server.UpstreamBaseURL = cfg.Server.UpstreamGeminiBaseURL
	proxy, err := newGateway(&copyCfg)
	if err != nil {
		return nil, err
	}
	rewrite := proxy.Rewrite
	modifyResponse := proxy.ModifyResponse
	proxy.Rewrite = func(p *httputil.ProxyRequest) {
		path := strings.TrimPrefix(p.In.URL.Path, "/gemini/v1beta")
		stream := strings.HasSuffix(path, ":streamGenerateContent")
		incoming := p.In.Clone(context.WithValue(p.In.Context(), bufferedGeminiKey{}, stream))
		urlCopy := *p.In.URL
		incoming.URL = &urlCopy
		if stream {
			path = strings.TrimSuffix(path, ":streamGenerateContent") + ":generateContent"
			query := incoming.URL.Query()
			query.Del("alt")
			incoming.URL.RawQuery = query.Encode()
		}
		incoming.URL.Path = "/openai/v1" + path
		incoming.URL.RawPath = ""
		p.In = incoming
		rewrite(p)
		p.Out = p.Out.WithContext(incoming.Context())
		p.Out.URL.RawQuery = incoming.URL.RawQuery
		if stream {
			p.Out.Header.Set("Accept", "application/json")
		}
	}
	proxy.ModifyResponse = func(r *http.Response) error {
		if err := modifyResponse(r); err != nil {
			return err
		}
		if r.Request == nil || r.Request.Context().Value(bufferedGeminiKey{}) != true || r.StatusCode != http.StatusOK {
			return nil
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, (32<<20)+1))
		_ = r.Body.Close()
		if err != nil || len(body) > 32<<20 || !json.Valid(body) {
			return errors.New("upstream Gemini reply is not valid bounded JSON")
		}
		// Compact JSON keeps embedded line breaks inside a single SSE data field.
		var compact bytes.Buffer
		if json.Compact(&compact, body) != nil {
			return errors.New("invalid upstream Gemini JSON")
		}
		frame := append([]byte("data: "), compact.Bytes()...)
		frame = append(frame, '\n', '\n')
		r.Body = io.NopCloser(bytes.NewReader(frame))
		r.ContentLength = int64(len(frame))
		r.TransferEncoding = nil
		r.Header.Set("Content-Length", strconv.Itoa(len(frame)))
		r.Header.Set("Content-Type", "text/event-stream; charset=utf-8")
		return nil
	}
	return proxy, nil
}
