@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
set "JAVA=%ROOT%tools\jdk-17.0.21+9\bin\javaw.exe"
if not exist "%JAVA%" set "JAVA=javaw.exe"

start "" "%JAVA%" -jar "%ROOT%dist\kotatsu-desktop.jar" --web "%ROOT%dist\web" --data "%ROOT%data" --no-open

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8787/api/health')|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% equ 0 goto open
set /a tries+=1
if %tries% lss 15 goto wait

:open
set "BRAVE=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
if exist "%BRAVE%" (
  start "" "%BRAVE%" --app=http://127.0.0.1:8787/ --window-size=1440,900
) else (
  start "" "http://127.0.0.1:8787/"
)

