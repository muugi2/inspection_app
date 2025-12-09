# PowerShell script to cleanup ngrok files from laptop

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Ngrok файлуудыг цэвэрлэж байна..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Ngrok process-үүдийг зогсоох
Write-Host "1. Ngrok process-үүдийг зогсоож байна..." -ForegroundColor Yellow
$processes = Get-Process -Name ngrok -ErrorAction SilentlyContinue
if ($processes) {
    $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "   Ngrok process зогсоосон" -ForegroundColor Green
} else {
    Write-Host "   Ngrok process олдсонгүй (аль хэдийн зогссон байж магадгүй)" -ForegroundColor Gray
}
Start-Sleep -Seconds 2

# 2. Ngrok config файлуудыг устгах
Write-Host "2. Ngrok config файлуудыг устгаж байна..." -ForegroundColor Yellow

$configPaths = @(
    "$env:USERPROFILE\.ngrok2\ngrok.yml",
    "$env:APPDATA\ngrok\ngrok.yml",
    "$env:LOCALAPPDATA\ngrok\ngrok.yml",
    "$env:USERPROFILE\AppData\Local\ngrok\ngrok.yml"
)

$deletedCount = 0
foreach ($path in $configPaths) {
    if (Test-Path $path) {
        Write-Host "   Устгаж байна: $path" -ForegroundColor Gray
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        $deletedCount++
    }
}

if ($deletedCount -eq 0) {
    Write-Host "   Config файл олдсонгүй" -ForegroundColor Gray
} else {
    Write-Host "   $deletedCount config файл устгасан" -ForegroundColor Green
}

# 3. Ngrok folder-үүдийг устгах (хэрэв хоосон бол)
Write-Host "3. Ngrok folder-үүдийг шалгаж байна..." -ForegroundColor Yellow

$folders = @(
    "$env:USERPROFILE\.ngrok2",
    "$env:APPDATA\ngrok",
    "$env:LOCALAPPDATA\ngrok"
)

$deletedFolders = 0
foreach ($folder in $folders) {
    if (Test-Path $folder) {
        try {
            Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "   Устгасан: $folder" -ForegroundColor Green
            $deletedFolders++
        } catch {
            Write-Host "   Устгах боломжгүй (файлууд байгаа): $folder" -ForegroundColor Yellow
        }
    }
}

if ($deletedFolders -eq 0) {
    Write-Host "   Folder олдсонгүй эсвэл устгах боломжгүй" -ForegroundColor Gray
}

# 4. Docker ngrok container устгах
Write-Host "4. Docker ngrok container устгаж байна..." -ForegroundColor Yellow
try {
    docker-compose stop ngrok 2>$null | Out-Null
    docker-compose rm -f ngrok 2>$null | Out-Null
    docker rmi ngrok/ngrok:latest 2>$null | Out-Null
    Write-Host "   Docker ngrok container устгасан (хэрэв байсан бол)" -ForegroundColor Green
} catch {
    Write-Host "   Docker командууд ажиллахгүй байна (Docker суулгаагүй эсвэл ажиллахгүй байна)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Цэвэрлэлт дууссан!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Устгасан зүйлс:" -ForegroundColor Yellow
Write-Host "  - Ngrok process-үүд" -ForegroundColor White
Write-Host "  - Ngrok config файлууд" -ForegroundColor White
Write-Host "  - Ngrok folder-үүд" -ForegroundColor White
Write-Host "  - Docker ngrok container" -ForegroundColor White
Write-Host ""
Write-Host "Дараагийн алхам:" -ForegroundColor Cyan
Write-Host "  1. ngrok.com дээр authtoken устгах (хэрэв хүсвэл)" -ForegroundColor White
Write-Host "     https://dashboard.ngrok.com/authtokens" -ForegroundColor Gray
Write-Host "  2. Шинэ authtoken үүсгэх:" -ForegroundColor White
Write-Host "     https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Gray
Write-Host "  3. config.env файлд NGROK_AUTHTOKEN=your_token нэмэх" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"



