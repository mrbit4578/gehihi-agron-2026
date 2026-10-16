# KIM CHỈ NAM — LLM · Transformer · Agent

> Đúc kết từ 3 học liệu: sơ đồ tư duy "Kiến thức LLM, Transformer và Hệ sinh thái Agent",
> biểu đồ "So sánh tác động các chiến lược Decoding" (Stanford CS229 – Lecture 14),
> và tài liệu "Quy trình hoạt động của mô hình ngôn ngữ lớn".
> Dùng làm chuẩn tham chiếu cho mọi dự án AI tiếp theo. Cập nhật khi có bài học mới.

---

## 1. Bản chất LLM — 5 nguyên lý không bao giờ đổi

1. **LLM chỉ làm đúng một việc, lặp đi lặp lại: đoán token tiếp theo** `P(X_t | X_1..X_{t-1})`. Mọi khả năng "suy luận", "trò chuyện", "viết code" đều là hệ quả của vòng lặp này (chain rule phân rã xác suất chuỗi).
2. **Token ≠ từ.** BPE chia văn bản thành subword theo tần suất. Một từ = 1 hoặc nhiều token. Tiếng Việt tốn nhiều token hơn tiếng Anh — luôn tính chi phí theo token, không theo chữ.
3. **Transformer = Attention + Feed-forward xếp chồng.** Attention trao đổi thông tin giữa các vị trí (Q·Kᵀ → softmax → nhân V); MLP xử lý phi tuyến từng vị trí; kèm RMSNorm + residual.
4. **Causal masking = mô hình không bao giờ thấy tương lai.** Token tại bước t chỉ được nhìn quá khứ (ma trận attention bị cộng −∞ vào tam giác trên). Hệ quả: LLM không "lập kế hoạch" theo nghĩa con người — nó chỉ nối tiếp quá khứ.
5. **LLM không có bộ nhớ thật** ngoài chuỗi token trong cửa sổ ngữ cảnh hiện tại. Muốn nhớ lâu → phải có bộ nhớ ngoài (file, DB, vector store) và nạp lại vào prompt.

## 2. Tokenization & chi phí — quy tắc vàng

- Vocab ~100k–250k token; BPE cân bằng giữa độ dài chuỗi (character-level quá dài) và từ hiếm (word-level không xử lý được).
- **Tokenizer mịn hơn = tốn nhiều token hơn cho cùng lượng chữ** → chi phí API tăng trực tiếp.
- Quy tắc: ước lượng token trước khi gọi API (tiếng Việt ≈ 2–3 token/từ); chia nhỏ ngữ cảnh dài; cache prompt lặp lại; đừng bao giờ nhồi cả DB vào prompt.

## 3. Transformer — hiểu đủ để suy luận chế độ lỗi

- Single-head attention: `softmax(Q·Kᵀ/√d)·V`. Q = "đang tìm gì", K = "vị trí đầu vào là gì", V = "nội dung thật".
- Multi-head: nhiều head chạy song song với trọng số riêng → mỗi head học một kiểu quan hệ (ngữ pháp, ngữ nghĩa, vị trí...), rồi nối lại qua ma trận chiếu.
- Chi phí attention là **O(T²)** theo độ dài ngữ cảnh: tăng gấp đôi context → tốn gấp 4 lần. Ngữ cảnh quá dài làm loãng trọng số chú ý → chất lượng giảm, đó là một nguồn gốc của hallucination.
- Khi AI trả lời sai ngớ ngẩn: kiểm tra 3 thứ theo thứ tự — (1) ngữ cảnh có quá dài/nhiễu không, (2) temperature có cao không, (3) prompt có mơ hồ không. Đừng vội kết luận "model dở".

## 4. Decoding — bảng quyết định (quan trọng nhất khi gọi API)

| Tác vụ | temperature | top_p | Ghi chú |
|---|---|---|---|
| Trích xuất dữ liệu, báo cáo kỹ thuật, lập trình, chấm điểm | **0 – 0.3** | 0.1 | Vùng zero-hallucination: càng deterministic càng tốt |
| Chat, tóm tắt, email chuẩn | 0.7 | 0.9 | Cân bằng tự nhiên/an toàn |
| Brainstorm, viết sáng tạo | 1.1 | 0.95 | Chấp nhận ngẫu nhiên |

Bằng chứng (CS229): cùng một phân bố logits gốc (T1=65%) —
- T=0.3 → T1 vọt lên **98.4%** (tiệm cận greedy, các token khác gần như bị loại);
- T=1.8 → T1 còn **43.8%**, đuôi T4–T7 ngóc lên (8.3%/5.6%/2.7%/1.2%);
- Top-K=3 / Top-P=0.85 → cắt phăng T4–T7 về 0%, chuẩn hóa lại cho T1–T3.

Quy tắc:
- **Không tăng đồng thời temperature cao và top_p cao** (dễ sinh chuỗi vô nghĩa). Cố định một cái, chỉnh cái còn lại.
- Cần reproducibility khi test hệ thống → temperature = 0.
- Muốn ít bịa đặt → temperature thấp + top_p thấp (cắt đuôi phân bố, nơi hallucination chui ra).

## 5. Training & giới hạn — đừng thần thánh hóa

- Pretrain (dự đoán token, loss = negative log-likelihood) → SFT → RLHF. Thiếu một giai đoạn là model không dùng được.
- **In-context learning:** có thể "dạy" model qua ví dụ trong prompt mà không cần retrain — đây là cơ chế rẻ nhất để tùy biến hành vi (few-shot examples > prompt dài dòng).
- Luật scaling: tham số + dữ liệu quyết định năng lực. Không có cách hack nào thay được dữ liệu thật.
- Hallucination xảy ra khi softmax chọn nhầm token ở đuôi phân bố, hoặc khi ngữ cảnh quá dài. Không bao giờ tin output LLM cho quyết định quan trọng mà không có lớp kiểm chứng độc lập (rule, số liệu, test).

## 6. Multi-Agent — 5 tầng xây dựng (theo thứ tự, không nhảy cóc)

```
[Tầng 1: Base Model] → [Tầng 2: Tools & MCP] → [Tầng 3: Skills]
        → [Tầng 4: Agent Loop] → [Tầng 5: Multi-Agent Platform]
```

- **Tầng 1 – Model (bộ não):** chọn model đủ khả năng suy luận cho bài toán. Model không có tools thì chỉ "nghĩ", không "làm" được.
- **Tầng 2 – Tools & MCP (tay chân):** web search, file search, code sandbox, computer use… MCP là chuẩn cắm chung để nối vào DB/CRM/Drive nội bộ — ưu tiên chuẩn mở thay vì integration riêng lẻ.
- **Tầng 3 – Skills (cách làm):** tool là động tác, skill là quy trình (ví dụ: làm báo cáo = lấy số liệu → kiểm tra → vẽ biểu đồ → viết nhận xét). Đóng gói skill để tái dùng.
- **Tầng 4 – Agent Loop:** Model + Context + Tools + Skills + Memory, chạy vòng lặp **Nghĩ (Plan) → Làm (Act) → Quan sát (Observe) → Sửa (Correct)**.
- **Tầng 5 – Multi-Agent:** đừng bắt một agent gánh hết. Chia cho các agent chuyên biệt chạy song song/nối tiếp, dưới một main agent điều phối.
- Thành phần cốt lõi của một agent: **Model + Tools + Skills + Memory + MCP**. Thiếu Memory thì mỗi phiên là một người mới.

## 7. Checklist khởi động dự án AI mới

- [ ] Xác định rõ: bài toán cần **đúng** (temp 0–0.3) hay cần **sáng tạo** (temp ~1)? Chốt tham số decoding trước khi viết prompt.
- [ ] Ước lượng token/ngữ cảnh → tính chi phí API trước, không sau.
- [ ] Thiết kế bộ nhớ ngoài ngay từ đầu (LLM không tự nhớ).
- [ ] Mọi output LLM dùng cho quyết định quan trọng → phải có lớp kiểm chứng độc lập (rule/test/số liệu).
- [ ] Đóng gói quy trình lặp lại thành Skill, đừng để prompt trôi nổi.
- [ ] Một agent quá tải → tách thành multi-agent chuyên biệt.
- [ ] Ghi lại bài học vào file này. Kim chỉ nam chỉ sống khi được cập nhật.

## 8. Cấu hình API mẫu (copy-paste)

```python
DETERMINISTIC = {"temperature": 0.0, "top_p": 0.1}   # phân tích, trích xuất, code
BALANCED      = {"temperature": 0.7, "top_p": 0.9}   # chat, tóm tắt
CREATIVE      = {"temperature": 1.1, "top_p": 0.95}  # brainstorm
```

---
*Nguồn: Stanford CS229 Lecture 14 (Transformers & Decoding); tài liệu "Quy trình hoạt động của LLM";
sơ đồ "Kiến thức LLM, Transformer và Hệ sinh thái Agent". Tổng hợp ngày 16/10/2026.*
