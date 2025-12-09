@echo off
REM Ngrok authtoken тохируулах болон tunnel эхлүүлэх script

echo ========================================
echo Ngrok Authtoken тохируулж байна...
echo ========================================
echo.

REM Config.env файлаас authtoken унших
set CONFIG_FILE=config.env
set NGROK_AUTHTOKEN=

for /f "tokens=2 delims==" %%a in ('findstr /C:"NGROK_AUTHTOKEN" %CONFIG_FILE%') do set NGROK_AUTHTOKEN=%%a

if "%NGROK_AUTHTOKEN%"=="" (
    echo ERROR: NGROK_AUTHTOKEN config.env файлд олдсонгүй!
    echo.
    echo Шинэ authtoken үүсгэх:
    echo   https://dashboard.ngrok.com/get-started/your-authtoken
    echo.
    echo Дараа нь config.env файлд нэмэх:
    echo   NGROK_AUTHTOKEN=your_token_here
    echo.
    pause
    exit /b 1
)

echo Authtoken олдлоо: %NGROK_AUTHTOKEN:~0,20%...
echo.

REM Ngrok process-үүдийг зогсоох
echo Одоогийн ngrok process-үүдийг зогсоож байна...
taskkill /F /IM ngrok.exe >nul 2>&1
timeout /t 2 >nul

REM Ngrok authtoken тохируулах
echo Authtoken тохируулж байна...
ngrok config add-authtoken %NGROK_AUTHTOKEN%

if errorlevel 1 (
    echo.
    echo ========================================
    echo ERROR: Authtoken тохируулахад алдаа гарлаа!
    echo ========================================
    echo.
    echo Боломжит шалтгаанууд:
    echo   1. Token буруу эсвэл хугацаа дууссан
    echo   2. Internet connection асуудал
    echo   3. Ngrok сервертэй холбогдож чадахгүй байна
    echo.
    echo Шийдэл:
    echo   1. Шинэ authtoken үүсгэх: https://dashboard.ngrok.com/get-started/your-authtoken
    echo   2. config.env файлд шинэ token оруулах
    echo   3. Internet connection шалгах
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Authtoken амжилттай тохируулагдсан!
echo ========================================
echo.
echo Одоо ngrok tunnel эхлүүлж байна...
echo Backend: http://localhost:4555
echo.
echo Tunnel URL-ийг харах: http://localhost:4040
echo Tunnel ажиллаж байгаа үед энэ цонхыг хаахгүй байна уу!
echo.

REM Ngrok tunnel эхлүүлэх
ngrok http 4555

pause



