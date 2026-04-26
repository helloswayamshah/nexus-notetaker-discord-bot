@echo off
REM =========================================================================
REM  docker-run-locally.bat
REM
REM  Convenience wrapper around `docker compose` for Windows laptops.
REM  Runs the full stack (bot + ollama + model init) locally against
REM  Docker Desktop using the same docker-compose.yml production uses.
REM
REM  Credentials: put DISCORD_TOKEN, DISCORD_APP_ID, ENCRYPTION_KEY and
REM  ENABLE_DISCORD=true into .env.production in this directory.
REM  Compose loads it via env_file and aborts with a clear error if any
REM  required value is missing.
REM
REM  Usage:
REM    docker-run-locally.bat              default: up + tail logs
REM    docker-run-locally.bat up           build and start, tail logs
REM    docker-run-locally.bat up-detached  build and start, don't tail
REM    docker-run-locally.bat down         stop stack (volumes preserved)
REM    docker-run-locally.bat restart      rebuild bot only and restart
REM    docker-run-locally.bat logs         tail bot logs
REM    docker-run-locally.bat logs-all     tail logs from all services
REM    docker-run-locally.bat status       show running containers
REM    docker-run-locally.bat clean        down + wipe all volumes
REM    docker-run-locally.bat help         show this help
REM =========================================================================

setlocal

pushd "%~dp0" >nul

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=up"

if /i "%ACTION%"=="help"    goto usage
if /i "%ACTION%"=="-h"      goto usage
if /i "%ACTION%"=="--help"  goto usage
if /i "%ACTION%"=="/?"      goto usage

call :check_docker
if errorlevel 1 goto fail

if /i "%ACTION%"=="up"           goto up_attached
if /i "%ACTION%"=="up-detached"  goto up_detached
if /i "%ACTION%"=="down"         goto down
if /i "%ACTION%"=="restart"      goto restart
if /i "%ACTION%"=="logs"         goto logs_bot
if /i "%ACTION%"=="logs-all"     goto logs_all
if /i "%ACTION%"=="status"       goto status
if /i "%ACTION%"=="clean"        goto clean

echo [docker-run-locally] Unknown action: %ACTION%
echo.
goto usage

REM -------------------------------------------------------------------------
:up_attached
call :check_env
if errorlevel 1 goto fail
echo [docker-run-locally] Building and starting the stack...
echo [docker-run-locally] First boot downloads ~5 GB of models, be patient.
docker compose up -d --build
if errorlevel 1 goto fail
echo.
echo [docker-run-locally] Stack is up. Tailing bot logs.
echo [docker-run-locally] Ctrl+C to stop tailing (containers keep running).
echo [docker-run-locally] Run "docker-run-locally.bat down" to stop everything.
echo.
docker compose logs -f bot
goto done

REM -------------------------------------------------------------------------
:up_detached
call :check_env
if errorlevel 1 goto fail
echo [docker-run-locally] Building and starting the stack in the background...
docker compose up -d --build
if errorlevel 1 goto fail
docker compose ps
goto done

REM -------------------------------------------------------------------------
:down
echo [docker-run-locally] Stopping stack (volumes preserved)...
docker compose down
if errorlevel 1 goto fail
goto done

REM -------------------------------------------------------------------------
:restart
call :check_env
if errorlevel 1 goto fail
echo [docker-run-locally] Rebuilding bot image and restarting bot service...
docker compose build bot
if errorlevel 1 goto fail
docker compose up -d bot
if errorlevel 1 goto fail
goto done

REM -------------------------------------------------------------------------
:logs_bot
docker compose logs -f bot
goto done

REM -------------------------------------------------------------------------
:logs_all
docker compose logs -f
goto done

REM -------------------------------------------------------------------------
:status
docker compose ps
goto done

REM -------------------------------------------------------------------------
:clean
echo [docker-run-locally] This will DELETE all volumes (SQLite DB, models).
echo [docker-run-locally] First boot after this will re-download ~5 GB.
set /p "CONFIRM=Type YES to confirm: "
if /i not "%CONFIRM%"=="YES" (
  echo [docker-run-locally] Aborted.
  goto done
)
docker compose down -v
if errorlevel 1 goto fail
echo [docker-run-locally] Volumes removed.
goto done

REM -------------------------------------------------------------------------
:check_docker
where docker >nul 2>nul
if errorlevel 1 (
  echo [docker-run-locally] ERROR: docker not on PATH. Install Docker Desktop from:
  echo   https://www.docker.com/products/docker-desktop/
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo [docker-run-locally] ERROR: Docker daemon not running. Start Docker Desktop.
  exit /b 1
)
docker compose version >nul 2>nul
if errorlevel 1 (
  echo [docker-run-locally] ERROR: 'docker compose' plugin missing. Update Docker Desktop.
  exit /b 1
)
exit /b 0

REM -------------------------------------------------------------------------
:check_env
if not exist ".env.production" (
  echo.
  echo [docker-run-locally] ERROR: .env.production not found in this folder.
  echo.
  echo Copy the template and fill it in:
  echo     copy .env.example .env.production
  echo     notepad .env.production
  echo.
  echo Required values: DISCORD_TOKEN, DISCORD_APP_ID, ENCRYPTION_KEY, ENABLE_DISCORD=true
  echo.
  echo Generate ENCRYPTION_KEY with one of:
  echo     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  echo     docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  echo.
  exit /b 1
)
exit /b 0

REM -------------------------------------------------------------------------
:usage
echo.
echo docker-run-locally.bat [action]
echo.
echo   up            build and start the stack, then tail bot logs (default)
echo   up-detached   build and start the stack, return to prompt
echo   down          stop the stack (volumes preserved)
echo   restart       rebuild only the bot image and restart just the bot
echo   logs          tail bot logs
echo   logs-all      tail logs from every service
echo   status        show running containers
echo   clean         stop and wipe ALL volumes (destructive)
echo   help          show this help
echo.
echo Prerequisites:
echo   - Docker Desktop running
echo   - .env.production in this folder with DISCORD_TOKEN, DISCORD_APP_ID,
echo     ENCRYPTION_KEY, and ENABLE_DISCORD=true
echo     (copy .env.example to .env.production and edit)
echo.
goto done

REM -------------------------------------------------------------------------
:fail
popd >nul
endlocal
exit /b 1

:done
popd >nul
endlocal
exit /b 0
