@echo off
rem ===== QianChuan COPY debug browser launcher (port 9223, separate instance) =====
rem This instance is dedicated to the plan-copy skill so it never fights the cruise tab on 9222.
rem port: 9223   profile: %USERPROFILE%\qc-chrome-copy   Chrome first, Edge fallback
rem First run: log in to QianChuan in this window once; the login is kept in this profile.
setlocal
set "PORT=9223"
set "PROFILE=%USERPROFILE%\qc-chrome-copy"

curl -s -m 2 http://127.0.0.1:%PORT%/json/version >nul 2>&1
if not errorlevel 1 (
  echo [QC-COPY] already listening on port %PORT%
  exit /b 0
)

set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" (
  echo [QC-COPY] Chrome/Edge not found. Edit the BROWSER line in this file.
  pause
  exit /b 1
)

echo [QC-COPY] browser: %BROWSER%
echo [QC-COPY] profile: %PROFILE%
start "" "%BROWSER%" ^
 --remote-debugging-port=%PORT% ^
 --remote-allow-origins=* ^
 --user-data-dir="%PROFILE%" ^
 --no-first-run ^
 --no-default-browser-check ^
 --start-maximized ^
 "https://qianchuan.jinritemai.com/login"

echo [QC-COPY] waiting for port %PORT% ...
for /l %%i in (1,1,40) do (
  timeout /t 1 /nobreak >nul
  curl -s -m 1 http://127.0.0.1:%PORT%/json/version >nul 2>&1
  if not errorlevel 1 (
    echo [QC-COPY] OK port %PORT% ready in %%i s
    exit /b 0
  )
)
echo [QC-COPY] FAILED: port not listening.
echo [QC-COPY] Hint: this profile runs in its own window; keep it open while copying.
pause
exit /b 1
