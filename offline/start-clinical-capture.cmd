@echo off
setlocal
cd /d "%~dp0"
echo Starting Clinical Capture offline version...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0offline-server.ps1"
if errorlevel 1 (
  echo.
  echo Start failed. Please make sure a docs folder is beside this folder.
  pause
)
