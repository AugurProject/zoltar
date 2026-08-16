@echo off
pushd "%~dp0" || exit /b 1
if not exist .env (
	echo Copy .env.example to .env and set RETH_RECEIPTS_START_BLOCK first.
	popd
	pause
	exit /b 1
)
docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1
docker compose up --force-recreate
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
