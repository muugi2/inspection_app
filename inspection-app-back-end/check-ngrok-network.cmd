@echo off
REM Ngrok network/DNS шалгах script

echo ========================================
echo Ngrok Network/DNS шалгаж байна...
echo ========================================
echo.

echo 1. Internet connection шалгах...
ping -n 2 google.com >nul 2>&1
if errorlevel 1 (
    echo    [X] Internet connection алга!
    echo    Internet connection шалгана уу.
) else (
    echo    [OK] Internet connection байна
)
echo.

echo 2. Ngrok API сервертэй холбогдож чадах эсэх...
ping -n 2 api.ngrok.com >nul 2>&1
if errorlevel 1 (
    echo    [X] api.ngrok.com-д хандах боломжгүй!
    echo    DNS эсвэл firewall асуудал байж болно.
) else (
    echo    [OK] api.ngrok.com-д хандаж байна
)
echo.

echo 3. CRL сервертэй холбогдож чадах эсэх...
ping -n 2 crl.ngrok-agent.com >nul 2>&1
if errorlevel 1 (
    echo    [X] crl.ngrok-agent.com-д хандах боломжгүй!
    echo    Энэ нь CRL алдааны шалтгаан байж болно.
    echo.
    echo    ШИЙДЭЛ:
    echo    1. DNS тохируулга засах (8.8.8.8, 8.8.4.4)
    echo    2. VPN ашиглах
    echo    3. Firewall шалгах
) else (
    echo    [OK] crl.ngrok-agent.com-д хандаж байна
)
echo.

echo 4. DNS тохируулга харах...
ipconfig /all | findstr /C:"DNS Servers" | findstr /V /C:"::"
echo.

echo ========================================
echo Шалгалт дууссан!
echo ========================================
echo.
pause



