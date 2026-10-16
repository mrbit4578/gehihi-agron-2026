package utils

import (
	"testing"

	"gemini-web-to-api/internal/commons/models"
)

func TestEstimateTokens(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		minToken int
		maxToken int
	}{
		{
			name:     "empty string",
			input:    "",
			minToken: 0,
			maxToken: 0,
		},
		{
			name:     "simple english",
			input:    "Hello world! This is a test.",
			minToken: 6,
			maxToken: 12,
		},
		{
			name:     "vietnamese diacritics",
			input:    "Xin chào các bạn, đây là hệ thống mô hình ngôn ngữ lớn LLM.",
			minToken: 18,
			maxToken: 35, // Higher token count for Vietnamese as stated in MEMORY.md
		},
		{
			name:     "code snippet with brackets and newlines",
			input:    "func main() {\n\tfmt.Println(\"Hello\")\n}",
			minToken: 8,
			maxToken: 20,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EstimateTokens(tt.input)
			if got < tt.minToken || got > tt.maxToken {
				t.Errorf("EstimateTokens(%q) = %d; want between %d and %d", tt.input, got, tt.minToken, tt.maxToken)
			}
		})
	}
}

func TestEstimateMessagesTokens(t *testing.T) {
	msgs := []models.Message{
		{Role: "user", Content: "Xin chào mô hình!"},
		{Role: "assistant", Content: "Chào bạn! Tôi có thể giúp gì cho bạn hôm nay?"},
	}

	tokens := EstimateMessagesTokens(msgs, "Bạn là một trợ lý thông minh.")
	if tokens < 20 || tokens > 70 {
		t.Errorf("EstimateMessagesTokens() = %d; want between 20 and 70", tokens)
	}
}
