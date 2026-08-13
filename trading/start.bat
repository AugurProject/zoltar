@echo off
pushd "%~dp0" || exit /b 1
docker compose up --build --force-recreate
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
