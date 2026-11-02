@echo off
chcp 65001 >nul
cd /d "%~dp0"
title lc-coach
echo lc-coach -> http://127.0.0.1:8099
start "" http://127.0.0.1:8099
"E:\Program Files\Java\jdk-21\bin\java.exe" -jar target\lc-coach-1.0.0.jar
pause
