@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  FUTURUM Safe — туннель (окно 2)
echo  --------------------------------
echo  Сначала запусти start-safe-host.bat
echo  Потом это окно. Скопируй https://....lhr.life
echo.
echo  Ctrl+C — остановить туннель
echo.

ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -R 80:127.0.0.1:8787 nokey@localhost.run
echo.
echo  Туннель закрыт.
pause
