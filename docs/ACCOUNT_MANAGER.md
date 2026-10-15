# Quản lý tài khoản Gemini cho web và Antigravity

Mở `/#accounts`, nhập khóa workspace qua Cấu hình kết nối rồi tải danh sách.
Trang vẫn quản lý tài khoản được khi provider chưa khởi tạo; xác thực workspace là bắt buộc.

## Thêm và chuyển tài khoản

1. Đăng nhập Gemini ngoài web Gehihi và gửi một tin thành công bằng tài khoản cần dùng.
2. Sao chép toàn bộ giá trị **Cookie request header** từ request Gemini trong Network, không phải Response hay cURL.
3. Trong Gehihi → Tài khoản & độ trễ, nhập tên, Cookie, slot khớp request (`/u/2/` → `2`; không có slot thì để trống).
4. Bấm Kiểm tra & thêm. Nếu bật Dùng ngay, backend chỉ chọn tài khoản sau khi xác minh có đúng `gemini-4-argon`.
5. Antigravity local và qua Vercel cùng dùng backend đó, không đổi API key hoặc cài lại MCP.
   Đổi thủ công có hiệu lực ở request tiếp theo; mở cuộc trò chuyện mới để tránh mang ngữ cảnh cũ sang tài khoản khác.

Cookie đã lưu nhưng Google từ chối sẽ hiện mã lỗi; tài khoản đang chạy vẫn được giữ nguyên.
Phiên Cookie độc lập với phiên Chrome đã ghép: tab chat được không chứng minh Cookie xuất ra ngoài Chrome chạy được.
Để thay Cookie, xóa bản cũ rồi thêm lại. Chỉ xóa được khi không kiểm tra hoặc chạy request trên tài khoản đó.

## Xoay tự động

- Cần ít nhất hai tài khoản Cookie đã xác minh có Argon, sau đó bấm Bật xoay tự động.
- Xoay lần lượt ở cuộc trò chuyện mới. Backend dùng hash tin nhắn user mở đầu trong lịch sử để giữ cùng tài khoản cho các lượt tiếp theo và gọi công cụ; không lưu nội dung prompt vào bảng ghim.
- Hai lịch sử có cùng tin mở đầu có thể dùng chung tài khoản. Không phải định danh phiên Google hay tài khoản của người dùng cuối.
- Tối đa 512 lịch sử được ghim mỗi phiên quản lý; khi đầy cần tắt/bật lại xoay vào lúc không còn phiên agent đang chạy.
- Request lỗi không được phát lại trên tài khoản khác. HTTP 429 đánh dấu tài khoản bị giới hạn; cần kiểm tra lại sau khi hết giới hạn. Một lịch sử đã ghim không tự chuyển sang tài khoản khác nếu tài khoản cũ lỗi.
- Chọn thủ công hoặc thêm tài khoản với Dùng ngay sẽ tắt xoay và xóa bảng ghim. Đây là workspace dùng chung: thay đổi ảnh hưởng mọi client có cùng API key.

## Credit và độ trễ

Hiện chưa tích hợp nguồn số dư credit được xác minh từ Google, nên API trả `remaining: null` và giao diện ghi Chưa có dữ liệu.
Không coi số model, số lượt gọi hoặc thời gian phản hồi là credit/hạn mức còn lại.
Google mô tả hạn mức Gemini Apps theo loại tài khoản, model và thời gian sử dụng; xem [Gemini Apps limits](https://support.google.com/gemini/answer/16275805?hl=en).

Thời gian API quản lý trên web là RTT từ trình duyệt qua Vercel tới backend.
Độ trễ gần nhất/trung bình theo tài khoản đo từ lúc backend bắt đầu request tới lúc hoàn tất, gồm suy luận và hàng đợi relay, không gồm đường mạng từ client tới backend.
Phản hồi SSE được buffer trên backend để tính thời gian hoàn tất và giữ byte SSE; không có hiển thị từng token.
Số lượt và lỗi đếm HTTP request sinh nội dung; lỗi trong SSE HTTP 200 có thể không tăng bộ đếm lỗi HTTP.
Thống kê reset khi backend khởi động lại, không phải dữ liệu billing từ Google.

## Lưu trữ và bảo mật

- API quản lý `/openai/v1/accounts` dùng cùng Bearer API_KEY của workspace. Không chia sẻ khóa đó với người không được quản lý phiên Google.
- Cookie chỉ đi qua request POST; không trả lại từ list/select/verify, không lưu localStorage/sessionStorage hay nhúng vào HTML.
- Backend trên máy lưu AES-256-GCM tại `GEHIHI_ACCOUNT_STORE` (mặc định `.accounts/vault.enc`), khóa dẫn xuất từ API_KEY workspace bằng SHA-256 có domain separator.
- Đổi API_KEY làm vault cũ không đọc được; phải giữ khóa cũ để mở lại hoặc chủ động tạo lại kho từ Cookie mới. Không coi vault mã hóa là bảo vệ nếu máy hoặc API_KEY đã bị chiếm.
- Vault và file tạm được loại khỏi Git, Vercel upload và Docker build context. Client của tài khoản Cookie quản lý không ghi cache Cookie plaintext và không chạy refresh nền.
- Sau khi backend restart, Cookie được khôi phục ở trạng thái Cần kiểm tra; chọn lại sau khi xác minh. Mặc định quay về phiên cấu hình trên máy, tắt xoay để tránh dùng nhầm phiên chưa kiểm chứng.
- Vercel chỉ proxy API tới backend đang chạy; không lưu Cookie vào biến môi trường Vercel, không cần redeploy mỗi lần thêm/chọn tài khoản.

## Kiểm chứng

Các kiểm thử backend dùng hai tài khoản mô phỏng để kiểm tra xoay, ghim lịch sử, không replay HTTP 429, không rò Cookie, mã hóa/chống sửa vault, khôi phục/xóa và SSE/độ trễ.
Không coi các kiểm thử đó là bằng chứng hai tài khoản Google thật đã được cấp Argon; cần nhập và xác minh các Cookie thật của người dùng.

Kiểm chứng triển khai 2026-10-15:

- Go test toàn bộ, go vet và 14 kiểm thử Node đạt; bootstrap Linux theo cách rewrite module của Vercel biên dịch đạt.
- Kiểm thử race local không chạy được vì Go trên máy đang tắt CGO và chưa có compiler C trong PATH; không ghi nhận là đã đạt race detector.
- Vercel đã triển khai màn hình `/#accounts`; API online list/select trả 200 với khóa đúng, thiếu khóa trả 401, bật xoay khi chưa đủ hai tài khoản trả 409.
- Cookie trong file local bị Google trả `account_models_unavailable` và không được kích hoạt. Bản ghi thử đã được xóa; phiên Chrome mặc định được giữ lại.
- Backend mới đã trả lời Argon thật qua MCP ở lần thử local. Lần thử Antigravity qua tunnel sau triển khai gặp HTTP 524 khi có nhiều request đang chờ; chưa xác nhận đã khắc phục timeout tunnel. Có thể dùng launcher `--local` trên cùng máy để tránh chặng tunnel.
- Tại lần kiểm tra sau khi người dùng báo đã thêm hai tài khoản, cả API local và online vẫn chỉ trả một bản ghi `default`; chưa thể xác nhận xoay hai tài khoản Google thật.
- Công cụ Browser hiện chỉ có backend MCP Apps với danh sách tab trống, nên chưa kiểm tra trực quan giao diện trong trình duyệt; đã kiểm tra HTML/JS/CSS được phục vụ đúng trên Production.
