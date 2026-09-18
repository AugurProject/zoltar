@echo off
setlocal
set "chaos_exit_code=0"
set "chaos_pushed=0"
pushd "%~dp0" || goto failed
set "chaos_pushed=1"
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || goto failed
if /I "%~1"=="doctor" goto doctor
docker compose stop || goto failed
docker compose build || goto failed
docker compose run --rm --no-deps chaos bun src/cli/doctor.ts --if-live-capable || goto failed
docker compose up --no-build --force-recreate -d || goto failed
echo.
echo Chaos bot started with its persisted configuration.
echo A first-ever volume uses the paused dry-run template; an existing volume may resume due live work immediately.
echo Open http://127.0.0.1:4193/ and inspect docker compose logs and Activity before changing execution.
docker compose logs --follow chaos || goto failed
goto finish

:doctor
docker compose build || goto failed
docker compose run --rm --no-deps chaos bun run doctor || goto failed
echo.
echo Chaos stopped-process launch preflight passed. Run start.bat without arguments to start the persisted policy.

goto finish

:failed
set "chaos_exit_code=%errorlevel%"
echo.
echo Chaos startup or log monitoring failed. Review the error above.
echo For an existing container, run docker compose logs chaos from this directory.

:finish
if "%chaos_pushed%"=="1" popd
pause
exit /b %chaos_exit_code%
