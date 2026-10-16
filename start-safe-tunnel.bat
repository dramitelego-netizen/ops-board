@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  FUTURUM Safe — туннель
echo  ----------------------
echo  Сначала должен работать start-safe-host.bat
echo  Ссылка сама запишется в host.json
echo  Потом: git add host.json ^& git commit -m "host" ^& git push
echo.
echo  Не закрывай это окно!
echo.

where py >nul 2>&1 && set PY=py || set PY=python

%PY% -u "%~dp0capture-tunnel.py"
echo.
pause
