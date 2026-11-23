@echo off
title clipbot
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
