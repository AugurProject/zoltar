@echo off
pushd "%~dp0" || exit /b 1
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
docker compose --file compose.yaml --project-name zoltar-openoracle stop openoracle || goto finish
docker compose --file compose.yaml --project-name zoltar-openoracle build openoracle || goto finish
docker compose --file compose.yaml --project-name zoltar-openoracle up --no-build --force-recreate openoracle
:finish
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
