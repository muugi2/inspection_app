@echo off
cd /d C:\project\inspection_app\inspection-app-back-end
echo Stopping existing containers...
docker compose down
echo Starting containers from correct directory...
docker compose up -d
echo Done!
pause
