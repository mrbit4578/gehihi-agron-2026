# Audit tham chiếu SYSTEM FAILURE cho Gehihi–Argon

Ngày: 15/10/2026 (Asia/Saigon). Phạm vi đã xác nhận: tiếp tục Gehihi–Argon;
không chuyển sang xây ứng dụng phim riêng và không sửa tệp HTML gốc.

## Nguồn và giới hạn bằng chứng

- Nguồn: `E:\SYSTEM FAILURE - Procedural Sci-Fi Short Film.html`.
- 132.666 byte, 3.080 dòng; một script nội tuyến, hai script CDN.
- SHA-256: `6c89afbe62f2091915b5f7f89cafaaca659cfca359a11bb64301fea19427ca0f`.
- Đã đọc toàn bộ HTML, CSS, JavaScript và shader nhúng.
- JavaScript parse thành công; không trùng ID, không thiếu ID được gọi bằng `getElementById` với tên cố định.
- Không có lời gọi `fetch`, XHR, WebSocket, EventSource hoặc cấu hình Gemini/Argon trong script nội tuyến.
- Không có Cookie, API key, CSRF token hay endpoint Gemini có thể lấy từ tệp để sửa xác thực.
- Chưa kiểm thử hình ảnh WebGL và âm thanh thực tế trong trình duyệt. Không xem syntax pass là render pass.

Kiểm tra tĩnh có thể chạy lại, không thực thi mã tài liệu:

```powershell
node scripts/audit-reference-html.mjs "E:\SYSTEM FAILURE - Procedural Sci-Fi Short Film.html"
```

## Cấu trúc

| Khối | Dòng bắt đầu | Trách nhiệm |
|---|---:|---|
| Head, CSS và giao diện | 1 | Nạp Tailwind CDN, Three.js r128, Google Fonts; menu, timeline, hộp hướng dẫn |
| `SeededRandom`, `CMath` | 348 | PRNG Mulberry32 và nội suy theo thời gian |
| `ProceduralAudioEngine` | 398 | Tổng hợp âm thanh Web Audio, drone/pad/noise và hiệu ứng từng cảnh |
| `PostProcessingPipeline` | 857 | Render target và shader bloom, nhiễu, viền tối, glitch |
| `QuantumAndRoomSystem` | 1016 | Hạt, khối lập phương, 512 mô-đun tạo phòng |
| `ProceduralCitySystem` | 1564 | Công trình và giao thông dùng instancing |
| `CosmicUniverseSystem` | 2034 | Hành tinh, khí quyển, tiểu hành tinh và sao |
| `CinematicCameraController` | 2424 | Camera theo tám cảnh và các mốc thời gian |
| `NarrativeOverlayController` | 2605 | Chữ giả terminal và cảnh báo theo kịch bản |
| `SystemFailureFilmDirector` | 2746 | Điều phối render loop, playback, chất lượng, phím tắt |

Phim chạy 190 giây, tám cảnh bắt đầu tại 0, 15, 38, 63, 95, 125, 145 và 175 giây.
Đây là dựng hình bằng mã trong trình duyệt; không phải file video và không phải client gọi model.
Những dòng “SYSTEM INITIALIZATION”, “STATUS: OPERATIONAL”, “SIMULATION STABILITY: 100%”
là nội dung kịch bản, không phải kết quả kiểm tra hệ thống thực.

## Phát hiện trong tệp tham chiếu

| Mức | Vị trí | Phát hiện và tác động |
|---|---|---|
| P1 | `buildWorld`, dòng 2802 | Chỉ `scene.remove` ba nhóm cũ, không dispose geometry/material. Thay chất lượng nhiều lần để lại tài nguyên GPU cũ. |
| P1 | Nhánh cuối phim trong `QuantumAndRoomSystem.update` và replay/tua lại | Scale khối đã bị thu nhỏ ở cuối phim không được trả về 1 khi quay lại cảnh sớm. Kiểm tra logic bằng Three r128: scale tại giây 20 ban đầu = 1; sau 174,5 → 20 còn khoảng 0,011999. |
| P1 | `returnToMenu` dòng 2870 và `animate` dòng 3060 | Menu đặt `hasStarted=false`; nhánh cập nhật âm thanh sau đó bị bỏ qua. Không gọi pause/suspend hoặc hạ gain khi về menu. Kiểm tra handler và vòng animate: số lần cập nhật tắt âm thanh = 0. |
| P2 | Shader dòng 978, 1167, 2378 và các vị trí khác | Nhiều `smoothstep` đảo hai cạnh. GLSL không xác định kết quả khi `edge0 >= edge1`; cần dùng `1.0 - smoothstep(cạnh_nhỏ, cạnh_lớn, x)`. Đây là vấn đề tương thích shader, chưa phải kết quả render được quan sát. |
| P2 | Shader hành tinh, dòng 2075–2150 | Normal đi qua `normalMatrix` ở view space nhưng ánh sáng và view direction được tính trong world space. Cần thống nhất hệ tọa độ trước khi so sánh kết quả hình ảnh. |
| P2 | Phụ thuộc ở dòng 7–11; bootstrap dòng 3075 | Cần CDN cho JS/CSS/font; thiếu trạng thái báo lỗi khi Three/WebGL không nạp được. Mô tả “zero external assets” cần phân biệt tài nguyên media với thư viện/font ngoài. |
| P2 | Hộp “PROJECT FILES & README”, dòng 288–334 | `package.json`, `tsconfig.json`, `vite.config.ts` chỉ nằm trong thẻ `pre`. Không có bộ dự án Vite/TypeScript thật được cung cấp kèm HTML này. |
| P3 | Dòng 531–576 | Các bộ cảnh dùng seed nhưng âm thanh dùng `Math.random`; không thể nói toàn bộ phim/âm thanh tái lập hoàn toàn theo seed. |
| Có điều kiện | Toàn bộ script | Chưa có MediaRecorder/captureStream/VideoEncoder. Nếu muốn xuất phim thì đó là chức năng cần bổ sung, không phải khả năng đã có của tệp. |

Các phép tái hiện logic dùng source Three.js r128 từ tag chính thức và stub cho DOM/audio/render,
không đo VRAM hay chạy GPU. Chúng xác nhận thiếu reset/cập nhật trạng thái, không chứng minh
chất lượng hình ảnh hay âm thanh trên mọi thiết bị.

Tài liệu đối chiếu:

- [Three.js: dispose tài nguyên](https://threejs.org/manual/pages/how-to-dispose-of-objects.html).
- [GLSL 1.20, định nghĩa smoothstep](https://registry.khronos.org/OpenGL/specs/gl/GLSLangSpec.1.20.pdf).
- [Tailwind Play CDN chỉ dành cho phát triển](https://tailwindcss.com/docs/installation/play-cdn).

## Thông tin dùng được cho Gehihi–Argon

1. Mẫu đầu ra cần hỗ trợ: một tài liệu HTML có JS và GLSL dài, giữ nguyên code fence,
   dấu nháy, template literal và ký tự xuống dòng. Không cần chèn Three/Tailwind vào UI Gehihi.
2. Tệp có thể dùng làm đầu vào cho yêu cầu audit/sửa code qua Argon sau khi kết nối ổn định.
   Không coi việc xem được phim là bằng chứng API model đã kết nối.
3. Các trạng thái terminal của phim chỉ nên tham khảo cách trình bày. Trạng thái Gehihi phải
   tiếp tục dựa trên HTTP, model do provider trả về và câu trả lời thực.
4. Không dùng tệp này để suy ra `gemini-4-argon`, Cookie hay quyền truy cập tài khoản.
   Bằng chứng về model đến từ phản hồi `otAQ7b` đã cung cấp riêng, không phải HTML.

## Tình trạng kết nối và việc còn lại

- Kiểm tra online trong lần audit này: `/status` HTTP 200, provider `gemini-web`, chưa ready;
  `/openai/v1/models` HTTP 503, `account_models_unavailable`, mã tài khoản 1016.
- Trước đó đã có một phép chat Go local trả về model `gemini-4-argon` và câu trả lời thật.
  Những lần chạy sau cũng có local bị từ chối; vì vậy chưa đủ bằng chứng quy nguyên nhân chỉ cho Vercel/IP.
- Có endpoint xác thực `/openai/v1/connection-check` đối chiếu SHA-256 trong request và chỉ trả
  boolean khớp Cookie cùng slot. Không trả Cookie, hash hay API key. Cấu hình khớp không chứng minh phiên được Google chấp nhận.
- Cầu nối MCP và launcher Antigravity CLI đã có. Cài npm/setup thành công không chứng minh model inference thành công.
- Phần gateway Gemini bổ sung từ phiên trước là lựa chọn cấu hình riêng, không tự bật và chưa có bằng chứng
  toàn tuyến Argon thật qua tunnel. Không đổi Production sang tunnel chỉ vì unit test đi qua.

Các thay đổi thực hiện sau audit:

- Tách lựa chọn token chính `SNlM0e` khỏi `thykhd`: trường dự phòng không còn thắng chỉ vì xuất hiện sớm hơn.
  Kiểm thử bao gồm hai thứ tự property và trường chính trong mảng. Chưa chứng minh đây là nguyên nhân của 1016 trên phiên thật.
- Hoàn thiện và kiểm thử gateway Gemini tùy chọn đã có trong working tree: JSON backend → một SSE event,
  giữ nguyên phản hồi/function call, giữ nguyên lỗi provider, chặn URL chứa credential/query và HTTP không an toàn.
  Không tự đổi cấu hình provider Production.
- Thêm lệnh audit HTML không thực thi mã tham chiếu; không đưa HTML gốc, Cookie hoặc khóa vào Git.

Điều kiện hoàn tất cần kiểm chứng theo thứ tự:

1. Provider trả model Argon từ phiên hiện tại, qua chính API sẽ dùng thực tế.
2. API online trả một câu chat Argon, với tên model và nội dung do provider trả về.
3. Cùng endpoint đó hoạt động từ MCP trong Antigravity.
4. Antigravity CLI nhận được câu trả lời qua Gemini wire format; kiểm tra thêm một vòng gọi tool và trả tool result.
5. Thử lại sau khi khởi tạo lại phiên/backend để phân biệt thành công một lần với kết nối có thể sử dụng lặp lại.
6. Sau đó mới dùng HTML tham chiếu để kiểm tra tác vụ sinh/audit code dài.

Không hoàn thành dự án bằng cách bỏ kiểm tra 1016, bịa danh sách model, đổi nhãn model khác thành Argon,
hoặc báo kết nối thành công chỉ từ `/health`, build xanh hay cấu hình đã được nhập.
