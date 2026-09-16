@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1

docker info >nul 2>&1
if errorlevel 1 (
    echo Start Docker Desktop with Linux containers, then run publish.bat again.
    goto failed
)

if not defined IPFS_API set "IPFS_API=/dns4/host.docker.internal/tcp/5001"
echo Checking your local IPFS node...
docker run --rm --entrypoint ipfs ipfs/kubo:v0.25.0@sha256:0c17b91cab8ada485f253e204236b712d0965f3d463cb5b60639ddd2291e7c52 --api "%IPFS_API%" --timeout=10s id >nul
if errorlevel 1 (
    echo Could not connect to your local IPFS API from Docker.
    echo Start your IPFS node and ensure its API is reachable from Docker.
    echo The default endpoint is host.docker.internal:5001.
    echo For a different endpoint, set IPFS_API to its Kubo API multiaddress.
    goto failed
)

echo Building Zoltar, Statoblast, Trading, and the IPFS publisher...
docker build --target local-publisher -f ui/Dockerfile . -t zoltar-local-ipfs-publisher
if errorlevel 1 goto failed

echo Publishing all three UIs...
docker run --rm -e IPFS_API zoltar-local-ipfs-publisher
if errorlevel 1 goto failed

echo.
echo All three UIs are pinned on your local IPFS node. Keep it running to serve them.
popd
pause
exit /b 0

:failed
echo.
echo Publishing failed. See the error above.
popd
pause
exit /b 1
