@echo off
setlocal EnableExtensions
cd /d "%~dp0"

>>"%~dp0start-last.log" echo [%date% %time%] argv=%*

rem Same-console keep-open (avoid `start` flash window).
if /I not "%~1"=="__KEEPOPEN__" (
  >>"%~dp0start-last.log" echo [%date% %time%] relaunch cmd /k
  cmd /k call "%~f0" __KEEPOPEN__
  exit /b 0
)

rem This machine installs Node under D:\Program Files\nodejs (not only C:).
if exist "D:\Program Files\nodejs\node.exe" set "PATH=D:\Program Files\nodejs;%PATH%"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

echo ========================================
echo   ShrineFlow starter
echo ========================================
echo.
>>"%~dp0start-last.log" echo [%date% %time%] keepopen begin

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Expected: D:\Program Files\nodejs\node.exe
  echo Install: https://nodejs.org/
  >>"%~dp0start-last.log" echo [%date% %time%] FAIL no node
  goto :hold
)

echo Node:
node -v
where node
echo.

if not exist "package.json" (
  echo [ERROR] package.json missing. Wrong folder?
  >>"%~dp0start-last.log" echo [%date% %time%] FAIL no package.json
  goto :hold
)

if not exist ".env" if exist ".env.example" (
  copy /y ".env.example" ".env" >nul
  echo Created .env from .env.example.
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    >>"%~dp0start-last.log" echo [%date% %time%] FAIL npm install
    goto :hold
  )
)

rem Closing the console often leaves orphan node --watch children.
echo Stopping any leftover server on port 3000...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
echo.

set "APP_URL=http://localhost:3000"
echo Starting... Browser opens at %APP_URL%
echo Close this window to stop. If page still loads after close, run stop.bat.
echo.
>>"%~dp0start-last.log" echo [%date% %time%] npm run dev

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$url='%APP_URL%'; for($attempt=0; $attempt -lt 60; $attempt++){ try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if($response.StatusCode -ge 200){ Start-Process $url; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }"
call npm run dev
set "EXITCODE=%ERRORLEVEL%"
>>"%~dp0start-last.log" echo [%date% %time%] npm exited code=%EXITCODE%
echo.
if not "%EXITCODE%"=="0" (
  echo [ERROR] Server exited with code %EXITCODE%.
  echo If port in use: run stop.bat, then retry.
)

:hold
echo.
echo ----- window stays open -----
echo If failed, open start-last.log in this folder.
echo Close window manually when done. Or run stop.bat to kill server.
echo -----------------------------
cmd /k
