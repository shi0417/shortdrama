@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo ShortDrama Dev Server
echo ========================================
echo.

echo [1/5] Checking dependencies...
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
echo [2/5] Checking environment files...
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
echo [3/5] Checking frontend port 3000...
call :free_port 3000
if errorlevel 1 (
    echo ERROR: Failed to free port 3000
    pause
    exit /b 1
)
echo Port 3000 is ready

echo.
echo [4/5] Checking backend port 4000...
call :free_port 4000
if errorlevel 1 (
    echo ERROR: Failed to free port 4000
    pause
    exit /b 1
)
echo Port 4000 is ready

echo.
echo [5/5] Starting dev servers...
echo.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:4000
echo.
echo Press Ctrl+C to stop
echo ========================================
echo.

call npx concurrently "set PORT=3000 && pnpm --filter web dev" "set API_PORT=4000 && set PORT=4000 && pnpm --filter api dev"

pause
exit /b 0

:free_port
set "PORT=%~1"
set "FOUND=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    if not "%%p"=="0" (
        set "FOUND=1"
        echo Port %PORT% is occupied by PID %%p, killing...
        taskkill /PID %%p /F >nul 2>&1
    )
)
if "!FOUND!"=="1" timeout /t 1 >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo Port %PORT% is still occupied by PID %%p
    exit /b 1
)
exit /b 0
