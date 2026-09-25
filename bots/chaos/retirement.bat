@echo off
setlocal
set "chaos_exit_code=0"
set "chaos_pushed=0"
pushd "%~dp0" || goto failed
set "chaos_pushed=1"
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || goto failed
if "%~1"=="" goto list_archives
rem Stop both the regular service and any interrupted retirement container.
docker compose down --remove-orphans --timeout 60 || goto failed
docker compose build || goto failed
docker compose run --rm --no-deps chaos bun src/cli/deployment-upgrade.ts retire "%~1" || goto failed
set "chaos_retirement_config=.state/operator.json.retired-%~1.json"

:start_retirement
docker compose run -d --name zoltar-chaos-retirement --service-ports --no-deps -e "ZOLTAR_CHAOS_CONFIG=%chaos_retirement_config%" chaos || goto failed
echo.
echo Retiring the selected archived deployment. The current configuration is preserved.
echo Open http://127.0.0.1:4193/ to monitor Retirement and resolve blockers.
echo Inspect errors with docker logs zoltar-chaos-retirement.
echo Keep this window open to restart the current deployment after verified completion.
echo Run retirement.bat with the same archive ID to resume, or start.bat to return to the latest contracts.

:wait_retirement
timeout /t 60 /nobreak >nul
docker compose run -T --rm --no-deps -e "ZOLTAR_CHAOS_CONFIG=%chaos_retirement_config%" chaos bun src/cli/deployment-upgrade.ts status
set "chaos_status_exit=%errorlevel%"
if "%chaos_status_exit%"=="10" goto wait_retirement
if not "%chaos_status_exit%"=="0" (
	set "chaos_exit_code=%chaos_status_exit%"
	goto failed
)
docker compose down --remove-orphans --timeout 60 || goto failed
rem Recheck the stopped journal: the running operator may have invalidated completion after the poll.
docker compose run -T --rm --no-deps -e "ZOLTAR_CHAOS_CONFIG=%chaos_retirement_config%" chaos bun src/cli/deployment-upgrade.ts status
set "chaos_status_exit=%errorlevel%"
if "%chaos_status_exit%"=="10" goto start_retirement
if not "%chaos_status_exit%"=="0" (
	set "chaos_exit_code=%chaos_status_exit%"
	goto failed
)
docker compose run --rm --no-deps chaos bun src/cli/deployment-upgrade.ts prepare || goto failed
docker compose run --rm --no-deps chaos bun src/cli/doctor.ts --if-live-capable || goto failed
docker compose up --no-build --force-recreate -d || goto failed
echo Retirement verified. The current deployment is running again.
docker compose logs --follow chaos || goto failed
goto finish

:list_archives
docker compose build || goto failed
docker compose run --rm --no-deps chaos bun src/cli/deployment-upgrade.ts archives || goto failed
echo Run retirement.bat ARCHIVE_ID to retire one of the listed deployments.
goto finish

:failed
if "%chaos_exit_code%"=="0" set "chaos_exit_code=%errorlevel%"
echo.
echo Retirement failed. Review the error above and docker logs zoltar-chaos-retirement.
echo Run start.bat to return to the latest contracts.

:finish
if "%chaos_pushed%"=="1" popd
pause
exit /b %chaos_exit_code%
