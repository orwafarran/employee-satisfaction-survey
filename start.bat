@echo off
title Employee Satisfaction Survey
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this PC yet.
  echo   I will open the download page now.
  echo   Click the big green "LTS" button, then run the installer
  echo   ^(just click Next / Next / Install^).
  echo   When it finishes, double-click this Start file again.
  echo.
  pause
  start https://nodejs.org/en/download
  exit /b
)

if not exist node_modules (
  echo.
  echo   First-time setup - installing the app components.
  echo   This happens only once and may take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Setup could not finish. Please check your internet connection
    echo   and double-click this Start file again.
    echo.
    pause
    exit /b
  )
)

echo.
echo   Starting the Employee Satisfaction Survey...
echo   Your dashboard will open in the browser in a few seconds.
echo.
start "" /min cmd /c "timeout /t 4 >nul && start http://localhost:3000/admin"
node server/server.js

echo.
echo   The app has stopped. You can close this window.
pause
