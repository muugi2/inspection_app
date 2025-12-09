@echo off
REM Ngrok CRL алдаа засах script (crl_noverify ашиглах)

echo ========================================
echo Ngrok CRL алдаа засах (CRL verification идэвхгүй)...
echo ========================================
echo.

REM 1. Ngrok process-үүдийг зогсоох
echo 1. Ngrok process-үүдийг зогсоож байна...
taskkill /F /IM ngrok.exe >nul 2>&1
timeout /t 2 >nul

REM 2. Ngrok config файлын байрлал
set NGROK_CONFIG=%LOCALAPPDATA%\ngrok\ngrok.yml

REM 3. Config файл үүсгэх эсвэл засах
if not exist "%LOCALAPPDATA%\ngrok" mkdir "%LOCALAPPDATA%\ngrok"

REM 4. Config.env файлаас authtoken унших
set CONFIG_FILE=config.env
set NGROK_AUTHTOKEN=

for /f "tokens=2 delims==" %%a in ('findstr /C:"NGROK_AUTHTOKEN" %CONFIG_FILE%') do set NGROK_AUTHTOKEN=%%a

if "%NGROK_AUTHTOKEN%"=="" (
    echo ERROR: NGROK_AUTHTOKEN config.env файлд олдсонгүй!
    pause
    exit /b 1
)

REM 5. Config файлд зөв v3 формат + CRL verification идэвхгүй
echo 2. Ngrok config файл үүсгэж байна (CRL verification идэвхгүй)...
(
echo version: "3"
echo authtoken: %NGROK_AUTHTOKEN%
echo crl_noverify: true
) > "%NGROK_CONFIG%"

echo    Config файл үүсгэсэн: %NGROK_CONFIG%
echo    CRL verification идэвхгүй болгосон (crl_noverify: true)
echo.

REM 6. Ngrok version шалгах
echo 3. Ngrok version шалгаж байна...
ngrok version
echo.

echo ========================================
echo Засварлалт дууссан!
echo ========================================
echo.
echo Одоо ngrok tunnel эхлүүлэх:
echo   ngrok http 4555
echo.
echo Эсвэл script ашиглах:
echo   start-ngrok.cmd
echo.
echo ЧУХАЛ: CRL verification идэвхгүй болгосон тул security warning гарч болно.
echo Гэхдээ tunnel ажиллах ёстой.
echo.
pause



