package handler

import (
	"net/http"

	"gemini-web-to-api/pkg/serverless"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	serverless.Handler(w, r)
}
