@echo off
title Auto Upload to GitHub - PAC Finance Management
color 0B
cd /d "%~dp0"

echo =======================================================
echo    PAC Finance Management - Auto Upload to GitHub
echo =======================================================
echo.

set "GIT_PATH=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if not exist "%GIT_PATH%" set "GIT_PATH=git"

echo [1/3] Adding changes...
"%GIT_PATH%" add .

echo [2/3] Committing changes...
"%GIT_PATH%" commit -m "Update: %DATE% %TIME%"

echo [3/3] Uploading to GitHub...
"%GIT_PATH%" push origin main

if errorlevel 1 goto failed
goto success

:success
echo.
echo =======================================================
echo   [SUCCESS] Uploaded to GitHub successfully!
echo   Vercel is now deploying automatically.
echo =======================================================
goto finished

:failed
echo.
echo =======================================================
echo   [NOTE] If a browser window opened, please Sign In
echo   to authorize GitHub (one-time setup).
echo =======================================================
goto finished

:finished
echo.
echo Press any key to close this window...
pause >nul
