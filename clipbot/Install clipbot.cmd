@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0pyproject.toml" (
  echo.
  echo   clipbot is still inside the zip file.
  echo   1. Close this window.
  echo   2. Right-click the clipbot zip file and choose "Extract All", then "Extract".
  echo   3. In the folder that opens, double-click "%~nx0" again.
  echo.
  pause
  exit /b 1
)
title Installing clipbot
echo.
echo   Installing clipbot. The first time takes a few minutes.
echo   Please keep this window open.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo   Something went wrong. Take a photo of this window and send it
  echo   to whoever gave you clipbot.
  echo.
  pause
  exit /b 1
)
echo.
pause
