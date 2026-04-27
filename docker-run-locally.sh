#!/usr/bin/env bash
# =============================================================================
#  docker-run-locally.sh
#
#  Convenience wrapper around `docker compose` for Linux / macOS.
#  Mirrors docker-run-locally.bat exactly — same commands, same behaviour.
#
#  Credentials: put DISCORD_TOKEN, DISCORD_APP_ID, ENCRYPTION_KEY and
#  ENABLE_DISCORD=true into .env.production in this directory.
#  Compose loads it via env_file and aborts with a clear error if any
#  required value is missing.
#
#  Usage:
#    ./docker-run-locally.sh              default: up + tail logs
#    ./docker-run-locally.sh up           build and start, tail logs
#    ./docker-run-locally.sh up-detached  build and start, don't tail
#    ./docker-run-locally.sh down         stop stack (volumes preserved)
#    ./docker-run-locally.sh restart      rebuild bot only and restart
#    ./docker-run-locally.sh logs         tail bot logs
#    ./docker-run-locally.sh logs-all     tail logs from all services
#    ./docker-run-locally.sh status       show running containers
#    ./docker-run-locally.sh clean        down + wipe all volumes
#    ./docker-run-locally.sh help         show this help
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")"

ACTION="${1:-up}"

# -----------------------------------------------------------------------------
check_docker() {
  if ! command -v docker &>/dev/null; then
    echo "[docker-run-locally] ERROR: docker not on PATH."
    echo "  Install Docker Engine: https://docs.docker.com/engine/install/"
    exit 1
  fi
  if ! docker info &>/dev/null; then
    echo "[docker-run-locally] ERROR: Docker daemon not running."
    echo "  Start it with: sudo systemctl start docker  (Linux)"
    echo "              or: open Docker Desktop          (macOS)"
    exit 1
  fi
  if ! docker compose version &>/dev/null; then
    echo "[docker-run-locally] ERROR: 'docker compose' plugin missing."
    echo "  Update Docker Desktop, or install the plugin:"
    echo "  https://docs.docker.com/compose/install/"
    exit 1
  fi
}

check_env() {
  if [[ ! -f ".env.production" ]]; then
    echo
    echo "[docker-run-locally] ERROR: .env.production not found in this folder."
    echo
    echo "Copy the template and fill it in:"
    echo "  cp .env.example .env.production"
    echo "  \$EDITOR .env.production"
    echo
    echo "Required values: DISCORD_TOKEN, DISCORD_APP_ID, ENCRYPTION_KEY, ENABLE_DISCORD=true"
    echo
    echo "Generate ENCRYPTION_KEY:"
    echo "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    echo
    exit 1
  fi
}

# -----------------------------------------------------------------------------
cmd_up() {
  check_env
  echo "[docker-run-locally] Building and starting the stack..."
  echo "[docker-run-locally] First boot downloads ~5 GB of models, be patient."
  docker compose up -d --build
  echo
  echo "[docker-run-locally] Stack is up. Tailing bot logs."
  echo "[docker-run-locally] Ctrl+C to stop tailing (containers keep running)."
  echo "[docker-run-locally] Run './docker-run-locally.sh down' to stop everything."
  echo
  docker compose logs -f bot
}

cmd_up_detached() {
  check_env
  echo "[docker-run-locally] Building and starting the stack in the background..."
  docker compose up -d --build
  docker compose ps
}

cmd_down() {
  echo "[docker-run-locally] Stopping stack (volumes preserved)..."
  docker compose down
}

cmd_restart() {
  check_env
  echo "[docker-run-locally] Rebuilding bot image and restarting bot service..."
  docker compose build bot
  docker compose up -d bot
}

cmd_logs() {
  docker compose logs -f bot
}

cmd_logs_all() {
  docker compose logs -f
}

cmd_status() {
  docker compose ps
}

cmd_clean() {
  echo "[docker-run-locally] This will DELETE all volumes (SQLite DB, models)."
  echo "[docker-run-locally] First boot after this will re-download ~5 GB."
  read -r -p "Type YES to confirm: " CONFIRM
  if [[ "$CONFIRM" != "YES" ]]; then
    echo "[docker-run-locally] Aborted."
    exit 0
  fi
  docker compose down -v
  echo "[docker-run-locally] Volumes removed."
}

cmd_help() {
  cat <<'EOF'

docker-run-locally.sh [action]

  up            build and start the stack, then tail bot logs (default)
  up-detached   build and start the stack, return to prompt
  down          stop the stack (volumes preserved)
  restart       rebuild only the bot image and restart just the bot
  logs          tail bot logs
  logs-all      tail logs from every service
  status        show running containers
  clean         stop and wipe ALL volumes (destructive)
  help          show this help

Prerequisites:
  - Docker Engine + Compose v2 running
  - .env.production in this folder with DISCORD_TOKEN, DISCORD_APP_ID,
    ENCRYPTION_KEY, and ENABLE_DISCORD=true
    (cp .env.example .env.production && $EDITOR .env.production)

EOF
}

# -----------------------------------------------------------------------------
check_docker

case "$ACTION" in
  up)           cmd_up ;;
  up-detached)  cmd_up_detached ;;
  down)         cmd_down ;;
  restart)      cmd_restart ;;
  logs)         cmd_logs ;;
  logs-all)     cmd_logs_all ;;
  status)       cmd_status ;;
  clean)        cmd_clean ;;
  help|-h|--help) cmd_help ;;
  *)
    echo "[docker-run-locally] Unknown action: $ACTION"
    echo
    cmd_help
    exit 1
    ;;
esac
