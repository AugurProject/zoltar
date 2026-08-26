@echo off
pushd "%~dp0" || exit /b 1
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
docker compose up --build --force-recreate -d || exit /b 1
echo.
echo Chaos bot started in paused dry-run mode. Dashboard password for user operator:
docker compose exec chaos sh -c "cat .state/dashboard-password" || exit /b 1
echo.
echo Open http://127.0.0.1:4193/ and inspect docker compose logs before enabling execution.
popd
pause
exit /b 0
