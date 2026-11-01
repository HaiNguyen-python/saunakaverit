@echo off
rem Starts Saunakaverit on http://localhost:8130 and opens it as an app window. Safe to run twice.
cd /d "%~dp0"
netstat -ano | findstr /R /C:"127.0.0.1:8130 .*LISTENING" >nul
if errorlevel 1 (
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process py -ArgumentList '-m http.server 8130 --bind 127.0.0.1' -WorkingDirectory '%~dp0.' -WindowStyle Hidden"
)
timeout /t 2 /nobreak >nul
set "URL=http://localhost:8130"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app=%URL%
) else (
  start "" msedge --app=%URL%
)
