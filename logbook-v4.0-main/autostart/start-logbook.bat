@echo off
:: ============================================================
:: Logbook System - Launcher
:: Starts the Node.js server and opens the app in the browser.
:: ============================================================

:: Change to the project root (one level up from autostart\)
cd /d "%~dp0.."

:: Optional: check if Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

:: Start the server in a new minimized window
start "Logbook Server" /MIN cmd /c "node server.js"

:: Wait a few seconds for the server to boot up
timeout /t 4 /nobreak >nul

:: Open the app in the default browser
start "" "http://localhost:3000"

exit /b 0
