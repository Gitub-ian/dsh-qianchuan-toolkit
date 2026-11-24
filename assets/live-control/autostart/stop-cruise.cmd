@echo off
setlocal
if not defined QC_HOME set "QC_HOME=%USERPROFILE%\.qianchuan-cruise"
echo Stopping qianchuan cruise ...
if exist "%QC_HOME%\supervisor.pid" (
  set /p SPID=<"%QC_HOME%\supervisor.pid"
  taskkill /PID %SPID% /F >nul 2>nul
  echo   supervisor pid %SPID% killed
  del /q "%QC_HOME%\supervisor.pid" >nul 2>nul
) else ( echo   no supervisor.pid found )
if exist "%QC_HOME%\watch.pid" (
  set /p WPID=<"%QC_HOME%\watch.pid"
  taskkill /PID %WPID% /F >nul 2>nul
  echo   cruise pid %WPID% killed
  del /q "%QC_HOME%\watch.pid" >nul 2>nul
) else ( echo   no watch.pid found )
echo Done.
exit /b 0
