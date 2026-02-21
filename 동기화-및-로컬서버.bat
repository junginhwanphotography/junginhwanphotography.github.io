@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
node run-test-server.js
echo.
pause
