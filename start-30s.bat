@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  OPS Board — обновление статуса каждые 30 секунд
echo  ------------------------------------------------
echo  Нужен файл .env с VK_COMMUNITY_TOKEN
echo  (кнопка "Получить токен" в приложении VK)
echo.
echo  Пока это окно открыто — виджет в группе обновляется.
echo  Закроете окно — обновления остановятся.
echo.

where py >nul 2>&1
if errorlevel 1 (
  echo [Ошибка] Не найден Python.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [Внимание] Нет файла .env
  echo Создайте .env из .env.example и вставьте токен.
  echo.
)

py scripts\watch_30s.py
pause
