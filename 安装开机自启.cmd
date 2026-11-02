@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 安装 lc-coach 开机自启

echo 这会把 lc-coach 注册成「登录时自动启动」的计划任务。
echo 之后每次开机它就在 http://127.0.0.1:8099 等着你，不用再点启动脚本。
echo.
echo 注意：需要管理员权限才能创建计划任务。
echo.

schtasks /Create /TN "lc-coach" /TR "\"E:\Program Files\Java\jdk-21\bin\java.exe\" -jar \"%~dp0target\lc-coach-1.0.0.jar\"" /SC ONLOGON /RL HIGHEST /F

if errorlevel 1 (
    echo.
    echo [失败] 创建计划任务失败。请右键本文件 - 以管理员身份运行。
) else (
    echo.
    echo [成功] 已注册。下次登录 Windows 时 lc-coach 会自动启动。
    echo 立即启动一次：
    schtasks /Run /TN "lc-coach"
)

echo.
pause
