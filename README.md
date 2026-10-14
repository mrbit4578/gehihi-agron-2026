# Gehihi — Gemini Workspace

Workspace tiếng Việt để chat, kiểm tra model và dùng API tương thích OpenAI. Backend Go được kế thừa từ [ntthanh2603/gemini-web-to-api](https://github.com/ntthanh2603/gemini-web-to-api), giữ bản quyền MIT và các bộ chuyển đổi Gemini / Claude / OpenAI.

## Deploy Vercel

Bạn tự triển khai bằng [Import repository](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmrbit4578%2Fgehihi-agron-2026). Chọn đúng team của bạn và repository `mrbit4578/gehihi-agron-2026`.

| Cấu hình | Giá trị |
|---|---|
| Root Directory | `./` |
| Framework Preset | Other |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `public` |
| Node.js | 22.x hoặc mới hơn |
| Go | Theo `go.mod` (1.27.2) |

`vercel.json` đã khai báo Go Function tại `api/index.go`, rewrites và thời gian tối đa 300 giây. Vercel hỗ trợ Go Functions trong thư mục `/api`; xem [tài liệu chính thức](https://vercel.com/docs/functions/runtimes/go).

Thêm biến môi trường vào **Production** (và **Preview** nếu cần):

| Biến | Vai trò |
|---|---|
| `API_KEY` | Khóa bảo vệ workspace. Dùng giá trị đã tạo trong `.env.local` hoặc một khóa ngẫu nhiên tối thiểu 32 byte. |
| `GEMINI_COOKIES` | Cookie request header đầy đủ của tài khoản Gemini Web của bạn. Chỉ lưu trong biến môi trường server. |
| `GEMINI_AUTH_USER` | Slot tài khoản, ví dụ `2` nếu URL request Gemini là `/u/2/`. Bỏ trống nếu URL không có slot. |
| `GEMINI_TEMPORARY` | `true` để yêu cầu phiên Gemini tạm thời. |
| `APP_ENV` | `production` |
| `RATE_LIMIT_ENABLED` | `true` |
| `RATE_LIMIT_WINDOW_MS` | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | `10` |

Nếu sử dụng một gateway Antigravity **đã có sẵn**, thay cấu hình cookie bằng `UPSTREAM_BASE_URL` (URL HTTPS API tương thích OpenAI, bao gồm `/v1`) và `UPSTREAM_API_KEY`. Gateway chỉ cung cấp các endpoint OpenAI; đây không phải API Antigravity chính thức và không tự tạo quyền truy cập model. URL localhost chỉ dùng được khi phát triển local, Vercel cần URL HTTPS có thể truy cập từ internet.

Có thể deploy giao diện trước khi nhập thông tin provider. `/status` hiển thị trạng thái cấu hình và API từ chối yêu cầu nếu thiếu khóa hoặc provider. Sau khi thay đổi biến môi trường, **Redeploy** để function nhận cấu hình mới. Giao diện cần nhập `API_KEY` của workspace để tải model.

### Gemini 4 Argon

Ứng dụng chỉ chọn `gemini-4-argon` nếu provider thực sự trả về model đó; tên và model thực tế được giữ trong phản hồi. Google công bố Argon trên Antigravity cho AI Ultra / Enterprise đủ điều kiện, và API chính thức có tính phí: [Antigravity](https://antigravity.google/blog/gemini-4-argon-in-google-antigravity), [Gemini API](https://ai.google.dev/gemini-api/docs/latest-model). Không có bằng chứng API Argon miễn phí được tài khoản này cấp quyền. Cookie Gemini Web và thông tin xác thực Antigravity là hai cơ chế khác nhau.

Antigravity IDE 1.107.0 đang có trên máy không cung cấp API serving qua CLI. [Google ghi rõ Argon không có trong Antigravity IDE](https://antigravity.google/docs/ide/overview); cần Antigravity app / CLI mới hoặc IDE extension phù hợp cùng quyền tài khoản.

### Giới hạn Vercel

Chat đồng bộ, model discovery và các protocol chat được giữ lại. Video, âm nhạc, tạo ảnh qua endpoint riêng và deep research bị chặn với HTTP 501 trong chế độ serverless: các job lưu trong RAM và vòng lặp nền không bền qua nhiều function instance. Đuôi model `-music` cũng bị chặn. Chạy backend Docker liên tục nếu cần những chức năng này. Cookie cache ở Vercel nằm trong thư mục tạm, không phải nơi lưu trữ lâu dài. Giới hạn request trong RAM áp dụng theo instance; thêm Vercel Firewall nếu cần quota chung giữa nhiều instance.

## Chạy local

Cần Go 1.27.2+ và Node.js 22+. Trong máy hiện tại, Go đã được đặt tại `../tools/go/bin/`.

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm ci
npm run build
go run ./cmd/server
```

Hoặc chạy `powershell -File scripts/run-local.ps1`, script tự tìm Go trên PATH hoặc trong thư mục tools của workspace này.

Mở `http://127.0.0.1:4981`. `API_KEY` trong `.env.local` là khóa workspace, không phải khóa Google. Tab chỉ giữ khóa trong RAM, không sử dụng localStorage. Cookie Google không đi qua giao diện web.

Để cấu hình Gemini Web: đăng nhập `gemini.google.com`, mở DevTools → Network, chọn request `batchexecute?rpcids=otAQ7b` và sao chép **Cookie request header** vào `GEMINI_COOKIES` trong `.env.local`. Điền slot từ cùng request vào `GEMINI_AUTH_USER`. Cookie có thể hết hạn hoặc bị Google từ chối; model được giới hạn theo tài khoản. `.env.local`, `.cookies/`, `.vercel/` và build artifacts đều được loại khỏi Git và gói deploy.

## API

- `GET /health`: server đang hoạt động, không đồng nghĩa provider đã xác thực.
- `GET /status`: cấu hình provider / khóa, không trả giá trị bí mật.
- `GET /openai/v1/models`: model thật từ tài khoản, cần khóa workspace.
- `POST /openai/v1/chat/completions`: API chat tương thích OpenAI.
- `/v1/*`: alias OpenAI cho các công cụ chỉ chấp nhận `/v1`.
- `/claude/v1/*`, `/gemini/v1beta/*`: protocol gốc trong chế độ Gemini Web.
- `/docs`: tài liệu Swagger với cấu hình Authorization.

```python
import os
from openai import OpenAI
client = OpenAI(base_url="https://YOUR_DEPLOYMENT.vercel.app/openai/v1", api_key=os.environ["API_KEY"])
models = client.models.list()
print([model.id for model in models])
response = client.chat.completions.create(
    model=models.data[0].id,
    messages=[{"role":"user", "content":"Xin chào!"}],
)
print(response.model, response.choices[0].message.content)
```

Header được chấp nhận: `Authorization: Bearer <API_KEY>`, `x-api-key`, `x-goog-api-key`. Khóa trong query string không được chấp nhận. Các examples Python yêu cầu biến môi trường `API_KEY`; các endpoint media cần backend liên tục. Tool calling ở backend gốc là một cầu nối bằng prompt; SSE chia nhỏ phản hồi sau khi upstream hoàn tất, không phải token streaming thật. Giới hạn `max_tokens` / temperature không được Gemini Web bảo đảm như API chính thức. Deep research gốc tạo báo cáo nhiều bước bằng LLM; các đường dẫn nguồn chưa được hệ thống duyệt và xác minh độc lập.

## Kiểm tra

```powershell
npm run check
npm run build
go test ./...
go vet ./...
go build ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

GitHub Actions chạy thêm `go test -race ./...` trên Linux. Live E2E là opt-in (`E2E=1`) và sẽ sử dụng quota thật của tài khoản; chưa chạy khi không có thông tin xác thực. Không đồng nhất kết quả mocked tests với một request Gemini 4 Argon thành công.

Xem [báo cáo audit](docs/AUDIT.md), [inventory mã nguồn ZIP](docs/source-inventory.json), và [README gốc](docs/UPSTREAM_README.md).
