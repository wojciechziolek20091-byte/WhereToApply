@echo off
title clipbot
cd /d "%~dp0"
set "UV=uv"
where uv >nul 2>nul || set "UV=%USERPROFILE%\.local\bin\uv.exe"
"%UV%" run --frozen --no-dev clipbot start
if errorlevel 1 (
  echo.
  echo   clipbot stopped because of a problem. Take a photo of this window
  echo   and send it to whoever gave you clipbot.
  echo.
  pause
)
