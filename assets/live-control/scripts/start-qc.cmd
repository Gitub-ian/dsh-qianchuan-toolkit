@echo off
rem ===== QianChuan debug browser launcher (double-click, no approval needed) =====
rem port: 9222   profile: %USERPROFILE%\qc-chrome   Chrome first, Edge fallback
rem This tab (qianchuan login/list) is the start tab: the scripts navigate from it themselves.
setlocal
set "PORT=9222"
set "PROFILE=%USERPROFILE%\qc-chrome"

curl -s -m 2 http://127.0.0.1:%PORT%/json/version >nul 2>&1
if not errorlevel 1 (
  echo [QC] already listening on port %PORT%
  exit /b 0
)

set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" (
  echo [QC] Chrome/Edge not found. Edit the BROWSER line in this file.
  pause
  exit /b 1
)

echo [QC] browser: %BROWSER%
echo [QC] profile: %PROFILE%
start "" "%BROWSER%" ^
 --remote-debugging-port=%PORT% ^
 --remote-allow-origins=* ^
 --user-data-dir="%PROFILE%" ^
 --no-first-run ^
 --no-default-browser-check ^
 --start-maximized ^
 "https://qianchuan.jinritemai.com/login"

echo [QC] waiting for port %PORT% ...
for /l %%i in (1,1,40) do (
  timeout /t 1 /nobreak >nul
  curl -s -m 1 http://127.0.0.1:%PORT%/json/version >nul 2>&1
  if not errorlevel 1 (
    echo [QC] OK port %PORT% ready in %%i s
    exit /b 0
  )
)
echo [QC] FAILED: port not listening.
echo [QC] Hint: close all other Chrome windows first (the profile is locked if Chrome runs).
pause
exit /b 1
