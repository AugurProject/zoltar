@echo off
pushd "%~dp0" || exit /b 1
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
docker compose up --build --force-recreate
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
