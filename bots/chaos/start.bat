@echo off
pushd "%~dp0" || exit /b 1
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
if /I "%~1"=="doctor" goto doctor
docker compose build || exit /b 1
docker compose run --rm --no-deps chaos bun src/cli/doctor.ts --if-live-capable || exit /b 1
docker compose up --build --force-recreate -d || exit /b 1
echo.
echo Chaos bot started with its persisted configuration.
echo A first-ever volume uses the paused dry-run template; an existing volume may resume due live work immediately.
echo Dashboard password for user operator:
docker compose exec chaos sh -c "cat .state/dashboard-password" || exit /b 1
echo.
echo Open http://127.0.0.1:4193/ and inspect docker compose logs and Activity before changing execution.
goto finish

:doctor
docker compose build || exit /b 1
docker compose run --rm --no-deps chaos bun run doctor || exit /b 1
echo.
echo Chaos stopped-process launch preflight passed. Run start.bat without arguments to start the persisted policy.

:finish
popd
pause
exit /b 0
