@echo off
pushd "%~dp0" || exit /b 1
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
docker compose --file compose.yaml --project-name zoltar-ui stop zoltar || goto finish
docker compose --file compose.yaml --project-name zoltar-ui build zoltar || goto finish
docker compose --file compose.yaml --project-name zoltar-ui up --no-build --force-recreate zoltar
:finish
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
