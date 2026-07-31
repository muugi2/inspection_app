# PowerShell script to rebuild admin-web Docker container without cache
# This ensures all routes including monthly-report are included

Write-Host "=== Rebuilding admin-web Docker container ===" -ForegroundColor Green
Write-Host "This will rebuild without cache to ensure all routes are included" -ForegroundColor Yellow
Write-Host ""

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Change to project root
Set-Location $projectRoot

# Stop and remove existing container
Write-Host "Stopping existing container..." -ForegroundColor Yellow
docker-compose stop admin-web 2>$null
docker-compose rm -f admin-web 2>$null

# Remove existing image
Write-Host "Removing existing image..." -ForegroundColor Yellow
docker rmi inspection_app_admin-web 2>$null

# Build without cache
Write-Host "Building without cache..." -ForegroundColor Yellow
docker-compose build --no-cache admin-web

if ($LASTEXITCODE -eq 0) {
    # Start the container
    Write-Host "Starting container..." -ForegroundColor Yellow
    docker-compose up -d admin-web
    
    Write-Host ""
    Write-Host "=== Build complete ===" -ForegroundColor Green
    Write-Host "Check logs with: docker-compose logs -f admin-web" -ForegroundColor Cyan
    Write-Host "Access at: http://192.168.1.54:3002/monthly-report" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "=== Build failed ===" -ForegroundColor Red
    Write-Host "Check the error messages above" -ForegroundColor Yellow
    exit 1
}

