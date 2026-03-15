@echo off
setlocal enabledelayedexpansion
title Logbook System — Local Setup

echo.
echo ============================================================
echo   LOGBOOK SYSTEM — Local PC Setup
echo ============================================================
echo.

:: ── Check for Node.js ──────────────────────────────────────────
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download and install it from: https://nodejs.org
    echo         Then re-run this script.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Node.js %NODE_VERSION% detected.

:: ── Install dependencies ───────────────────────────────────────
echo.
echo [1/4] Installing npm dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.

:: ── Copy .env if it doesn't exist ─────────────────────────────
echo.
echo [2/4] Configuring environment...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] Created ".env" from ".env.example".
        echo.
        echo *** ACTION REQUIRED ***
        echo     Open ".env" in a text editor and fill in your Firebase
        echo     credentials and a secure SESSION_SECRET before starting
        echo     the server. See docs\DEPLOYMENT.md for details.
        echo ***********************
    ) else (
        echo [WARN] ".env.example" not found. Skipping .env creation.
        echo        Create a ".env" file manually before starting the server.
    )
) else (
    echo [OK] ".env" already exists — skipping.
)

:: ── Initialize local database ──────────────────────────────────
echo.
echo [3/4] Initializing local SQLite database...
call node scripts/init-local-db.js
if %errorlevel% neq 0 (
    echo [WARN] Database initialization returned an error.
    echo        The server may still work if the database already exists.
) else (
    echo [OK] Local database ready.
)

:: ── Done ───────────────────────────────────────────────────────
echo.
echo [4/4] Setup complete!
echo.
echo ============================================================
echo   Next steps:
echo     1. Edit ".env" with your Firebase credentials (if not done).
echo     2. Place "firebase-key.json" in the "config\" folder.
echo     3. Run:  npm start
echo     4. Open: http://localhost:3000
echo.
echo   For a full guide, see: docs\DEPLOYMENT.md
echo ============================================================
echo.
pause
