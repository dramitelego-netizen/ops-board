@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  OPS Board — запуск мониторинга
echo  --------------------------------
echo  Сайт локально:  http://127.0.0.1:5173/
echo  Сайт на GitHub: https://dramitelego-netizen.github.io/ops-board/
echo.
echo  События редактируй в файле events.json
echo  (потом можно будет подтягивать из VK)
echo.

where py >nul 2>&1
if errorlevel 1 (
  echo [Ошибка] Не найден Python. Установите Python и повторите.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:5173/"
py monitor.py
pause
