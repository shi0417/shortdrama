@echo off
cd /d "%~dp0"

echo ========================================
echo ShortDrama Dev Server
echo ========================================
echo.

echo [1/3] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call pnpm install
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to install dependencies
        echo Please install pnpm: npm install -g pnpm
        pause
        exit /b 1
    )
) else (
    echo Dependencies OK
)

echo.
echo [2/3] Checking environment files...
if not exist "apps\api\.env" (
    echo ERROR: Missing apps\api\.env
    pause
    exit /b 1
)
if not exist "apps\web\.env.local" (
    echo ERROR: Missing apps\web\.env.local
    pause
    exit /b 1
)
echo Environment files OK

echo.
echo [3/3] Starting dev servers...
echo.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:4000
echo.
echo Press Ctrl+C to stop
echo ========================================
echo.

call pnpm dev

pause
