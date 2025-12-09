@echo off
REM Ngrok URL-ийг Flutter app-д автоматаар тохируулах script

echo ========================================
echo Ngrok URL Flutter App-д тохируулж байна...
echo ========================================
echo.

REM 1. Ngrok tunnel эхлүүлэх (background)
echo 1. Ngrok tunnel эхлүүлж байна...
start /B ngrok http 4555 >nul 2>&1
timeout /t 5 >nul

REM 2. Ngrok API-аас tunnel URL авах
echo 2. Tunnel URL аваж байна...
for /f "tokens=*" %%a in ('curl -s http://localhost:4040/api/tunnels 2^>nul ^| findstr "public_url"') do (
    set "tunnel_line=%%a"
)

REM 3. URL-ийг parse хийх
set "ngrok_url="
for /f "tokens=2 delims=:," %%a in ('echo %tunnel_line%') do (
    set "url_part=%%a"
    set "url_part=!url_part:"=!"
    set "url_part=!url_part: =!"
    set "ngrok_url=!url_part!"
)

if "%ngrok_url%"=="" (
    echo ERROR: Tunnel URL олдсонгүй!
    echo Шалгах зүйлс:
    echo   1. Ngrok tunnel эхэлсэн эсэх: http://localhost:4040
    echo   2. Tunnel "online" төлөвт байгаа эсэх
    echo.
    echo Гараар URL оруулах:
    echo   inspection_flutter_app/lib/config/app_config.dart файлд:
    echo   static const String _ngrokBaseUrl = 'https://your-url.ngrok-free.app';
    pause
    exit /b 1
)

echo    Tunnel URL: %ngrok_url%
echo.

REM 4. Flutter app config файл засах
set FLUTTER_CONFIG=inspection_flutter_app\lib\config\app_config.dart

if not exist "%FLUTTER_CONFIG%" (
    echo ERROR: Flutter config файл олдсонгүй: %FLUTTER_CONFIG%
    pause
    exit /b 1
)

echo 3. Flutter app config файл засаж байна...
powershell -Command "(Get-Content '%FLUTTER_CONFIG%') -replace 'static const String _ngrokBaseUrl = '';', 'static const String _ngrokBaseUrl = ''%ngrok_url%'';' | Set-Content '%FLUTTER_CONFIG%'"

if errorlevel 1 (
    echo ERROR: Config файл засахад алдаа гарлаа!
    pause
    exit /b 1
)

echo.
echo ========================================
echo Амжилттай!
echo ========================================
echo.
echo Ngrok URL: %ngrok_url%
echo Flutter app config файл шинэчлэгдлээ: %FLUTTER_CONFIG%
echo.
echo Одоо Flutter app-ийг дахин эхлүүлнэ үү (hot restart).
echo.
pause



