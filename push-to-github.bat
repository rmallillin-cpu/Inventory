@echo off
setlocal enabledelayedexpansion

REM =========================================================
REM  Push Bias Wreck Supply (KPOP Inventory) to GitHub
REM  Repo: https://github.com/rmallillin-cpu/Inventory.git
REM =========================================================

set REPO_URL=https://github.com/rmallillin-cpu/Inventory.git

echo.
echo === Bias Wreck Supply - GitHub push ===
echo.

REM --- Make sure this script is running from the project folder ---
if not exist "package.json" (
    echo ERROR: package.json not found in this folder.
    echo Please put this .bat file inside the kpop-inventory project folder
    echo ^(the same folder that contains server.js and package.json^) and run it again.
    pause
    exit /b 1
)

REM --- Check git is installed ---
git --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed or not on your PATH.
    echo Download it from https://git-scm.com/download/win and run this script again.
    pause
    exit /b 1
)

REM --- Safety check: make sure .env is not about to be committed ---
if exist ".env" (
    findstr /x ".env" .gitignore >nul 2>&1
    if errorlevel 1 (
        echo WARNING: .env exists but is not listed in .gitignore.
        echo Your secrets (Google keys, password hash) could get pushed publicly.
        echo Aborting for safety - check your .gitignore then re-run this script.
        pause
        exit /b 1
    )
)

REM --- Init git repo if needed ---
if not exist ".git" (
    echo Initializing git repository...
    git init
    git branch -M main
) else (
    echo Git repository already initialized, continuing...
)

REM --- Stage and commit ---
echo.
echo Staging files...
git add .

git diff --cached --quiet
if errorlevel 1 (
    set /p COMMITMSG="Enter a commit message (or press Enter for default): "
    if "!COMMITMSG!"=="" set COMMITMSG=Update KPOP inventory app
    git commit -m "!COMMITMSG!"
) else (
    echo No changes to commit - skipping commit step.
)

REM --- Connect the remote ---
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo Linking to %REPO_URL% ...
    git remote add origin %REPO_URL%
) else (
    echo Remote "origin" already set, making sure it points to the right repo...
    git remote set-url origin %REPO_URL%
)

REM --- Push ---
echo.
echo Pushing to GitHub. A browser window may open asking you to log in to GitHub -
echo sign in there and this will continue automatically.
echo.
git push -u origin main

if errorlevel 1 (
    echo.
    echo Push did not complete. Common reasons:
    echo   - You need to log in to GitHub when the browser/prompt appears
    echo   - The remote repo already has commits that conflict with yours
    echo     ^(try: git pull origin main --allow-unrelated-histories^)
    pause
    exit /b 1
)

echo.
echo === Done! Your code is live at: ===
echo https://github.com/rmallillin-cpu/Inventory
echo.
echo Next step: go to render.com and deploy this repo as a Web Service.
echo See README.md section 5 for the exact settings.
echo.
pause
