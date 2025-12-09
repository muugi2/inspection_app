@echo off
REM Ngrok CRL алдаа засах script

echo ========================================
echo Ngrok CRL алдаа засах...
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

REM 5. Хуучин config файлыг устгах (хэрэв байвал)
if exist "%NGROK_CONFIG%" (
    echo 2. Хуучин config файлыг устгаж байна...
    del "%NGROK_CONFIG%" >nul 2>&1
)

REM 6. Ngrok config add-authtoken ашиглан зөв v3 формат үүсгэх
echo 3. Шинэ config файл үүсгэж байна (ngrok config add-authtoken)...
ngrok config add-authtoken %NGROK_AUTHTOKEN%

if errorlevel 1 (
    echo.
    echo ERROR: Config файл үүсгэхэд алдаа гарлаа!
    echo Шалгах зүйлс:
    echo   1. Internet connection байгаа эсэх
    echo   2. Token зөв эсэх
    echo   3. DNS тохируулга (8.8.8.8, 8.8.4.4)
    pause
    exit /b 1
)

echo    Config файл үүсгэсэн: %NGROK_CONFIG%
echo    Ngrok v3 зөв формат ашигласан
echo.
echo ТАЙЛБАР: Ngrok v3 дээр crl_noverify байхгүй.
echo CRL алдаа гарвал DNS эсвэл network асуудал байж болно.
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
pause



