@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在推送到 GitHub（zhener12138/lc-coach）...
git push origin master
if %errorlevel%==0 (
  echo.
  echo ✓ 推送成功。
) else (
  echo.
  echo ✗ 推送失败。若提示 SSH 权限，先在任意终端手动跑一次: ssh -T git@github.com
)
pause
