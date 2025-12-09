@echo off
REM Ngrok tunnel эхлүүлэх script (authtoken тохируулсан)

echo ========================================
echo Ngrok Tunnel эхлүүлж байна...
echo ========================================
echo.

REM Config.env файлаас authtoken унших
set CONFIG_FILE=config.env
set NGROK_AUTHTOKEN=

for /f "tokens=2 delims==" %%a in ('findstr /C:"NGROK_AUTHTOKEN" %CONFIG_FILE%') do set NGROK_AUTHTOKEN=%%a

if "%NGROK_AUTHTOKEN%"=="" (
    echo ERROR: NGROK_AUTHTOKEN config.env файлд олдсонгүй!
    echo config.env файлд NGROK_AUTHTOKEN=your_token гэж нэмнэ үү.
    pause
    exit /b 1
)

REM Ngrok process-үүдийг зогсоох
echo Одоогийн ngrok process-үүдийг зогсоож байна...
taskkill /F /IM ngrok.exe >nul 2>&1
timeout /t 2 >nul

REM Ngrok authtoken тохируулах
echo Authtoken тохируулж байна...
ngrok config add-authtoken %NGROK_AUTHTOKEN%

if errorlevel 1 (
    echo.
    echo ERROR: Authtoken тохируулахад алдаа гарлаа!
    echo Шалгах зүйлс:
    echo   1. Token зөв эсэх
    echo   2. Internet connection байгаа эсэх
    echo   3. Шинэ token үүсгэх: https://dashboard.ngrok.com/get-started/your-authtoken
    pause
    exit /b 1
)

echo.
echo ========================================
echo Ngrok tunnel эхлүүлж байна...
echo Backend: http://localhost:4555
echo ========================================
echo.
echo Tunnel URL-ийг харах: http://localhost:4040
echo Tunnel ажиллаж байгаа үед энэ цонхыг хаахгүй байна уу!
echo.

REM Ngrok tunnel эхлүүлэх
ngrok http 4555

pause



