@echo off
setlocal
set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo Starting NAS100 service...
start "NAS100 service" cmd /k "cd /d "%PROJECT_DIR%" && npm run service"

echo Starting NAS100 dashboard (vite)...
start "NAS100 dashboard" cmd /k "cd /d "%PROJECT_DIR%" && npm run dev"

echo Waiting for dashboard to boot...
timeout /t 6 /nobreak >nul

start chrome "http://localhost:5173"

endlocal
