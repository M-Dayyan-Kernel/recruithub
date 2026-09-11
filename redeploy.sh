#!/bin/bash
set -e

echo "Starting Recruit Hub App Server (Server 1) deployment..."

REPO_DIR="/opt/ai-recruitment-poc"
DOMAIN="https://api.recruithub.webknot-dev.in"

echo "Pulling latest code (stich/talentos branch)..."
cd "$REPO_DIR"
git checkout stich/talentos
git pull origin stich/talentos

echo "Rebuilding app containers (API, HR app, Candidate app, interview-agent)..."
VITE_API_URL=$DOMAIN \
  docker compose -f docker-compose.app.yml --profile interviews build --no-cache api hr-app candidate-app interview-agent

echo "Recreating containers with new images..."
VITE_API_URL=$DOMAIN \
  docker compose -f docker-compose.app.yml --profile interviews up -d --force-recreate

echo "Running database migrations..."
docker compose -f docker-compose.app.yml run --rm --entrypoint alembic api upgrade head

echo "Checking container status..."
docker compose -f docker-compose.app.yml ps

echo "Verifying API health (postgres/redis via Server 3, secrets via OpenBao)..."
sleep 5

READY_JSON=$(curl -sf "$DOMAIN/health/ready") || { echo "FATAL: /health/ready request failed entirely (API unreachable)"; exit 1; }
echo "$READY_JSON"

echo "$READY_JSON" | grep -q '"postgres":"ok"' || { echo "FATAL: postgres check is not ok — aborting deploy"; exit 1; }
echo "$READY_JSON" | grep -q '"redis":"ok"' || { echo "FATAL: redis check is not ok — aborting deploy"; exit 1; }
echo "$READY_JSON" | grep -q '"secretsSource":"openbao"' || { echo "FATAL: secretsSource is not openbao — check OpenBao container health"; exit 1; }
echo " -> /health/ready fully OK (postgres, redis, openbao all confirmed)"

CELERY_JSON=$(curl -sf "$DOMAIN/health/celery") || { echo "FATAL: /health/celery request failed entirely"; exit 1; }
echo "$CELERY_JSON"

echo "$CELERY_JSON" | grep -q '"status":"ok"' || { echo "WARNING: celery status is not ok — workers may be down, continuing deploy but investigate immediately"; }
echo " -> /health/celery check complete"

echo "Reloading nginx (in case of config drift)..."
nginx -t && systemctl reload nginx

echo "Cleaning up unused Docker images and build cache..."
docker image prune -af
docker builder prune -f

echo "Recruit Hub App Server deployment complete!"
