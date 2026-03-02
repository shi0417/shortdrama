@echo off
cd /d "%~dp0apps\web"

echo ========================================
echo Frontend Server (Next.js)
echo ========================================
echo.
echo Starting Next.js dev server...
echo URL: http://localhost:3000
echo.

call pnpm dev

pause
