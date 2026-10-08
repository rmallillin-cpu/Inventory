@echo off
setlocal enabledelayedexpansion
REM Push Thea to https://github.com/rmallillin-cpu/Inventory
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

echo Checking connection to GitHub...
git ls-remote %REPO_URL% >nul 2>&1
if errorlevel 1 (
    nslookup github.com >nul 2>&1
    if errorlevel 1 (
        echo.
        echo CANNOT REACH GITHUB - this is a network/DNS problem, not a Git problem.
        echo Your commit is saved. Try: connect to working internet, turn off VPN/proxy,
        echo run "ipconfig /flushdns", or set DNS to 8.8.8.8. Then run this script again.
        pause & exit /b 1
    )
)

REM Clear any half-finished merge from an earlier run
git merge --abort >nul 2>&1

echo Pushing... sign in to GitHub as rmallillin-cpu if a browser window opens.
git push -u origin main > push.log 2>&1
if errorlevel 1 (
    type push.log
    findstr /i /c:"denied to" /c:"403" /c:"Authentication failed" push.log >nul
    if not errorlevel 1 (
        echo.
        echo LOGIN PROBLEM: Windows saved a different GitHub account than rmallillin-cpu.
        echo Open Start menu - "Credential Manager" - Windows Credentials, remove every
        echo entry named git:https://github.com, then run this script again and sign in
        echo as rmallillin-cpu.
        del push.log
        pause & exit /b 1
    )
    findstr /i /c:"rejected" /c:"fetch first" /c:"non-fast-forward" push.log >nul
    if errorlevel 1 ( echo Push failed for another reason - see message above. & del push.log & pause & exit /b 1 )
    echo.
    echo GitHub has older commits. Merging them in, keeping your newer files...
    git pull origin main --allow-unrelated-histories -X ours --no-edit
    if errorlevel 1 ( echo Merge failed. Run: git merge --abort & del push.log & pause & exit /b 1 )
    git push -u origin main
    if errorlevel 1 ( echo Push still failed. & del push.log & pause & exit /b 1 )
)
del push.log >nul 2>&1

echo.
echo Done: https://github.com/rmallillin-cpu/Inventory
echo Next: deploy on Render ^(NOT GitHub Pages - Pages cannot run this Node server^).
pause
