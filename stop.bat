@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Stopping ShrineFlow server...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
echo.
pause
