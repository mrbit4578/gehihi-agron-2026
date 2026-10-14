# Audit Gehihi — 14/10/2026

## Phạm vi và cấu trúc

Đầu vào thư mục là ZIP `gemini-web-to-api-main.zip`. Đã đọc và lập inventory toàn bộ 82 file văn bản và metadata 4 PNG của bản gốc; inventory ghi kích thước, số dòng và các hàm để kiểm tra phạm vi. Đã truy vết cấu hình, HTTP entrypoints, provider/session, model discovery, upload/media, job stores, streaming/tool bridge, docs, examples và workflows. Đây không phải kiểm toán thâm nhập hay chứng nhận bảo mật độc lập.

- Backend gốc: Go, Fiber, Fx, req/v3; ba lớp protocol dùng cùng Gemini Web provider.
- Provider xác thực bằng cookie Gemini Web, lấy token từ trang Gemini rồi khám phá registry model của tài khoản.
- Media/deep research có vòng lặp nền và job store trong RAM.
- Bản web mới: HTML/CSS/JS với chat, model library, API examples và trạng thái; không thêm dependency frontend runtime.
- Hosting chung ở `internal/hosting`; local dùng Fiber Listen, Vercel dùng `api/index.go` qua net/http adaptor.
- Source ZIP được giữ riêng. Checkout dự án nằm trong `gehihi-agron-2026`, không sửa repository `Congchuc2026` ở thư mục cha.

## Phát hiện và xử lý

| Mức | Phát hiện | Xử lý |
|---|---|---|
| Cao | API gốc không xác thực người gọi; ai có URL cũng có thể dùng tài khoản Google của server. | Bắt buộc workspace API_KEY, constant-time digest compare; HTTP 503 nếu chưa cấu hình, 401 nếu khóa sai. Cả alias và đường dẫn khác chữ hoa đều được bảo vệ. |
| Cao | Lỗi transport sinh URL chứa token `at` trong log/API. | Tách nguyên nhân lỗi khỏi URL, bỏ log snippet response upstream. |
| Cao | Dependency x/text v0.37.0 có GO-2026-5970, scanner xác nhận code có gọi đường dẫn ảnh hưởng. | Nâng x/text và các dependency có bản vá; chạy lại scanner. |
| Trung bình | CORS mặc định wildcard. | Mặc định same-origin; chỉ bật CORS nếu ALLOWED_ORIGINS được khai báo rõ, bỏ wildcard. |
| Trung bình | Server khởi động yêu cầu cookie trước khi có thể xem trạng thái/giao diện. | UI hoạt động khi chưa có cookie; API fail closed và có chẩn đoán cấu hình. |
| Trung bình | Khởi tạo provider và refresh nền không phù hợp serverless. | Lazy init có bảo vệ đồng thời; tắt timer refresh trên Vercel, cache dùng thư mục tạm. |
| Trung bình | Job video / research trong RAM mất qua instance hoặc bị đóng băng sau request. | Chặn endpoint và đuôi model music trên Vercel với HTTP 501; giữ backend Docker cho các tác vụ này. |
| Trung bình | Cache cookie đọc trường thay đổi mà không khóa; Close gọi nhiều lần có thể panic. | Snapshot có khóa, lưu cache sau khi nhả khóa rotation, Close/refresh idempotent. |
| Trung bình | Research store trả con trỏ mà background worker có thể sửa. | Store sở hữu snapshot; get trả snapshot; tạo response trước khi chạy worker. |
| Trung bình | Body/HTML upstream chưa có giới hạn đọc tổng quát. | Body API 4 MiB; response khởi tạo/generation tối đa 32 MiB. |
| Trung bình | Workflows upstream tự gọi action review @main và tự release/scheduled image publish. | Thay bằng CI build/test/vet; Docker publish chỉ chạy thủ công. |
| Trung bình | Gateway có thể gửi khóa workspace/cookie của client sang upstream. | Chỉ gửi header cần thiết và khóa upstream của server; loại Set-Cookie của upstream khỏi response. |
| Thấp | Scalar CDN chưa pin, Swagger dùng host localhost và không khai báo khóa. | Pin Scalar, CSP cho docs; Swagger dùng origin hiện tại và khai báo workspace Authorization. |
| Thấp | `.env.local`, build output và Vercel state chưa có ignore rules. | Bổ sung Git/Docker/Vercel ignore; API_KEY local sinh bằng CSPRNG và không commit. |
| Thấp | Port/rate/retry chưa được giới hạn hợp lệ. | Kiểm tra port 1–65535, fallback cấu hình rate không hợp lệ, giới hạn retry. |

## Kiểm chứng và giới hạn

Kiểm tra Go/Node và HTTP local được chạy trong phiên thực hiện, kết quả cuối được cập nhật sau khi kết thúc. Tests mới kiểm tra 401/503, uppercase paths, 429, trạng thái công khai, proxy không làm lộ credential, URL gateway không an toàn, 501 serverless, cache lifecycle, research snapshots và Vercel handler rewrite.

Không có trình duyệt automation tương thích trong phiên này để xác nhận layout bằng screenshot. Kiểm tra HTTP local xác nhận HTML, CSS, JavaScript, health và status phục vụ được. Test -race local chưa chạy được vì máy Windows không có C compiler/cgo; CI Linux có bước -race. Live Gemini E2E chưa chạy vì GEMINI_COOKIES/gateway chưa được cung cấp. Chưa có bằng chứng account được cấp Gemini 4 Argon.

Vercel chưa deploy: người dùng chọn tự deploy. CLI đăng nhập có scope khác team trong link yêu cầu; không tạo project ở team khác. Hướng dẫn import và biến môi trường ở README.

Các giới hạn còn lại: rate limiter theo instance, cookie session có thể hết hạn, streaming gốc là chia nhỏ output sau khi generation hoàn tất, token usage gốc bằng 0, max_tokens/temperature không bảo đảm bởi Web, tool calling là prompt bridge, deep research chưa xác minh các nguồn qua browsing. Đây là các giới hạn của adapter Gemini Web được giữ và công bố, không phải khả năng tương đương hoàn toàn API Google chính thức.

## Nguồn xác minh

- [Vercel Go Functions](https://vercel.com/docs/functions/runtimes/go).
- [Google — Gemini 4 Argon trong Antigravity](https://antigravity.google/blog/gemini-4-argon-in-google-antigravity).
- [Gemini API model và giá](https://ai.google.dev/gemini-api/docs/latest-model).
- [Argon không có trong Antigravity IDE](https://antigravity.google/docs/ide/overview).
- [Go vulnerability GO-2026-5970](https://pkg.go.dev/vuln/GO-2026-5970).

DevRelay Community Wisdom gateway không có callable tool trong phiên; không tạo citation cộng đồng giả.

## Kết quả kiểm tra cuối

- `go test ./...`: pass sau khi nâng toàn bộ dependency. Live E2E bị skip có chủ đích khi `E2E` không được bật.
- `go vet ./...`: pass.
- `go build ./...`: pass.
- `npm run check`, `npm run build`: pass; static output gồm 4 assets, không có frontend runtime dependency.
- `govulncheck v1.9.0 -show verbose ./...` với Go 1.27.2: 0 lỗ hổng trong code được gọi, 0 lỗ hổng trong package được import. Còn cảnh báo module GO-2026-5932 ở package openpgp không được dự án import/gọi; không có bản vá cho package đã ngừng bảo trì đó.
- Dependency cuối: Fiber 3.4.0, req/v3 3.61.0, quic-go 0.61.0, uTLS 1.8.2, compress 1.19.2, x/net 0.60.0, x/crypto 0.57.0, x/text 0.42.0. Nâng HTTP client để tương thích API quic mới.
- Source scan: giá trị workspace API_KEY local và các mẫu GitHub/Google/private key không xuất hiện trong file publish; ignore rules được kiểm tra.
- HTTP local: `/`, `/styles.css`, `/app.js`, `/health`, `/status` đều trả 200.

## Sửa build Vercel: phạm vi import internal

Classic builder của Vercel đổi module root thành `handler` và import entrypoint qua `handler/api`. Entry `api/index.go` trước đây import trực tiếp `gemini-web-to-api/internal/commons/configs`, bị Go từ chối vì importer ở ngoài phạm vi internal của module gốc. Build Go thông thường và CI trước đó chưa mô phỏng phép đổi module này.

Đã chuyển khởi tạo HTTP handler vào package công khai `pkg/serverless`; API entrypoint chỉ gọi package công khai đó. Cấu hình, auth và backend vẫn nằm trong internal của module gốc. Thêm `npm run check:vercel` vào CI để tạo module/entrypoint giống Vercel, dùng cùng đường import và build bootstrap Linux. Kiểm tra này thất bại với đúng lỗi trên bản cũ, rồi pass sau sửa; `go test ./...`, `go vet ./...`, Node syntax checks và web build cũng pass. Chưa thay thế việc xác nhận deployment thực tế trên Vercel.
