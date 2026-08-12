@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org/
    goto :failed
)

if not exist "package.json" (
    echo [ERROR] package.json was not found.
    goto :failed
)

if not exist ".env" if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo Created .env from .env.example.
)

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 goto :failed
)

set "APP_URL=http://localhost:3000"
echo Starting application...
echo The browser will open automatically when the server is ready.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$url='%APP_URL%'; for($attempt=0; $attempt -lt 60; $attempt++){ try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if($response.StatusCode -ge 200){ Start-Process $url; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }"
call npm start
goto :finished

:failed
echo.
echo Startup failed.

:finished
echo.
pause
endlocal
