# Audit kết nối Argon — 2026-10-15

## Tiêu chí hoàn tất

Phải nhận được câu trả lời thật của `gemini-4-argon` qua cả backend, API online và Antigravity CLI.
Build thành công, model xuất hiện hoặc relay có heartbeat đều chưa đủ.

## Kết quả và thay đổi

| Lớp | Bằng chứng / trạng thái |
| --- | --- |
| Workspace auth | Khóa local đã được Production chấp nhận trong lần kiểm tra trước; lỗi phiên Google tách khỏi lỗi API_KEY. |
| Gemini Web qua Cookie | Có lần inference thật thành công, nhưng những lần sau bị chuyển đăng nhập / RPC 1016. Chưa đủ bằng chứng quy nguyên nhân cho IP Vercel hoặc Cookie hết hạn. |
| Browser session transport | Thêm transport chạy request cùng origin trong tab Gemini do người dùng ghép. Không xuất Cookie, không tự đăng nhập. Chưa kiểm chứng Chrome và inference thật. |
| Relay | Loopback có Bearer auth, giới hạn endpoint/header/body, timeout, hủy job khi đổi tài khoản, chặn origin website. Unit test đạt. |
| Provider | Token và danh sách model vẫn lấy từ Google. Không thêm model giả hoặc đổi tên model khác thành Argon. Unit test bảo toàn slot, model và HTTP error đạt. |
| Antigravity | MCP và launcher CLI đã có; kiểm thử tích hợp mô phỏng đạt. Cần chạy lại CLI thật với browser backend. |
| Vercel | Có gateway OpenAI và Gemini buffered SSE. Chưa chuyển sang browser backend; phải kiểm thử local trước, sau đó cung cấp backend HTTPS có xác thực. |

Go test toàn bộ và go vet đã đạt trong phiên audit. Sau khi thêm kiểm tra slot và cấu hình, kiểm thử provider/config và relay tiếp tục đạt.
Các kiểm thử tự động không sử dụng tài khoản Google thật.

## Bước thực hiện tiếp theo

1. Người dùng nạp tiện ích và ghép tab theo [BROWSER_RELAY.md](BROWSER_RELAY.md).
2. Kiểm tra `/state` có heartbeat, rồi chạy `check-connection.mjs --chat` và `run-agy.mjs` với backend local.
3. Nếu lỗi, phân tích phản hồi thực của tầng lỗi; không lặp lại yêu cầu đổi Cookie khi chưa có bằng chứng.
4. Chỉ sau khi local thành công mới tạo backend HTTPS, kiểm tra chat qua HTTPS và cấu hình Production upstream.
5. Kiểm tra API online, Antigravity qua online, gọi công cụ và ghép lại sau khi khởi động lại Chrome.

## Giới hạn vận hành

Browser relay cần máy, Chrome, tab ghép, Node relay và Go backend đang chạy; không vận hành khi máy ngủ.
Tunnel thử nghiệm thay đổi địa chỉ sau khi khởi động lại, không phải hosting ổn định.
Account slot thay đổi sẽ bị chặn; cần khởi tạo lại phiên backend phù hợp.
Không lưu khóa/Cookie trong repository hoặc log, không bỏ xác thực để che lỗi kết nối.
