@echo off
pushd "%~dp0" || exit /b 1
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
docker volume create zoltar-bot-signer-locks >nul || goto finish
docker compose stop || goto finish
docker compose build || goto finish
docker compose up --no-build --force-recreate
:finish
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
