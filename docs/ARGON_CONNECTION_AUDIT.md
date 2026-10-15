# Audit kết nối Argon — 2026-10-15

## Tiêu chí hoàn tất

Phải nhận được câu trả lời thật của `gemini-4-argon` qua cả backend, API online và Antigravity CLI.
Build thành công, model xuất hiện hoặc relay có heartbeat đều chưa đủ.

## Kết quả và thay đổi

| Lớp | Bằng chứng / trạng thái |
| --- | --- |
| Workspace auth | Khóa local đã được Production chấp nhận trong lần kiểm tra trước; lỗi phiên Google tách khỏi lỗi API_KEY. |
| Gemini Web qua Cookie | Có lần inference thật thành công, nhưng những lần sau bị chuyển đăng nhập / RPC 1016. Chưa đủ bằng chứng quy nguyên nhân cho IP Vercel hoặc Cookie hết hạn. |
| Browser session transport | Đã ghép Chrome slot mặc định và nhận câu trả lời thật của `gemini-4-argon` qua MCP. Không xuất Cookie, không tự đăng nhập. |
| Relay | Loopback có Bearer auth, giới hạn endpoint/header/body, timeout, hủy job khi đổi tài khoản, chặn origin website. Unit test đạt. |
| Provider | Token và danh sách model vẫn lấy từ Google. Không thêm model giả hoặc đổi tên model khác thành Argon. Unit test bảo toàn slot, model và HTTP error đạt. |
| Antigravity | CLI thật trả “Kết nối Argon đã được thiết lập thành công.” khi gọi browser backend local. |
| HTTPS và gateway | Chat MCP qua tunnel HTTPS thật đạt. CLI qua gateway Gemini buffered SSE → tunnel → browser backend trả “Đã nhận được request qua gateway thành công.” |
| Vercel | Chủ tài khoản đã cập nhật ba biến upstream và redeploy. MCP qua `https://gehihi-agron-2026-one.vercel.app` xác thực thành công, nhận đúng `gemini-4-argon` và câu trả lời thật. |
| Antigravity qua Vercel | CLI thật exit 0, trả “Đã nhận yêu cầu của bạn qua web Vercel thành công.” Luồng Gemini buffered SSE đã đi qua domain Production, tunnel HTTPS và tab Chrome. |

Go test toàn bộ và go vet đã đạt trong phiên audit. Sau khi thêm kiểm tra slot và cấu hình, kiểm thử provider/config và relay tiếp tục đạt.
Các kiểm thử tự động không sử dụng tài khoản Google thật.

## Kết luận và vận hành tiếp

Kết nối giao thức đã được kiểm chứng bằng inference thật từ MCP và Antigravity CLI qua Production.
Đây là kết quả của phiên đang chạy, chưa phải bảo đảm vận hành 24/7 hoặc tự khôi phục sau restart.
Lần thử CLI qua gateway local yêu cầu đọc `package.json` đã trả đúng tên `gehihi-agron-2026`;
chưa kiểm thử riêng tool round-trip qua Production hoặc khởi động lại Chrome.

Trong Antigravity IDE, mở menu Terminal → New Terminal → chọn profile **Gehihi Argon**.
Profile gọi launcher dùng domain Production theo mặc định. MCP server `gehihi` cũng dùng domain đó.
Nếu terminal cũ có `GEHIHI_BASE_URL` đặt local, xóa biến override hoặc mở terminal mới trước khi chạy launcher.
Danh sách model chính của IDE do Antigravity quản lý; profile CLI và công cụ MCP là hai lối sử dụng cầu nối.

Nếu lỗi, phân tích phản hồi thực của tầng lỗi; không lặp lại yêu cầu đổi Cookie khi chưa có bằng chứng.

## Giới hạn vận hành

Browser relay cần máy, Chrome, tab ghép, Node relay và Go backend đang chạy; không vận hành khi máy ngủ.
Tunnel thử nghiệm thay đổi địa chỉ sau khi khởi động lại, không phải hosting ổn định.
Account slot thay đổi sẽ bị chặn; cần khởi tạo lại phiên backend phù hợp.
Không lưu khóa/Cookie trong repository hoặc log, không bỏ xác thực để che lỗi kết nối.
