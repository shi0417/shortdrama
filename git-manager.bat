@echo off
setlocal
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
echo [OK] Commit message: %COMMIT_MSG%
timeout /t 3 >nul
exit /b 0

:fail
echo.
echo Push failed. Please check the error message above.
timeout /t 8 >nul
exit /b 1
