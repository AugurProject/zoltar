@echo off
pushd "%~dp0.." || exit /b 1
docker build --target local-runtime -f ui/Dockerfile . -t zoltar-ui && docker run --rm -p 8080:8080 zoltar-ui
set "exit_code=%errorlevel%"
popd
pause
exit /b %exit_code%
