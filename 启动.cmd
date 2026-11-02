@echo off
chcp 65001 >nul
cd /d "%~dp0"
title lc-coach

echo ============================================
echo   lc-coach 刷题教练
echo ============================================
echo.

echo [1/2] 编译打包...
call "D:\Maven\apache-maven-3.6.3\bin\mvn.cmd" -q -DskipTests package
if errorlevel 1 (
    echo.
    echo [失败] 打包失败，请检查上面的报错。
    pause
    exit /b 1
)

echo [2/2] 启动服务...
echo.
echo   地址: http://127.0.0.1:8099
echo   关闭本窗口即停止服务
echo.
start "" http://127.0.0.1:8099
"E:\Program Files\Java\jdk-21\bin\java.exe" -jar target\lc-coach-1.0.0.jar
pause
