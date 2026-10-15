# Gehihi → phiên Gemini trong Chrome → Argon

Đường kết nối tùy chọn cho trường hợp Cookie xuất ra ngoài trình duyệt không dùng được ổn định.
Chế độ này phải được kiểm thử với tab Gemini thực; unit test không chứng minh tài khoản có Argon.

## Cơ chế và quyền

- Go backend dùng `GEMINI_BROWSER_RELAY_URL=http://127.0.0.1:54985`.
- Relay chỉ lắng nghe loopback, xác thực bằng `API_KEY` workspace.
- Tiện ích ghép đúng một tab `https://gemini.google.com` do người dùng chọn.
- Request Google chạy bằng `fetch` trong trang đó. Chrome quản lý phiên đăng nhập; không đọc/export Cookie.
- Không có quyền `cookies`, `webRequest`, `debugger` hoặc `<all_urls>`.
- Quyền `scripting` chạy hàm fetch tại trang Gemini; `storage` giữ khóa trong `chrome.storage.session`;
  `alarms` duy trì việc nhận công việc khi tab chạy nền. Khóa workspace không được đưa vào trang Google.
- Quyền loopback của tiện ích cho phép host 127.0.0.1; mã chỉ truy cập cổng cố định 54985.
- Đích Google giới hạn ở trang app, RPC `otAQ7b` và endpoint `StreamGenerate`.
  Các request thay đổi tài khoản, website khác và header Cookie/Authorization bị chặn/lọc.
- Khóa được xóa khi phiên Chrome kết thúc hoặc khi ngắt ghép; không nhúng khóa vào source/config tiện ích.
- Không tự đăng nhập hoặc giải CAPTCHA. Cần tài khoản đã chat được Argon trong tab được ghép.

## Chuẩn bị và ghép tab

1. Chạy relay trong thư mục repository:

   ```powershell
   node integrations/browser-relay/server.mjs
   ```

2. Trong terminal thứ hai, chạy backend đã build:

   ```powershell
   $env:GEMINI_BROWSER_RELAY_URL='http://127.0.0.1:54985'
   $env:GEHIHI_BIND_HOST='127.0.0.1'
   $env:PORT='54984'
   .\bin\gehihi-browser-backend.exe
   ```

   Có thể build bằng `go build -o bin/gehihi-browser-backend.exe ./cmd/server`.
   Cookie cũ trong `.env.local` không dùng cho HTTP Google ở chế độ này.

3. Chrome → `chrome://extensions` → Developer mode → Load unpacked.
   Chọn thư mục `integrations/browser-relay/extension` trong repository.
4. Mở tab Gemini đang đăng nhập và chọn Argon. Mở tiện ích **Gehihi Gemini Session Bridge**.
5. Dán `API_KEY` của workspace vào popup, bấm **Kết nối tab Gemini hiện tại**.
   `scripts/browser-pairing-helper.ps1` cung cấp nút chép đúng thư mục và khóa, không hiện khóa ra terminal.
6. Giữ Chrome và tab đó mở. Không đổi tài khoản trong lúc request đang chạy.
   Sau khi Chrome khởi động lại cần ghép lại khóa; máy ngủ không xử lý được request.

## Kiểm chứng thật

```powershell
$env:GEHIHI_BASE_URL='http://127.0.0.1:54984/openai/v1'
node integrations/antigravity/check-connection.mjs --chat
node integrations/antigravity/run-agy.mjs -p 'Chỉ trả lời một câu ngắn xác nhận kết nối Argon.'
```

Phải thấy `gemini-4-argon` trong danh sách provider và câu trả lời thật.
Trạng thái “đã ghép tab” chỉ chứng minh relay nhận heartbeat, không chứng minh inference thành công.
Khi chưa ghép, backend trả `browser_bridge_offline`, không tạo danh sách model giả.

## Giảm độ trễ khi dùng trên cùng máy

```powershell
node .\integrations\antigravity\run-agy.mjs --local
```

Hoặc chọn terminal profile **Gehihi Argon local** sau khi chạy `run-agy.mjs --setup`.
`--local` đặt đồng thời endpoint preflight OpenAI và endpoint Gemini về backend 54984,
giữ nguyên Argon và xác thực workspace. Cờ này không được chuyển cho agy.
Nếu backend local tắt, launcher báo lỗi; không âm thầm gửi sang endpoint khác.
Không có `--local` thì launcher vẫn dùng cấu hình online hiện có.

Tiện ích 1.1.0 dùng long poll tối đa 20 giây: server trả ngay khi có job, không chờ đủ 20 giây.
Sau mỗi lượt, tiện ích nối lại; alarm vẫn phục hồi khi worker/tab bị dừng.
Relay hỗ trợ tiện ích cũ, nhưng cần tải lại tại `chrome://extensions` để bật cơ chế mới.
Không giảm thời gian suy luận của Google hoặc giả lập token: browser transport hiện đợi toàn bộ
response trước khi gửi về Go. Gateway Vercel cũng dùng buffered SSE, nên câu dài chưa xuất hiện từng token.

Lượt đo 2026-10-15 với cùng prompt ngắn: local 23,5 giây, Vercel 31,7 giây trước thay đổi tiện ích.
Đây là một cặp mẫu, không phải cam kết tăng tốc hay benchmark ổn định; tải model và lịch Chrome có thể thay đổi.
Launcher `--local` sau thay đổi đã trả lời thật trong 19,1 giây (bao gồm khởi động CLI).
Số này chưa đo tác động của tiện ích 1.1.0 trên tab nền; cần người dùng tải lại tiện ích trước.

## Vercel

Browser relay chạy trên máy, không chạy trên Vercel. Chỉ sau khi local và CLI chat thật thành công,
mới cung cấp backend qua một HTTPS endpoint có xác thực và cấu hình Production:

```dotenv
UPSTREAM_BASE_URL=https://backend.example/openai/v1
UPSTREAM_GEMINI_BASE_URL=https://backend.example/gemini/v1beta
UPSTREAM_API_KEY=<khóa workspace của backend>
```

Không đặt `GEMINI_BROWSER_RELAY_URL` loopback trên Vercel.
Gateway Gemini trả lời theo dạng buffered SSE; backend/tunnel chỉ vận chuyển JSON.
Tunnel thử nghiệm có địa chỉ thay đổi khi khởi động lại và không có bảo đảm uptime;
không coi việc mở một tunnel là đã triển khai xong môi trường ổn định.

Tài liệu API Chrome: [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts),
[alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms).
