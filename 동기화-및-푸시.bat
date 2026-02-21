@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
node sync-and-push.js
echo.
pause
