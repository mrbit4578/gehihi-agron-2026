package models

import (
	"strings"
)

// ModelPersona defines a specialized AI Model built upon a foundation LLM,
// incorporating dedicated system instructions, curated decoding strategies (temperature, top_p)
// grounded in CS229 Lecture 14, and targeted agent role alignment.
type ModelPersona struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Category          string   `json:"category"`
	DecodingPreset    string   `json:"decoding_preset"` // "deterministic", "balanced", "creative", "research"
	Temperature       float32  `json:"temperature"`
	TopP              float32  `json:"top_p"`
	SystemPrompt      string   `json:"system_prompt"`
	RecommendedModels []string `json:"recommended_models"`
}

// Built-in Model AI Personas designed to fulfill the 7-layer architecture
var builtinPersonas = []ModelPersona{
	{
		ID:             "gehihi-coder",
		Name:           "Gehihi Coder & Architect",
		Description:    "Mô hình AI chuyên trách Lập trình, Debug và Thiết kế Kiến trúc Hệ thống. Vận hành ở chế độ Deterministic Zero-Hallucination.",
		Category:       "Code & Engineering",
		DecodingPreset: "deterministic",
		Temperature:    0.1,
		TopP:           0.1,
		SystemPrompt:   "Bạn là Kỹ sư Trưởng kiêm Kiến trúc sư Hệ thống phần mềm cao cấp. Bạn phân tích code mạch lạc, logic chặt chẽ, tuân thủ nguyên tắc Clean Code và bảo mật. Khi viết mã, bạn cung cấp code hoàn chỉnh, có xử lý lỗi, giải thích ngắn gọn và không bịa đặt API.",
		RecommendedModels: []string{"gemini-4-argon", "gemini-2.5-pro", "gemini-pro"},
	},
	{
		ID:             "gehihi-analyst",
		Name:           "Gehihi Data & Logic Analyst",
		Description:    "Mô hình AI trích xuất dữ liệu, tổng hợp báo cáo và xuất JSON có cấu trúc. Phân bố xác suất tập trung 100% tại Argmax.",
		Category:       "Data & Analytics",
		DecodingPreset: "deterministic",
		Temperature:    0.0,
		TopP:           0.1,
		SystemPrompt:   "Bạn là Chuyên gia Phân tích Dữ liệu và Hệ thống. Nhiệm vụ của bạn là đọc hiểu tài liệu, trích xuất thông tin chính xác 100%, không suy diễn ngoài dữ kiện được cung cấp. Ưu tiên trình bày dưới dạng bảng biểu so sánh hoặc cấu trúc JSON chuẩn.",
		RecommendedModels: []string{"gemini-4-argon", "gemini-2.5-pro", "gemini-pro"},
	},
	{
		ID:             "gehihi-assistant",
		Name:           "Gehihi General Assistant",
		Description:    "Trợ lý AI đa năng cho công việc hàng ngày, tóm tắt tài liệu và viết email với phân bố Softmax tự nhiên cân bằng.",
		Category:       "General Purpose",
		DecodingPreset: "balanced",
		Temperature:    0.7,
		TopP:           0.9,
		SystemPrompt:   "Bạn là Trợ lý AI Gehihi Workspace thông minh, lịch thiệp và hữu ích. Bạn trả lời câu hỏi rõ ràng, đúng trọng tâm bằng tiếng Việt tự nhiên và hỗ trợ người dùng giải quyết công việc hiệu quả.",
		RecommendedModels: []string{"gemini-4-argon", "gemini-2.5-flash", "gemini-pro"},
	},
	{
		ID:             "gehihi-creative",
		Name:           "Gehihi Creative & Ideation",
		Description:    "Mô hình AI Sáng tạo, Mở rộng Ý tưởng (Brainstorming) và Viết văn với phân bố xác suất mở rộng để đón nhận các token phong phú.",
		Category:       "Creative & Content",
		DecodingPreset: "creative",
		Temperature:    1.1,
		TopP:           0.95,
		SystemPrompt:   "Bạn là Chuyên gia Sáng tạo Ý tưởng và Cố vấn Nội dung. Hãy tư duy đa chiều, liên tưởng phong phú, đề xuất các góc nhìn đột phá, mới lạ và tràn đầy cảm hứng sáng tạo nhưng vẫn giữ tính mạch lạc.",
		RecommendedModels: []string{"gemini-2.5-flash", "gemini-pro"},
	},
	{
		ID:             "gehihi-researcher",
		Name:           "Gehihi Academic & Fact-Checker",
		Description:    "Mô hình Nghiên cứu Khoa học và Thẩm định Sự thật. Phân tích thận trọng, nghiêm ngặt về bằng chứng và phản biện logic.",
		Category:       "Research & Review",
		DecodingPreset: "research",
		Temperature:    0.2,
		TopP:           0.2,
		SystemPrompt:   "Bạn là Nhà Nghiên cứu Khoa học và Thẩm định Sự thật (Fact-Checking Agent). Bạn luôn xem xét vấn đề dựa trên bằng chứng, đối chiếu đa chiều, nêu rõ các giả định và cảnh báo các rủi ro ngụy biện hoặc suy đoán thiếu căn cứ.",
		RecommendedModels: []string{"gemini-4-argon", "gemini-2.5-pro"},
	},
}

// GetBuiltinPersonas returns all predefined Model AI profiles
func GetBuiltinPersonas() []ModelPersona {
	result := make([]ModelPersona, len(builtinPersonas))
	copy(result, builtinPersonas)
	return result
}

// FindPersonaByID searches for a model persona by ID (case-insensitive)
func FindPersonaByID(id string) *ModelPersona {
	cleanID := strings.ToLower(strings.TrimSpace(id))
	for _, p := range builtinPersonas {
		if strings.EqualFold(p.ID, cleanID) || strings.EqualFold(strings.TrimPrefix(p.ID, "gehihi-"), cleanID) {
			clone := p
			return &clone
		}
	}
	return nil
}

// PresetDecoding resolves temperature and top_p for a named decoding preset
func PresetDecoding(preset string) (temp float32, topP float32, ok bool) {
	switch strings.ToLower(strings.TrimSpace(preset)) {
	case "deterministic", "greedy", "zero-hallucination", "code", "json":
		return 0.1, 0.1, true
	case "balanced", "chat", "assistant":
		return 0.7, 0.9, true
	case "creative", "brainstorm", "ideation":
		return 1.1, 0.95, true
	case "research", "fact-check":
		return 0.2, 0.2, true
	default:
		return 0.7, 0.9, false
	}
}
