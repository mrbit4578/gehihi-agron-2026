# KIM CHỈ NAM THIẾT KẾ & XÂY DỰNG HỆ THỐNG MÔ HÌNH NGÔN NGỮ LỚN (LLM) VÀ MULTI-AGENT

> **Mục tiêu tài liệu:** Báo cáo Tổng hợp và Hệ thống hóa Toàn diện dành cho Chuyên gia Phân tích Hệ thống, Kỹ sư AI và LLMs. Tài liệu này đóng vai trò là "Kim chỉ nam kỹ thuật" (System Architecture Blueprint) mô tả chi tiết từ nguyên lý toán học nền tảng của Transformer đến kiến trúc triển khai Hệ thống Đa tác tử (Multi-Agent System).

---

## I. TỔNG QUAN ĐIỀU HÀNH & TRIẾT LÝ KIẾN TRÚC (EXECUTIVE SUMMARY)

1. **Bản chất của LLM:** LLM tự hồi quy (Auto-regressive LLM) thực chất chỉ làm đúng một nhiệm vụ lặp đi lặp lại: **dự đoán token tiếp theo** dựa trên chuỗi ngữ cảnh đầu vào thông qua hàm xác suất điều kiện [1, 17, 39].
2. **Kiến trúc tầng (Stacked Architecture):** Để tạo nên một hệ sinh thái AI có năng lực thực thi công việc thực tế, AI phát triển theo chuỗi 7 tầng liên tục:
   $$\text{Base Model} \longrightarrow \text{Tokenizer (BPE)} \longrightarrow \text{Transformer Core} \longrightarrow \text{Decoding} \longrightarrow \text{Alignment (SFT/RLHF)} \longrightarrow \text{Tools \& MCP} \longrightarrow \text{Agent \& Multi-Agent}$$
3. **Sự dịch chuyển chuyển giao:** Mô hình ngôn ngữ đóng vai trò "Bộ não suy luận" (Central Brain). Công cụ (Tools) và Giao thức (MCP) đóng vai trò "Tay chân". Kỹ năng (Skills) đóng vai trò "Quy trình làm việc". Hệ thống Multi-Agent biến AI từ một cỗ máy trò chuyện (Chatbot) thành một **Hệ điều hành công việc (AI Operating System)** [80].

---

## II. LỚP 1: XỬ LÝ ĐẦU VÀO & THUẬT TOÁN TOKENIZATION (BPE)

### 1.1. Tại sao phải Tokenize?
- Các mô hình Transformer là các kiến trúc tính toán số học, không thể xử lý trực tiếp chuỗi ký tự văn bản thô [2, 17].
- **Word-level vs Character-level:**
  - *Character-level:* Làm chuỗi quá dài, tốn quá nhiều bước tính toán [2, 18].
  - *Word-level:* Không xử lý được các từ hiếm, từ mới (ví dụ: `lmification`) hoặc các thuật ngữ chuyên ngành sinh học/tiếng Đức ghép từ nhiều thành tố [3, 4, 18, 19, 20].
  - *Subword Tokenization (BPE):* Giải pháp trung hòa tối ưu, tách văn bản thành các đơn vị subword [3, 20].

### 1.2. Thuật toán Byte Pair Encoding (BPE)
- **Cơ chế:** Thuật toán tham ăn (greedy algorithm) thống kê và gộp các cặp ký tự/subword xuất hiện với tần suất cao nhất thành một token mới trong từ vựng [9, 25].
- **Kích thước từ vựng ($|V|$):** Cố định trong khoảng $100,000 \le |V| \le 250,000$ tokens [6, 21, 26]. Mỗi token được gán một ID số nguyên duy nhất [6, 22].

### 1.3. Tác động Kinh tế & Kỹ thuật
- Tokenizer mịn hơn $\rightarrow$ Cùng một đoạn văn bản tốn nhiều token hơn $\rightarrow$ Chi phí gọi API (Billing) tăng lên và Cửa sổ ngữ cảnh (Context Window) bị lấp đầy nhanh hơn [8, 24].

---

## III. LỚP 2: MÔ HÌNH HÓA XÁC SUẤT TỰ HỒI QUY (AUTOREGRESSIVE MODELING)

### 2.1. Quy tắc chuỗi Xác suất (Chain Rule Decomposition)
Không thể mô hình hóa phân bố xác suất đồng thời $P(X_1, X_2, \dots, X_T)$ dưới dạng phân bố rời rạc Categorical vì số lượng kết hợp là $|V|^T$ (vượt quá khả năng lưu trữ) [11, 26, 27].
Phân rã xác suất thành tích các xác suất điều kiện:
$$P(X_1, X_2, \dots, X_T) = \prod_{t=1}^T P(X_t \mid X_1, X_2, \dots, X_{t-1})$$ [12, 27]

### 2.2. Vectơ Biểu diễn Nhúng (Row Vector Embeddings)
- Mỗi Token ID được tra cứu trong Ma trận Nhúng $E \in \mathbb{R}^{|V| \times d}$ để chuyển thành một vectơ hàng (Row Vector) $d$-chiều [14, 30, 31].
- Thêm token đặc biệt bắt đầu chuỗi ($\text{BOS} / X_0$) để khởi tạo bước dự đoán đầu tiên [31, 32].

---

## IV. LỚP 3: KIẾN TRÚC LÕI TRANSFORMER (ATTENTION & MLP)

### 3.1. Cấu trúc Lớp Xen kẽ
Transformer bao gồm các tầng xếp chồng liên tục:
$$\text{Input Embedding} \longrightarrow [\text{Multi-Head Self-Attention} \longrightarrow \text{RMSNorm} \longrightarrow \text{MLP} \longrightarrow \text{RMSNorm}] \times L \longrightarrow \text{Logits}$$ [49, 50, 74]

### 3.2. Tính toán Single-Head Self-Attention (Chiếu Vectơ Hàng)
Với chuỗi đầu vào $H \in \mathbb{R}^{T \times d}$, mô hình chiếu qua 3 ma trận trọng số $W_Q, W_K, W_V \in \mathbb{R}^{d \times d_H}$:
- **Query Matrix:** $Q = H \cdot W_Q \in \mathbb{R}^{T \times d_H}$ [52, 53]
- **Key Matrix:** $K = H \cdot W_K \in \mathbb{R}^{T \times d_H}$ [53]
- **Value Matrix:** $V = H \cdot W_V \in \mathbb{R}^{T \times d_H}$ [54]

Ma trận điểm tương đồng chú ý thô (Attention Scores):
$$S = \frac{Q \cdot K^T}{\sqrt{d_H}} \in \mathbb{R}^{T \times T}$$ [56, 64, 65]

---

## V. LỚP 4: CƠ CHẾ CAUSAL MASKING (MẶT NẠ NHÂN QUẢ)

### 4.1. Bài toán
Trong quá trình huấn luyện song song trên GPU, toàn bộ chuỗi $T$ tokens được đưa vào mô hình cùng lúc. Nếu không chặn, token $i$ sẽ "nhìn thấy" token $j > i$ ở tương lai, làm rò rỉ dữ liệu và thất bại khi sinh câu tự do [65, 66, 69].

### 4.2. Công thức Toán học Causal Masking
Thêm ma trận mặt nạ $M \in \mathbb{R}^{T \times T}$ vào ma trận điểm $S$ trước khi đi qua hàm Softmax [67]:
$$M_{i, j} = \begin{cases} 0 & \text{nếu } j \le i \quad (\text{Hợp lệ - Quá khứ \& Hiện tại}) \\ -\infty & \text{nếu } j > i \quad (\text{Bị cấm - Tương lai}) \end{cases}$$ [67, 68]

$$S_{\text{masked}} = S + M = \begin{bmatrix} 
S_{1,1} & -\infty & -\infty & \dots & -\infty \\ 
S_{2,1} & S_{2,2} & -\infty & \dots & -\infty \\ 
S_{3,1} & S_{3,2} & S_{3,3} & \dots & -\infty \\ 
\vdots & \vdots & \vdots & \ddots & \vdots \\ 
S_{T,1} & S_{T,2} & S_{T,3} & \dots & S_{T,T} 
\end{bmatrix}$$ [67, 68]

### 4.3. Kết quả Softmax
Do $\exp(-\infty) = 0$, phân bố xác suất chú ý tại mọi vị trí tương lai $j > i$ bị triệt tiêu hoàn toàn về $0$:
$$P_{i, j} = \text{Softmax}(S_{\text{masked}})_{i, j} = 0 \quad \forall j > i$$ [68, 69]
$$\text{Output}_i = \sum_{j=1}^i P_{i, j} \cdot V_j$$ [58, 66]

---

## VI. LỚP 5: CHIẾN LƯỢC DECODING & SAMPLING MATRIX

Vectơ đầu ra Logits $U \in \mathbb{R}^{|V|}$ được biến đổi thành phân bố xác suất qua hàm Softmax điều chỉnh Nhiệt độ ($\tau$) [32, 41]:

$$P(X_t = v) = \frac{\exp(U_v / \tau)}{\sum_{w \in V} \exp(U_w / \tau)}$$ [41, 42]

### Bảng Ma trận Cấu hình API cho Lập trình viên

| Chiến lược Decoding | Tham số API | Biến đổi Phân bố | Đặc tính Output | Bối cảnh Sử dụng Ưu tiên |
| :--- | :--- | :--- | :--- | :--- |
| **Greedy Search** | `temperature: 0.0` | Concentrated 100% tại $\text{Argmax}$ | Đơn định (Deterministic) | Code, Trích xuất JSON, Toán, Logic [45] |
| **Low Temp** | `temperature: 0.1 - 0.3` | Sharpened (Làm nhọn) | Chính xác cao, ít biến động | Factual Q&A, Tóm tắt tài liệu [41, 45] |
| **Balanced** | `temperature: 0.7 - 0.8`, `top_p: 0.9` | Natural Softmax | Tự nhiên, sáng tạo vừa phải | Chatbot, Viết Email, Báo cáo [41, 46] |
| **Creative** | `temperature: 1.1 - 1.2`, `top_p: 0.95` | Softened (Làm phẳng) | Ngẫu nhiên, phong phú | Brainstorming, Viết văn, Thơ [46] |
| **Top-K** | `top_k: 20 - 50` | Truncate top $K$ tokens | An toàn, không từ hiếm | Giới hạn tập từ vựng an toàn [46, 47] |
| **Top-P (Nucleus)**| `top_p: 0.85 - 0.95` | Dynamic threshold $\sum P_i \ge P$ | Thích ứng linh hoạt | Chuẩn API mặc định cho mọi tác vụ |

---

## VII. LỚP 6: QUA TRÌNH HUẤN LƯỢNG & TỐI ƯU HÓA QUY MÔ

### 6.1. Hàm Mất mát (Loss Function)
Mô hình được huấn luyện bằng cách tối thiểu hóa hàm Negative Log-Likelihood (NLL) trên toàn bộ chuỗi:
$$\mathcal{L}(\theta) = -\sum_{t=1}^T \log P_\theta(X_t \mid X_1, \dots, X_{t-1})$$ [47, 48]

### 6.2. Lộ trình Căn chỉnh (Alignment Pipeline)
$$\text{Pretraining (Base Model)} \longrightarrow \text{Supervised Fine-Tuning (SFT)} \longrightarrow \text{RLHF / Direct Preference Optimization}$$ [16]

### 6.3. Chi phí Tính toán $O(T^2)$ & FlashAttention
- Ma trận Self-Attention đòi hỏi tính toán tích trong $T \times T$, tạo ra chi phí tính toán và bộ nhớ độ phức tạp bình phương $O(T^2 \cdot d_H)$ theo độ dài ngữ cảnh $T$ [76].
- **FlashAttention:** Kỹ thuật tối ưu đệm bộ nhớ GPU (SRAM vs HBM) giúp giảm bộ nhớ đệm mà không làm thay đổi kết quả toán học [78].

---

## VIII. LỚP 7: KIẾN TRÚC HỆ THỐNG AGENT & MULTI-AGENT SYSTEM

### 8.1. Sơ đồ Tầng Kiến trúc Hệ sinh thái AI (OpenAI Ecosystem Stack)
```text
[TẦNG 6: AI OPERATING SYSTEM / PLATFORM] (Response API, Agents SDK, Sandbox, Tracing)
       │
[TẦNG 5: MULTI-AGENT ORCHESTRATION] (Main Agent + Search/Code/Review Agents)
       │
[TẦNG 4: SINGLE AGENT LOOP] (Think -> Act -> Observe -> Correct)
       │
[TẦNG 3: SKILLS / WORKFLOWS] (Trình tự kết hợp Tools bài bản)
       │
[TẦNG 2: TOOLS & MCP PROTOCOL] (Web/File Search, Sandbox, Google Drive, CRM, DB)
       │
[TẦNG 1: BASE MODEL - CENTRAL BRAIN] (Autoregressive Transformer LLM)
```
*[80]*

### 8.2. Chuẩn cắm MCP (Model Context Protocol)
MCP đóng vai trò chuẩn giao tiếp vạn năng kết nối Agent với các hệ thống dữ liệu doanh nghiệp (CRM, Database, Google Drive, Slack) mà không cần viết lại mã tích hợp custom cho từng công cụ [80].

### 8.3. Vòng lặp Tác tử (Single Agent Loop)
$$\text{Goal Input} \longrightarrow \left[ \text{Think (Plan)} \longrightarrow \text{Act (Tool Call)} \longrightarrow \text{Observe (Output)} \longrightarrow \text{Self-Correct} \right] \longrightarrow \text{Final Result}$$
*[80]*

### 8.4. Phân vai Hệ thống Multi-Agent
1. **Orchestrator (Main Agent):** Tiếp nhận mục tiêu lớn, phân rã nhiệm vụ và tổng hợp kết quả [80].
2. **Search / Data Agent:** Chuyên trách thu thập thông tin và truy vấn MCP [80].
3. **Execution / Coding Agent:** Viết mã và chạy thử nghiệm trong môi trường cách ly (Sandbox) [80].
4. **Review / QC Agent:** Đọc kết quả, kiểm tra lỗi logic và đưa ra yêu cầu sửa lỗi cho Coding Agent [80].

---

## IX. CHECKLIST 8 ĐIỂM THEN CHỐT DÀNH CHO KỸ SƯ KHI BUILD DỰ ÁN AI

1. **LLM chỉ làm một việc:** Dự đoán token tiếp theo. Mọi giao diện phức tạp đều xây trên hàm xác suất điều kiện $P(X_t \mid X_{<t})$ [1, 17].
2. **Token $\neq$ Từ:** Cần nắm rõ cơ chế BPE để tính toán chính xác chi phí API và giới hạn Cửa sổ Ngữ cảnh [8, 9, 24].
3. **Transformer = Attention + MLP:** Attention trao đổi thông tin giữa các token; MLP xử lý phi tuyến độc lập từng vị trí [49, 50].
4. **Chuỗi Huấn luyện:** Pretraining tạo ra tri thức; SFT và RLHF tạo ra năng lực trợ lý và định hướng an toàn [16].
5. **Cấu hình Decoding:** Dùng Greedy/Low Temp cho tác vụ chính xác (Code/Math/JSON); dùng High Temp + Top-P cho tác vụ sáng tạo [41, 45, 46].
6. **In-context Learning:** Prompting thay đổi Hidden States qua Forward Pass chứ không hề cập nhật trọng số mô hình [40].
7. **Rào cản $O(T^2)$:** Ngữ cảnh càng dài chi phí càng tăng theo bình phương; cần tối ưu bằng RAG, FlashAttention hoặc nén context [76, 77, 78].
8. **Chuyển dịch sang Multi-Agent:** Không bắt một Model làm tất cả. Xây dựng mạng lưới các Agent chuyên biệt kết hợp với Tools và MCP để hoàn thành công việc phức tạp [80].

---
*Tài liệu được tổng hợp và chuẩn hóa theo tiêu chuẩn Kiến trúc Hệ thống cao cấp.*
