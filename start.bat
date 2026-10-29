@echo off
rem Double-click to start YouTube Uploader and open it in your browser.
rem Close this window (or press Ctrl+C) to stop the app.

cd /d "%~dp0"
title YouTube Uploader
set URL=http://localhost:3000
if exist .env (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="BASE_URL" set "URL=%%~b"
)

if not exist node_modules (
  echo Installing dependencies, this only happens the first time...
  call npm install --omit=dev || goto :failed
)

rem Open the browser once the app answers, checking every second for up to a minute.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command ^
  "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%' | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Seconds 1 } }"

call npm start
echo.
echo YouTube Uploader has stopped.
pause
exit /b

:failed
echo.
echo Something went wrong. Check the messages above.
pause
