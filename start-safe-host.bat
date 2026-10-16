@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  FUTURUM Safe — запуск хоста
echo  ---------------------------
echo.

where py >nul 2>&1
if errorlevel 1 (
  where python >nul 2>&1
  if errorlevel 1 (
    echo [Ошибка] Не найден Python.
    pause
    exit /b 1
  )
  set PY=python
) else (
  set PY=py
)

echo  Хост: http://127.0.0.1:8787/
echo  Для VK открой второй терминал и сделай туннель — см. HOST.md
echo.
%PY% safe-host.py
pause
