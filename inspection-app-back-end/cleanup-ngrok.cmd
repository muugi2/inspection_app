@echo off
REM Laptop дээрх ngrok файлуудыг устгах script

echo ========================================
echo Ngrok файлуудыг цэвэрлэж байна...
echo ========================================
echo.

REM 1. Ngrok process-үүдийг зогсоох
echo 1. Ngrok process-үүдийг зогсоож байна...
taskkill /F /IM ngrok.exe >nul 2>&1
if errorlevel 1 (
    echo    Ngrok process олдсонгүй (аль хэдийн зогссон байж магадгүй)
) else (
    echo    Ngrok process зогсоосон
)
timeout /t 2 >nul

REM 2. Ngrok config файлуудыг устгах
echo 2. Ngrok config файлуудыг устгаж байна...

set CONFIG_PATHS[0]=%USERPROFILE%\.ngrok2\ngrok.yml
set CONFIG_PATHS[1]=%APPDATA%\ngrok\ngrok.yml
set CONFIG_PATHS[2]=%LOCALAPPDATA%\ngrok\ngrok.yml
set CONFIG_PATHS[3]=%USERPROFILE%\AppData\Local\ngrok\ngrok.yml

for /L %%i in (0,1,3) do (
    call set "path=%%CONFIG_PATHS[%%i]%%"
    if exist "!path!" (
        echo    Устгаж байна: !path!
        del "!path!" /F /Q >nul 2>&1
    )
)

REM 3. Ngrok folder-үүдийг устгах (хэрэв хоосон бол)
echo 3. Ngrok folder-үүдийг шалгаж байна...

if exist "%USERPROFILE%\.ngrok2" (
    rmdir "%USERPROFILE%\.ngrok2" >nul 2>&1
    if not errorlevel 1 echo    Устгасан: %USERPROFILE%\.ngrok2
)

if exist "%APPDATA%\ngrok" (
    rmdir "%APPDATA%\ngrok" >nul 2>&1
    if not errorlevel 1 echo    Устгасан: %APPDATA%\ngrok
)

if exist "%LOCALAPPDATA%\ngrok" (
    rmdir "%LOCALAPPDATA%\ngrok" >nul 2>&1
    if not errorlevel 1 echo    Устгасан: %LOCALAPPDATA%\ngrok
)

REM 4. Docker ngrok container устгах
echo 4. Docker ngrok container устгаж байна...
docker-compose stop ngrok >nul 2>&1
docker-compose rm -f ngrok >nul 2>&1
docker rmi ngrok/ngrok:latest >nul 2>&1
echo    Docker ngrok container устгасан (хэрэв байсан бол)

echo.
echo ========================================
echo Цэвэрлэлт дууссан!
echo ========================================
echo.
echo Устгасан зүйлс:
echo   - Ngrok process-үүд
echo   - Ngrok config файлууд
echo   - Ngrok folder-үүд
echo   - Docker ngrok container
echo.
echo Дараагийн алхам:
echo   1. ngrok.com дээр authtoken устгах (хэрэв хүсвэл)
echo   2. Шинэ authtoken үүсгэх: https://dashboard.ngrok.com/get-started/your-authtoken
echo   3. config.env файлд NGROK_AUTHTOKEN=your_token нэмэх
echo.
pause



