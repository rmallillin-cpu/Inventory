@echo off
setlocal enabledelayedexpansion
REM Push Bias Wreck Supply to https://github.com/rmallillin-cpu/Inventory
set REPO_URL=https://github.com/rmallillin-cpu/Inventory.git

if not exist "package.json" (
    echo ERROR: run this file from inside the kpop-inventory folder ^(next to package.json^).
    pause & exit /b 1
)
git --version >nul 2>&1 || ( echo ERROR: Git not installed. Get it from https://git-scm.com/download/win & pause & exit /b 1 )

REM Never push secrets
if exist ".env" (
    findstr /x ".env" .gitignore >nul 2>&1 || ( echo ERROR: .env is not in .gitignore. Aborting. & pause & exit /b 1 )
)

if not exist ".git" git init
git branch -M main

REM Git refuses to commit without an identity
for /f "delims=" %%i in ('git config user.name') do set GNAME=%%i
if "!GNAME!"=="" git config user.name "rmallillin-cpu"
for /f "delims=" %%i in ('git config user.email') do set GMAIL=%%i
if "!GMAIL!"=="" git config user.email "rmallillin-cpu@users.noreply.github.com"

git add -A
git diff --cached --quiet
if errorlevel 1 (
    set /p MSG="Commit message (Enter for default): "
    if "!MSG!"=="" set MSG=Update KPOP inventory app
    git commit -m "!MSG!"
) else (
    echo Nothing new to commit.
)

git remote get-url origin >nul 2>&1
if errorlevel 1 ( git remote add origin %REPO_URL% ) else ( git remote set-url origin %REPO_URL% )

echo Pushing... sign in to GitHub if a browser window opens.
git push -u origin main
if errorlevel 1 (
    echo.
    echo Push rejected - the repo already has commits. Merging them in, then retrying...
    git pull origin main --allow-unrelated-histories --no-edit
    if errorlevel 1 (
        echo.
        echo Merge conflict. Resolve the files git lists, then run this script again.
        echo Or, to REPLACE what is on GitHub with this folder: git push -u origin main --force
        pause & exit /b 1
    )
    git push -u origin main
    if errorlevel 1 ( echo Push still failed. Check your GitHub login. & pause & exit /b 1 )
)

echo.
echo Done: https://github.com/rmallillin-cpu/Inventory
echo Next: deploy on Render ^(NOT GitHub Pages - Pages cannot run this Node server^).
pause
