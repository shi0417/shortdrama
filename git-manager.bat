@echo off
setlocal

if /i not "%~1"=="--run" (
    cmd /k ""%~f0" --run"
    exit /b
)

cd /d "%~dp0"

set "REMOTE_URL=https://github.com/shi0417/shortdrama.git"

echo ========================================
echo One-Click Git Auto Push
echo ========================================
echo Repo: %cd%
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not in PATH.
    goto :fail
)

if not exist ".git" (
    echo [ERROR] Current directory is not a git repository.
    goto :fail
)

for /f %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%i"
if "%BRANCH%"=="" (
    echo [ERROR] Cannot detect current branch.
    goto :fail
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo [INFO] origin not found, adding origin...
    git remote add origin %REMOTE_URL%
    if errorlevel 1 (
        echo [ERROR] Failed to add origin remote.
        goto :fail
    )
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "NOW=%%i"
set "COMMIT_MSG=auto backup %NOW% [%BRANCH%]"

echo [STEP] Staging all changes...
git add -A
if errorlevel 1 (
    echo [ERROR] git add failed.
    goto :fail
)

git diff --cached --quiet
if errorlevel 1 (
    echo [STEP] Creating commit...
    git commit -m "%COMMIT_MSG%"
    if errorlevel 1 (
        echo [ERROR] git commit failed.
        goto :fail
    )
) else (
    echo [INFO] No staged changes to commit. Will push current branch anyway.
)

git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >nul 2>&1
if errorlevel 1 (
    echo [STEP] First push for this branch...
    git push -u origin %BRANCH%
) else (
    echo [STEP] Syncing with remote (fetch + rebase)...
    git fetch origin
    if errorlevel 1 (
        echo [ERROR] git fetch failed.
        goto :fail
    )

    git pull --rebase --autostash origin %BRANCH%
    if errorlevel 1 (
        echo [ERROR] git pull --rebase failed.
        git rebase --abort >nul 2>&1
        echo [TIP] Resolve conflicts manually, then rerun this script.
        goto :fail
    )

    echo [STEP] Pushing to remote...
    git push
)

if errorlevel 1 (
    echo [ERROR] git push failed.
    goto :fail
)

echo.
echo [OK] Push completed successfully.
echo [OK] Branch: %BRANCH%
echo [OK] Remote branch: origin/%BRANCH%
echo [OK] Commit message: %COMMIT_MSG%
for /f %%i in ('git rev-parse --short HEAD 2^>nul') do set "LAST_COMMIT=%%i"
for /f %%i in ('git status --short ^| find /c /v ""') do set "STATUS_COUNT=%%i"
echo.
echo ========================================
echo Completed Task Checklist
echo ========================================
echo [1] Detected git repository
echo [2] Detected current branch: %BRANCH%
echo [3] Staged changes: git add -A
echo [4] Auto commit message: %COMMIT_MSG%
echo [5] Synced with remote: fetch/rebase (or first push)
echo [6] Pushed to GitHub: OK
echo [7] Latest commit: %LAST_COMMIT%
echo [8] Pushed remote branch: origin/%BRANCH%
if "%STATUS_COUNT%"=="0" (
echo [9] git status --short: clean working tree
) else (
echo [9] git status --short: %STATUS_COUNT% line^(s^) pending
echo ----- git status --short -----
git status --short
echo ------------------------------
)
echo ========================================
echo.
echo You can now review logs above and close this window manually.
pause
exit /b 0

:fail
echo.
echo Push failed. Please check the error message above.
echo.
echo Task stopped. Please fix the issue and rerun this script.
echo You can close this window manually.
pause
exit /b 1
