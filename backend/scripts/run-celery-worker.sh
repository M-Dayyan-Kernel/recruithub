#!/usr/bin/env bash
# Start a Celery worker for one queue (or all queues for local dev).
# Usage:
#   ./scripts/run-celery-worker.sh resume
#   ./scripts/run-celery-worker.sh all
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${BACKEND_DIR}"

if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

QUEUE="${1:-all}"
LOG_LEVEL="${CELERY_LOG_LEVEL:-info}"
APP="app.core.celery_app.celery_app"

resolve_concurrency() {
  local queue_name="$1"
  python - <<PY
from app.core.config_loader import config
print(config.celery_queue_concurrency("${queue_name}"))
PY
}

if [[ "${QUEUE}" == "all" ]]; then
  QUEUES="resume,shortlist,screening,interviews"
  CONCURRENCY="${CELERY_ALL_QUEUES_CONCURRENCY:-4}"
else
  case "${QUEUE}" in
    resume|shortlist|screening|interviews) ;;
    *)
      echo "Unknown queue '${QUEUE}'. Use: resume, shortlist, screening, interviews, or all." >&2
      exit 1
      ;;
  esac
  QUEUES="${QUEUE}"
  CONCURRENCY="$(resolve_concurrency "${QUEUE}")"
fi

exec celery -A "${APP}" worker \
  --loglevel="${LOG_LEVEL}" \
  --queues="${QUEUES}" \
  --concurrency="${CONCURRENCY}"
