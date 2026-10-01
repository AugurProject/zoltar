@echo off
REM Double-click entry point for Windows. It runs `bun run ui:publish:local`, which owns every publishing step.
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1

where bun >nul 2>&1
if errorlevel 1 (
    echo Install Bun from https://bun.sh, run bun install in this folder, then run publish.bat again.
    goto failed
)

call bun run ui:publish:local
if errorlevel 1 goto failed

popd
pause
exit /b 0

:failed
echo.
echo Publishing failed. See the error above.
popd
pause
exit /b 1
