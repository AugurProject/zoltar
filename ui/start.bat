@echo off
pushd "%~dp0.." || exit /b 1
docker build -f ui/Dockerfile . -t zoltar-ui && docker run --add-host=host.docker.internal:host-gateway zoltar-ui
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
