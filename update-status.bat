@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Обновляю status.json...
py scripts\check_servers.py
if errorlevel 1 (
  echo Ошибка проверки серверов.
  pause
  exit /b 1
)

echo.
echo Готово. Чтобы выложить на GitHub Pages:
echo   git add status.json events.json
echo   git commit -m "update status"
echo   git push
echo.
pause
