@echo off
chcp 65001 >nul
title lc-coach 自检
echo 正在检查 http://127.0.0.1:8099 ...
echo.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8099/api/today' -TimeoutSec 5 -UseBasicParsing; $j = $r.Content | ConvertFrom-Json; Write-Host '[OK] 服务在跑' -ForegroundColor Green; Write-Host ('     今日 dayNo=' + $j.dayNo + '  题目=' + ($j.slugs -join ', ')) } catch { Write-Host '[未启动] 服务没在跑，请双击 启动-免编译.cmd' -ForegroundColor Yellow }"
echo.
pause
