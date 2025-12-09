@echo off
REM Ngrok authtoken засах script

echo ========================================
echo Ngrok Authtoken Засах...
echo ========================================
echo.

REM 1. Ngrok process-үүдийг зогсоох
echo 1. Ngrok process-үүдийг зогсоож байна...
taskkill /F /IM ngrok.exe >nul 2>&1
timeout /t 2 >nul

REM 2. Хуучин config файлыг устгах
set NGROK_CONFIG=%LOCALAPPDATA%\ngrok\ngrok.yml
if exist "%NGROK_CONFIG%" (
    echo 2. Хуучин config файлыг устгаж байна...
    del "%NGROK_CONFIG%" >nul 2>&1
    echo    Устгасан: %NGROK_CONFIG%
)

REM 3. Config.env файлаас authtoken унших
set CONFIG_FILE=config.env
set NGROK_AUTHTOKEN=

for /f "tokens=2 delims==" %%a in ('findstr /C:"NGROK_AUTHTOKEN" %CONFIG_FILE%') do set NGROK_AUTHTOKEN=%%a

if "%NGROK_AUTHTOKEN%"=="" (
    echo ERROR: NGROK_AUTHTOKEN config.env файлд олдсонгүй!
    echo.
    echo ШИЙДЭЛ:
    echo 1. https://dashboard.ngrok.com/get-started/your-authtoken дээр очно
    echo 2. Шинэ authtoken хуулна
    echo 3. config.env файлд NGROK_AUTHTOKEN=your_new_token гэж оруулна
    pause
    exit /b 1
)

REM 4. Authtoken формат шалгах (ихэвчлэн 32+ тэмдэгт урт байдаг)
if "%NGROK_AUTHTOKEN:~31%"=="" (
    echo WARNING: Authtoken хэт богино байна!
    echo Authtoken ихэвчлэн 32+ тэмдэгт урт байдаг.
    echo Одоогийн token: %NGROK_AUTHTOKEN%
    echo.
    echo ШИЙДЭЛ:
    echo 1. https://dashboard.ngrok.com/get-started/your-authtoken дээр очно
    echo 2. Бүрэн authtoken хуулна (бүх тэмдэгт)
    echo 3. config.env файлд NGROK_AUTHTOKEN=your_full_token гэж оруулна
    echo.
    pause
)

REM 5. Ngrok config add-authtoken ашиглан зөв v3 формат үүсгэх
echo 3. Шинэ config файл үүсгэж байна...
ngrok config add-authtoken %NGROK_AUTHTOKEN%

if errorlevel 1 (
    echo.
    echo ERROR: Authtoken тохируулахад алдаа гарлаа!
    echo.
    echo ШАЛТГААН:
    echo   - Authtoken буруу эсвэл дууссан байж магадгүй
    echo   - Authtoken бүрэн хуулаагүй байж магадгүй
    echo.
    echo ШИЙДЭЛ:
    echo 1. https://dashboard.ngrok.com/get-started/your-authtoken дээр очно
    echo 2. Шинэ authtoken үүсгэнэ (Revoke old token, Create new token)
    echo 3. Бүрэн authtoken хуулна (бүх тэмдэгт, зай байхгүй)
    echo 4. config.env файлд NGROK_AUTHTOKEN=your_new_token гэж оруулна
    echo 5. Энэ script дахин ажиллуулна
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Config файл амжилттай үүсгэгдлээ!
echo ========================================
echo.
echo Одоо ngrok tunnel эхлүүлэх:
echo   ngrok http 4555
echo.
echo Эсвэл script ашиглах:
echo   start-ngrok.cmd
echo.
pause



