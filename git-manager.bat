@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:menu
cls
echo ========================================
echo Git Repository Manager
echo ========================================
echo Remote: https://github.com/shi0417/shortdrama
echo Current: %cd%
echo ========================================
echo.
echo Select an option:
echo.
echo [1] Init and link remote repository
echo [2] View status (git status)
echo [3] Pull latest code (git pull)
echo [4] Commit and push all changes
echo [5] View commit history (git log)
echo [6] Create new branch
echo [7] Switch branch
echo [8] View all branches
echo [9] Clone to new directory
echo [0] Exit
echo.
set /p choice="Enter option [0-9]: "

if "%choice%"=="1" goto init
if "%choice%"=="2" goto status
if "%choice%"=="3" goto pull
if "%choice%"=="4" goto commit
if "%choice%"=="5" goto log
if "%choice%"=="6" goto newbranch
if "%choice%"=="7" goto checkout
if "%choice%"=="8" goto branches
if "%choice%"=="9" goto clone
if "%choice%"=="0" goto end
goto menu

:init
echo.
echo ========================================
echo Initialize Git Repository
echo ========================================
if exist ".git" (
    echo .git directory already exists
    set /p reinit="Re-initialize? [y/N]: "
    if /i not "!reinit!"=="y" goto menu
)
echo.
git init
git remote remove origin 2>nul
git remote add origin https://github.com/shi0417/shortdrama.git
git branch -M main
echo.
echo [OK] Repository initialized
echo [OK] Remote linked: https://github.com/shi0417/shortdrama.git
echo.
set /p firstpush="Push current code now? [y/N]: "
if /i "!firstpush!"=="y" (
    git add .
    git commit -m "Initial commit"
    git push -u origin main
)
pause
goto menu

:status
echo.
echo ========================================
echo Git Status
echo ========================================
git status
echo.
pause
goto menu

:pull
echo.
echo ========================================
echo Pull Remote Code
echo ========================================
git pull origin main
echo.
if errorlevel 1 (
    echo [ERROR] Pull failed
) else (
    echo [OK] Pull successful
)
pause
goto menu

:commit
echo.
echo ========================================
echo Commit and Push
echo ========================================
echo.
git status
echo.
set /p message="Enter commit message: "
if "!message!"=="" (
    echo [ERROR] Commit message cannot be empty
    pause
    goto menu
)
echo.
echo Committing...
git add .
git commit -m "!message!"
if errorlevel 1 (
    echo.
    echo [WARN] No changes to commit
    pause
    goto menu
)
echo.
echo Pushing to remote...
git push origin main
if errorlevel 1 (
    echo.
    echo [ERROR] Push failed
    echo Tip: If first push, run option [1] first
    echo Or try: git push -u origin main
) else (
    echo.
    echo [OK] Code pushed to GitHub
)
echo.
pause
goto menu

:log
echo.
echo ========================================
echo Commit History (last 10)
echo ========================================
git log --oneline --graph --decorate -10
echo.
pause
goto menu

:newbranch
echo.
echo ========================================
echo Create New Branch
echo ========================================
set /p branchname="Enter new branch name: "
if "!branchname!"=="" (
    echo [ERROR] Branch name cannot be empty
    pause
    goto menu
)
git checkout -b !branchname!
echo.
echo [OK] Branch !branchname! created and switched
pause
goto menu

:checkout
echo.
echo ========================================
echo Switch Branch
echo ========================================
echo Current branches:
git branch
echo.
set /p branchname="Enter branch name to switch: "
if "!branchname!"=="" (
    echo [ERROR] Branch name cannot be empty
    pause
    goto menu
)
git checkout !branchname!
echo.
pause
goto menu

:branches
echo.
echo ========================================
echo All Branches
echo ========================================
echo Local branches:
git branch
echo.
echo Remote branches:
git branch -r
echo.
pause
goto menu

:clone
echo.
echo ========================================
echo Clone Repository
echo ========================================
echo This will clone to a new directory
set /p clonedir="Enter target directory (default: shortdrama-clone): "
if "!clonedir!"=="" set clonedir=shortdrama-clone
echo.
git clone https://github.com/shi0417/shortdrama.git !clonedir!
echo.
if errorlevel 1 (
    echo [ERROR] Clone failed
) else (
    echo [OK] Cloned to: !clonedir!
)
pause
goto menu

:end
echo.
echo Goodbye!
timeout /t 1 >nul
exit /b 0
