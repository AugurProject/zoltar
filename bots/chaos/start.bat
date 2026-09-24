@echo off
setlocal
set "chaos_exit_code=0"
set "chaos_pushed=0"
pushd "%~dp0" || goto failed
set "chaos_pushed=1"
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || goto failed
if /I "%~1"=="doctor" goto doctor
rem Include earlier one-off launcher containers while retaining state volumes.
docker compose down --remove-orphans --timeout 60 || goto failed
docker compose build || goto failed

:prepare_current
docker compose run --rm --no-deps chaos bun src/cli/deployment-upgrade.ts prepare
set "chaos_prepare_exit=%errorlevel%"
if "%chaos_prepare_exit%"=="10" goto start_retirement
if not "%chaos_prepare_exit%"=="0" (
	set "chaos_exit_code=%chaos_prepare_exit%"
	goto failed
)

:start_current
docker compose run --rm --no-deps chaos bun src/cli/doctor.ts --if-live-capable || goto failed
docker compose up --no-build --force-recreate -d || goto failed
echo.
echo Chaos bot started with the current contract deployment.
echo A first-ever volume uses the paused dry-run template; an existing volume may resume due live work immediately.
echo Open http://127.0.0.1:4193/ and inspect docker compose logs and Activity before changing execution.
docker compose logs --follow chaos || goto failed
goto finish

:start_retirement
docker compose run --rm --no-deps chaos bun src/cli/doctor.ts --if-live-capable || goto failed
docker compose up --no-build --force-recreate -d || goto failed
echo.
echo The old deployment is retiring. Its configuration and state remain in place.
echo Open http://127.0.0.1:4193/ to monitor Retirement and resolve blockers.
echo Keep this window open to switch automatically after verified completion.
echo If you close it, retirement continues in Docker; run start.bat again later.

:wait_retirement
timeout /t 60 /nobreak >nul
docker compose run -T --rm --no-deps chaos bun src/cli/deployment-upgrade.ts status
set "chaos_status_exit=%errorlevel%"
if "%chaos_status_exit%"=="10" goto wait_retirement
if not "%chaos_status_exit%"=="0" (
	set "chaos_exit_code=%chaos_status_exit%"
	goto failed
)
docker compose down --remove-orphans --timeout 60 || goto failed
goto prepare_current

:doctor
docker compose build || goto failed
docker compose run --rm --no-deps chaos bun run doctor || goto failed
echo.
echo Chaos stopped-process launch preflight passed. Run start.bat without arguments to start the persisted policy.

goto finish

:failed
if "%chaos_exit_code%"=="0" set "chaos_exit_code=%errorlevel%"
echo.
echo Chaos startup or log monitoring failed. Review the error above.
echo For an existing container, run docker compose logs chaos from this directory.

:finish
if "%chaos_pushed%"=="1" popd
pause
exit /b %chaos_exit_code%
