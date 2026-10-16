package utils

import (
	"regexp"
	"strings"
	"unicode"

	"gemini-web-to-api/internal/commons/models"
)

var (
	// Regex identifying Vietnamese specific diacritics
	vietnameseDiacriticRegex = regexp.MustCompile(`(?i)[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]`)
	// Whitespace split for word boundary analysis
	wordBoundaryRegex = regexp.MustCompile(`\s+`)
)

// EstimateTokens calculates an accurate token count approximation based on Byte-Pair Encoding (BPE)
// principles documented in CS229 Lecture 14 and modern LLM tokenizers (tiktoken, Gemma, Gemini).
// Key principles:
// 1. English text averages ~4 characters or ~0.75 words per token (~1.33 tokens/word).
// 2. Vietnamese words with diacritics split into multiple subwords (~2.0 - 2.5 tokens per word).
// 3. Punctuation, symbols, brackets, and code indentation generate distinct subword tokens.
func EstimateTokens(text string) int {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0
	}

	words := wordBoundaryRegex.Split(trimmed, -1)
	if len(words) == 0 {
		return 0
	}

	totalTokens := 0
	for _, word := range words {
		if word == "" {
			continue
		}

		// Count punctuation symbols inside or attached to word
		punctCount := 0
		letterCount := 0
		hasVietnamese := false

		for _, r := range word {
			if unicode.IsPunct(r) || unicode.IsSymbol(r) {
				punctCount++
			} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
				letterCount++
			}
		}

		if vietnameseDiacriticRegex.MatchString(word) {
			hasVietnamese = true
		}

		// Subword estimation for the lexical root
		var wordTokens int
		if hasVietnamese {
			// Vietnamese word with accents: subword BPE splits into ~2.2 tokens per word
			wordTokens = 2
			if letterCount > 6 {
				wordTokens += (letterCount - 6) / 3
			}
		} else {
			// English / Latin / alphanumeric
			if letterCount <= 4 {
				wordTokens = 1
			} else {
				wordTokens = 1 + (letterCount-1)/4
			}
		}

		// Each distinct punctuation/symbol is typically 1 subword token in BPE
		totalTokens += wordTokens + punctCount
	}

	// Add tokens for newlines / paragraph breaks
	newlineCount := strings.Count(text, "\n")
	totalTokens += newlineCount

	if totalTokens < 1 {
		totalTokens = 1
	}

	return totalTokens
}

// EstimateMessagesTokens estimates the total token count of an OpenAI/Claude/Gemini message list,
// including system prompt and message framing overhead (~4 tokens per message envelope).
func EstimateMessagesTokens(messages []models.Message, systemPrompt string) int {
	total := 0
	if strings.TrimSpace(systemPrompt) != "" {
		total += EstimateTokens(systemPrompt) + 4 // System message envelope
	}

	for _, msg := range messages {
		total += 4 // Per-message header overhead: <|im_start|>role ... <|im_end|>
		if strings.TrimSpace(msg.Content) != "" {
			total += EstimateTokens(msg.Content)
		}
		if len(msg.Attachments) > 0 {
			// Multimodal image / file tokens: standard vision grid ~258 tokens per image
			total += len(msg.Attachments) * 258
		}
	}

	total += 2 // Assistant reply primer overhead: <|im_start|>assistant
	return total
}
