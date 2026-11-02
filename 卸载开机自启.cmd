@echo off
chcp 65001 >nul
title 卸载 lc-coach 开机自启
schtasks /Delete /TN "lc-coach" /F
echo.
echo 已删除计划任务（若提示找不到，说明本来就没装）。
pause
