@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ========================================
echo   FUTURUM Safe — ТЫ ХОСТ
echo  ========================================
echo.
echo  1) Оставь это окно открытым
echo  2) Открой ВТОРОЕ окно и выполни туннель:
echo.
echo       ssh -R 80:127.0.0.1:8787 nokey@localhost.run
echo.
echo  3) Скопируй ссылку вида https://xxxx.lhr.life
echo  4) Запиши её в файл host.json  (поле "url")
echo     и залей на GitHub  ИЛИ  открой игру так:
echo.
echo       .../safe.html?host=https://xxxx.lhr.life
echo.
echo  Пока это окно и туннель открыты — все видят общее табло.
echo  ========================================
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
echo.
%PY% safe-host.py
pause
