@echo off
cd /d "%~dp0apps\api"

echo ========================================
echo Backend Server (NestJS)
echo ========================================
echo.
echo Starting NestJS dev server...
echo URL: http://localhost:4000
echo Health: http://localhost:4000/health
echo.

call pnpm dev

pause
