@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  Вставь URL туннеля (https://....lhr.life) и нажми Enter:
set /p HOSTURL=
if "%HOSTURL%"=="" (
  echo Пусто — отмена.
  pause
  exit /b 1
)

where py >nul 2>&1 && set PY=py || set PY=python
%PY% -c "import json,pathlib,datetime; u=r'''%HOSTURL%'''.strip().rstrip('/'); pathlib.Path('host.json').write_text(json.dumps({'url':u,'updated':datetime.datetime.now(datetime.timezone.utc).strftime('%%Y-%%m-%%dT%%H:%%M:%%SZ')},ensure_ascii=False,indent=2)+chr(10),encoding='utf-8'); print('OK host.json ->',u)"

echo.
echo  Готово. Теперь залей host.json на GitHub:
echo    git add host.json
echo    git commit -m "Update host URL"
echo    git push
echo.
echo  Или открой мини-апп так:
echo    https://dramitelego-netizen.github.io/ops-board/safe.html?host=%HOSTURL%
echo.
pause
