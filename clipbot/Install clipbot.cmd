@echo off
setlocal
cd /d "%~dp0"
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
