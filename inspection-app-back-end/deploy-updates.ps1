# Deploy updates to 192.168.1.54:3002
# Backend: restart only (code from volume). Admin-web: rebuild required.

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot

Set-Location $projectRoot

Write-Host ""
Write-Host "=== Deploy updates to 192.168.1.54:3002 ===" -ForegroundColor Green
Write-Host ""

Write-Host "[1/3] Restarting backend..." -ForegroundColor Yellow
docker-compose restart backend
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend restart failed." -ForegroundColor Red
    exit 1
}
Write-Host "Backend restarted." -ForegroundColor Green
Write-Host ""

Write-Host "[2/3] Building admin-web (no cache)..." -ForegroundColor Yellow
docker-compose build --no-cache admin-web
if ($LASTEXITCODE -ne 0) {
    Write-Host "Admin-web build failed." -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "[3/3] Starting admin-web..." -ForegroundColor Yellow
docker-compose up -d admin-web
if ($LASTEXITCODE -ne 0) {
    Write-Host "Admin-web start failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Admin web: http://192.168.1.54:3002" -ForegroundColor Cyan
Write-Host "Backend API: http://192.168.1.54:4555" -ForegroundColor Cyan
Write-Host ""
Write-Host "PDF download, Mail send, Inspection delete work at 192.168.1.54:3002" -ForegroundColor White
Write-Host "Auto mail on inspection complete is disabled; only Admin Mail button sends email." -ForegroundColor White
Write-Host ""
