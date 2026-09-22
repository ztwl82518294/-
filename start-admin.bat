@echo off
REM ============================================================
REM  Start the admin panel for logistics-line-query
REM  Double-click this file, then the browser opens automatically.
REM
REM  NOTE: this file is intentionally ASCII-only.
REM  Windows .bat files with non-ASCII paths get corrupted by
REM  codepage conversion, so keep the content in English.
REM ============================================================

chcp 65001 >nul
cd /d "%~dp0"

set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "NODE_BIN=C:\Program Files\nodejs\node.exe"
    ) else (
        echo.
        echo [ERROR] Node.js was not found in PATH.
        echo         Install Node.js 16 or newer: https://nodejs.org
        echo         Then double-click this file again.
        echo.
        pause
        exit /b 1
    )
)

"%NODE_BIN%" scripts\start-admin.js

echo.
echo Admin panel has been stopped. Press any key to close this window.
pause >nul
