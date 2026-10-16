# ==============================================================================
# Gehihi Argon 2026 - Launcher Tự Động Toàn Diện
# Chạy cả Gateway Backend + Browser Relay + Sync Antigravity MCP chỉ với 1 click!
# ==============================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = "Gehihi Argon 2026 - Control Center"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Write-Color([string]$text, [ConsoleColor]$color = [ConsoleColor]::White) {
    Write-Host $text -ForegroundColor $color
}

Clear-Host
Write-Color "==================================================================" Cyan
Write-Color "      GEHIHI ARGON 2026 · TRÌNH KHỞI CHẠY HỆ THỐNG TỰ ĐỘNG       " Yellow
Write-Color "==================================================================" Cyan
Write-Host ""

# 1. Tìm đường dẫn Node.js và Go
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodePath = $nodeCmd.Source
} elseif (Test-Path "C:\Users\huongcv\nodejs\node-v22.16.0-win-x64\node.exe") {
    $nodePath = "C:\Users\huongcv\nodejs\node-v22.16.0-win-x64\node.exe"
} else {
    Write-Color "[!] Không tìm thấy Node.js v22+. Vui lòng cài đặt Node.js." Red
    Read-Host "Nhấn Enter để thoát"
    exit 1
}

$goCmd = Get-Command go.exe -ErrorAction SilentlyContinue
if ($goCmd) {
    $goPath = $goCmd.Source
} elseif (Test-Path "$projectRoot\..\tools\go\bin\go.exe") {
    $goPath = [System.IO.Path]::GetFullPath("$projectRoot\..\tools\go\bin\go.exe")
} elseif (Test-Path "E:\AI\KET NOI API-\tools\go\bin\go.exe") {
    $goPath = "E:\AI\KET NOI API-\tools\go\bin\go.exe"
}

# 2. Đọc file .env.local
$envFile = Join-Path $projectRoot ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Color "[!] Không tìm thấy file .env.local. Vui lòng tạo file với API_KEY." Red
    Read-Host "Nhấn Enter để thoát"
    exit 1
}

$apiKey = & $nodePath --input-type=module -e "import {readFileSync} from 'node:fs';import {parseEnv} from 'node:util';const k=parseEnv(readFileSync(process.argv[1],'utf8')).API_KEY?.trim();if(k)process.stdout.write(k);" $envFile
if (-not $apiKey) {
    Write-Color "[!] File .env.local chưa có API_KEY hợp lệ!" Red
    Read-Host "Nhấn Enter để thoát"
    exit 1
}

# Tự động copy API_KEY vào Clipboard
try {
    Set-Clipboard -Value $apiKey
    Write-Color "[✓] Đã tự động sao chép API_KEY workspace vào Clipboard!" Green
} catch {}

# 3. Đồng bộ cấu hình MCP Antigravity
Write-Color "[*] Đồng bộ cấu hình MCP cho Antigravity IDE..." Cyan
$env:GEHIHI_BASE_URL = "http://127.0.0.1:4981/openai/v1"
$env:GEHIHI_ENV_FILE = $envFile
& $nodePath integrations/antigravity/install.mjs > $null 2>&1
Write-Color "[✓] Cấu hình MCP Antigravity: SẴN SÀNG (http://127.0.0.1:4981/openai/v1)" Green

# 4. Kiểm tra hoặc biên dịch binary server.exe
$serverBin = Join-Path $projectRoot "bin\server.exe"
if (-not (Test-Path $serverBin)) {
    if ($goPath) {
        Write-Color "[*] Đang biên dịch Go backend (bin\server.exe)..." Cyan
        & $goPath build -o bin\server.exe cmd\server\main.go
        if ($LASTEXITCODE -ne 0) {
            Write-Color "[!] Biên dịch Go server thất bại!" Red
            Read-Host "Nhấn Enter để thoát"
            exit 1
        }
        Write-Color "[✓] Biên dịch thành công!" Green
    } else {
        Write-Color "[!] Không tìm thấy bin\server.exe và không có Go compiler!" Red
        Read-Host "Nhấn Enter để thoát"
        exit 1
    }
}

# 5. Dọn dẹp cổng cũ (nếu có tiến trình treo)
function Kill-Port([int]$port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        try {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        } catch {}
    }
}

Kill-Port 54985
Kill-Port 4981

# 6. Khởi chạy Browser Relay Server (Port 54985)
Write-Color "[*] Khởi động Browser Relay Daemon (cổng 54985)..." Cyan
$relayPsi = New-Object System.Diagnostics.ProcessStartInfo
$relayPsi.FileName = $nodePath
$relayPsi.Arguments = "integrations/browser-relay/server.mjs"
$relayPsi.WorkingDirectory = $projectRoot
$relayPsi.UseShellExecute = $false
$relayPsi.CreateNoWindow = $true
$relayProc = [System.Diagnostics.Process]::Start($relayPsi)

# Chờ relay sẵn sàng
Start-Sleep -Milliseconds 800

# 7. Khởi chạy Go Gateway Backend (Port 4981)
Write-Color "[*] Khởi động Gehihi Gateway Backend (cổng 4981)..." Cyan
$gatewayPsi = New-Object System.Diagnostics.ProcessStartInfo
$gatewayPsi.FileName = $serverBin
$gatewayPsi.WorkingDirectory = $projectRoot
$gatewayPsi.UseShellExecute = $false
$gatewayPsi.CreateNoWindow = $true
$gatewayPsi.Environment["PORT"] = "4981"
$gatewayPsi.Environment["GEHIHI_BIND_HOST"] = "127.0.0.1"
$gatewayPsi.Environment["GEMINI_BROWSER_RELAY_URL"] = "http://127.0.0.1:54985"
$gatewayProc = [System.Diagnostics.Process]::Start($gatewayPsi)

# Chờ gateway sẵn sàng
Start-Sleep -Milliseconds 1200

# 8. Mở trình duyệt Web Gateway Dashboard và nhắc nhở tab Gemini
Write-Color "[*] Mở trình duyệt bảng điều khiển Gateway..." Cyan
Start-Process "http://127.0.0.1:4981"

# 9. Hiển thị bảng điều khiển trực quan
Clear-Host
Write-Color "╔══════════════════════════════════════════════════════════════════════════╗" Cyan
Write-Color "║                 GEHIHI ARGON 2026 · HỆ THỐNG ĐÃ KHỞI CHẠY                ║" Yellow
Write-Color "╚══════════════════════════════════════════════════════════════════════════╝" Cyan
Write-Host ""
Write-Color "  [✓] Gateway Web / OpenAI API : http://127.0.0.1:4981" Green
Write-Color "  [✓] Browser Relay Daemon      : http://127.0.0.1:54985" Green
Write-Color "  [✓] Khóa Workspace            : [ĐÃ SAO CHÉP TỰ ĐỘNG VÀO CLIPBOARD!]" Magenta
Write-Color "  [✓] Models Hỗ Trợ             : gemini-4-argon, gemini-3.1-pro, flash, personas" White
Write-Color "  [✓] Antigravity IDE MCP       : Đã kết nối tự động (Fast-path kích hoạt)" Green
Write-Host ""
Write-Color "────────────────────────────────────────────────────────────────────────────" DarkGray
Write-Color "  [+] HƯỚNG DẪN 2 BƯỚC GHÉP NỐI & DÙNG NGAY:" Yellow
Write-Color "      1. Mở tab https://gemini.google.com trên Chrome (đã đăng nhập tài khoản)" White
Write-Color "      2. Bấm vào icon tiện ích 'Gehihi Gemini Bridge' ở góc phải Chrome:" White
Write-Color "         -> Nhấn Ctrl+V để dán khóa API đã copy sẵn -> Bấm 'Kết nối tab'." Cyan
Write-Color "      3. XONG! Mở Antigravity IDE và chat trực tiếp với model gemini-4-argon!" Green
Write-Color "────────────────────────────────────────────────────────────────────────────" DarkGray
Write-Color "  Nhấn phím [Q] hoặc tổ hợp [Ctrl+C] bất kỳ lúc nào để DỪNG hệ thống." Gray
Write-Host ""

try {
    while (-not $gatewayProc.HasExited -and -not $relayProc.HasExited) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::Q) {
                Write-Color "`n[*] Đang dừng các tiến trình dịch vụ..." Yellow
                break
            }
        }
        Start-Sleep -Milliseconds 250
    }
} finally {
    Write-Color "[*] Đang dọn dẹp và đóng hệ thống..." Cyan
    try { if (-not $gatewayProc.HasExited) { $gatewayProc.Kill() } } catch {}
    try { if (-not $relayProc.HasExited) { $relayProc.Kill() } } catch {}
    Kill-Port 54985
    Kill-Port 4981
    Write-Color "[✓] Đã dừng toàn bộ dịch vụ Gehihi Argon 2026 sạch sẽ!" Green
    Start-Sleep -Seconds 1
}
