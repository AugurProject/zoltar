@echo off
pushd "%~dp0" || exit /b 1
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
docker compose --file compose.yaml --project-name zoltar-statoblast stop statoblast || goto finish
docker compose --file compose.yaml --project-name zoltar-statoblast build statoblast || goto finish
docker compose --file compose.yaml --project-name zoltar-statoblast up --no-build --force-recreate statoblast
:finish
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
