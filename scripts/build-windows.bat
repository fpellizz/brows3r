@echo off
:: brows3r — Windows Build Launcher
:: Bypassa le policy di esecuzione PowerShell e lancia lo script di build
::
:: Uso: fare doppio click su build-windows.bat
::      oppure lanciare da CMD: scripts\build-windows.bat

cd /d "%~dp0\.."
echo.
echo ============================================
echo   brows3r — Windows Build
echo ============================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRORE] Build fallita con codice %ERRORLEVEL%
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [OK] Build completata!
pause
