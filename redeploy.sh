#!/bin/bash
set -e

echo "Starting Recruit Hub Client App Server (Server 3) deployment..."

REPO_DIR="/opt/ai-recruitment-poc"
DOMAIN="https://dev-api.recruithub.webknot-dev.in"

echo "Pulling latest code (dev branch)..."
cd "$REPO_DIR"
git checkout dev
git pull origin dev

echo "Ensuring Postgres + Redis are up..."
docker compose -f docker-compose.yml up -d

echo "Rebuilding app containers (API, HR app, Candidate app, interview-agent)..."
VITE_API_URL=$DOMAIN \
  docker compose -f docker-compose.app.yml --profile interviews build --no-cache api hr-app candidate-app interview-agent

echo "Recreating containers with new images..."
VITE_API_URL=$DOMAIN \
  docker compose -f docker-compose.app.yml --profile interviews up -d --force-recreate

echo "Running database migrations..."
docker compose -f docker-compose.app.yml run --rm --entrypoint alembic api upgrade head

echo "Checking container status..."
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.app.yml ps

echo "Verifying API health..."
sleep 5
curl -sf "$DOMAIN/health/ready" && echo " -> API health OK" || echo " -> API health FAILED"
curl -sf "$DOMAIN/health/celery" && echo " -> Celery health OK" || echo " -> Celery health FAILED"

echo "Reloading nginx (in case of config drift)..."
nginx -t && systemctl reload nginx

echo "Cleaning up unused Docker images and build cache..."
docker image prune -af
docker builder prune -f

echo "Recruit Hub Client App Server deployment complete!"
