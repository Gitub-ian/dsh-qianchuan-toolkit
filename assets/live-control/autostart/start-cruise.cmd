@echo off
setlocal
REM Start the qianchuan cruise supervisor shipped with dsh-qianchuan-toolkit.
REM Daily window: 07:00 -> next day 01:00 (override with QC_START / QC_END).
if not defined QC_HOME set "QC_HOME=%USERPROFILE%\.qianchuan-cruise"
set "SCRIPT=%~dp0..\scripts\daily-supervisor.mjs"
rem Prefer an explicit node; otherwise use the one on PATH.
if defined QC_NODE if exist "%QC_NODE%" set "NODE=%QC_NODE%"
if not defined NODE set "NODE=node"
if not exist "%SCRIPT%" ( echo [ERROR] daily-supervisor.mjs not found: %SCRIPT% & exit /b 2 )
if not exist "%QC_HOME%" mkdir "%QC_HOME%" >nul 2>nul
if defined QC_START set "ARGS=--start %QC_START%"
if defined QC_END set "ARGS=%ARGS% --end %QC_END%"
"%NODE%" "%SCRIPT%" %ARGS% >> "%QC_HOME%\watch.out.log" 2>&1
exit /b %errorlevel%
