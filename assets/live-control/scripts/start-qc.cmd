@echo off
chcp 65001 >nul
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist %CHROME% (
  echo 找不到 Chrome 或 Edge，请手动改本文件里的浏览器路径。
  pause
  exit /b 1
)
echo 启动调试浏览器（端口 9222）...
start "" %CHROME% --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%USERPROFILE%\qc-chrome" --no-first-run --no-default-browser-check --start-maximized "https://qianchuan.jinritemai.com/overall-prom"
echo 已启动。登录千川并停在「全域投放 · 推直播间」列表，再运行 cruise.mjs。
