#!/usr/bin/env bash
#
# deploy.sh — deploy ai-recruitment-poc (branch: stich/talentos) to the
# two-server recruithub production topology.
#
#   Server 1 (recruithub-dev-app)     172.235.26.25   Postgres, Redis, API, hr-app, candidate-app, interview-agent
#   Server 2 (recruithub-dev-canary)  172.235.26.53   Celery beat + workers (resume x3, screening, interviews a/b)
#
# Usage (run on the server as root):
#   bash deploy.sh server1    # deploy API + frontends + migrations on Server 1
#   bash deploy.sh server2    # deploy workers on Server 2
#   bash deploy.sh all        # run server1, then ssh into Server 2 and run server2
#   bash deploy.sh logs       # tail service logs for the current server
#   bash deploy.sh status     # compose ps + health checks for the current server
#
# Requires .env.production to already exist next to this script on each server.
# deploy.sh never creates or modifies .env.production (no data loss).

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via env if needed)
# ---------------------------------------------------------------------------
BRANCH="${DEPLOY_BRANCH:-stich/talentos}"

SERVER1_IP="${SERVER1_IP:-172.235.26.25}"
SERVER2_IP="${SERVER2_IP:-172.235.26.53}"
SERVER2_SSH_USER="${SERVER2_SSH_USER:-root}"
SERVER2_SSH_ARGS="${SERVER2_SSH_ARGS:-}"

API_PUBLIC_URL="${API_PUBLIC_URL:-https://api.recruithub.webknot-dev.in}"

# Repo dir = directory containing this script
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_ENV="${REPO_DIR}/.env.production"

DOCKER_COMPOSE="${DOCKER_COMPOSE:-docker compose}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[ERROR] %s\033[0m\n' "$*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "run as root (sudo)"
  fi
}

require_env() {
  if [ ! -f "${PROD_ENV}" ]; then
    die ".env.production not found at ${PROD_ENV}. Create it from backend/.env.example on this server first. deploy.sh will NOT create it for you."
  fi
}

detect_server() {
  # Determine which server this machine is.
  case "${1:-}" in
    server1) echo "server1"; return 0;;
    server2) echo "server2"; return 0;;
  esac
  local hn hostip
  hn="$(hostname 2>/dev/null || echo unknown)"
  hostip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  case "${hn}" in
    *canary*) echo "server2";;
    *) echo "server1";;
  esac
}

git_sync() {
  log "Syncing git branch ${BRANCH}"
  git -C "${REPO_DIR}" fetch origin
  git -C "${REPO_DIR}" checkout "${BRANCH}"
  git -C "${REPO_DIR}" pull origin "${BRANCH}"
}

health_api() {
  local base="${1:-http://localhost:8000}"
  log "Waiting for API health at ${base}/health/ready"
  local i
  for i in $(seq 1 30); do
    if curl -fsS "${base}/health/ready" >/dev/null 2>&1; then
      log "API ready"
      return 0
    fi
    sleep 5
  done
  die "API did not become healthy at ${base}/health/ready"
}

health_celery() {
  log "Checking ${1:-http://localhost:8000}/health/celery"
  curl -fsS "${1:-http://localhost:8000}/health/celery" || warn "celery health check failed"
}

# ---------------------------------------------------------------------------
# Server 1: Postgres + Redis + API + frontends + interview-agent + migrations
# ---------------------------------------------------------------------------
deploy_server1() {
  require_root
  require_env
  git_sync

  log "Starting Postgres + Redis (base compose, existing volume untouched)"
  cd "${REPO_DIR}"
  $DOCKER_COMPOSE up -d

  log "Building/starting API, hr-app, candidate-app, interview-agent"
  VITE_API_URL="${API_PUBLIC_URL}" $DOCKER_COMPOSE -f docker-compose.app.yml --profile interviews up -d --build

  log "Running Alembic migrations (upgrade head)"
  $DOCKER_COMPOSE -f docker-compose.app.yml run --rm --entrypoint alembic api upgrade head

  health_api "http://localhost:8000"
  health_celery "http://localhost:8000"
  log "Server 1 deploy complete"
}

# ---------------------------------------------------------------------------
# Server 2: Celery beat + workers
# ---------------------------------------------------------------------------
deploy_server2() {
  require_root
  require_env
  git_sync

  log "Waiting for Server 1 API before starting workers"
  health_api "http://${SERVER1_IP}:8000"

  log "Building/starting Celery beat + resume/screening/interview workers"
  cd "${REPO_DIR}"
  $DOCKER_COMPOSE -f docker-compose.worker.yml --profile full up -d --build

  $DOCKER_COMPOSE -f docker-compose.worker.yml ps
  log "Server 2 deploy complete"
}

# ---------------------------------------------------------------------------
# logs / status
# ---------------------------------------------------------------------------
tail_logs() {
  require_env
  cd "${REPO_DIR}"
  case "$(detect_server "")" in
    server1)
      $DOCKER_COMPOSE -f docker-compose.app.yml logs -f --tail=100 api
      ;;
    server2)
      $DOCKER_COMPOSE -f docker-compose.worker.yml logs -f --tail=100 \
        celery-resume-1 celery-resume-2 celery-resume-3 \
        celery-screening celery-interviews-a celery-interviews-b
      ;;
  esac
}

show_status() {
  require_env
  cd "${REPO_DIR}"
  case "$(detect_server "")" in
    server1)
      $DOCKER_COMPOSE ps
      $DOCKER_COMPOSE -f docker-compose.app.yml ps
      health_api "http://localhost:8000"
      health_celery "http://localhost:8000"
      ;;
    server2)
      $DOCKER_COMPOSE -f docker-compose.worker.yml ps
      health_api "http://${SERVER1_IP}:8000"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
MODE="${1:-}"
case "${MODE}" in
  server1) deploy_server1 ;;
  server2) deploy_server2 ;;
  all)
    deploy_server1
    log "Deploying Server 2 via ssh ${SERVER2_SSH_USER}@${SERVER2_IP}"
    # shellcheck disable=SC2086
    ssh ${SERVER2_SSH_ARGS} "${SERVER2_SSH_USER}@${SERVER2_IP}" \
      "cd ${REPO_DIR} && git pull origin ${BRANCH} && bash deploy.sh server2"
    ;;
  logs) tail_logs ;;
  status) show_status ;;
  *)
    echo "Usage: bash $0 {server1|server2|all|logs|status}" >&2
    exit 1
    ;;
esac
