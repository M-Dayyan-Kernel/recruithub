#!/usr/bin/env bash
# Start Celery beat (exactly one instance per environment).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${BACKEND_DIR}"

if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

LOG_LEVEL="${CELERY_LOG_LEVEL:-info}"
APP="app.core.celery_app.celery_app"

exec celery -A "${APP}" beat --loglevel="${LOG_LEVEL}"
