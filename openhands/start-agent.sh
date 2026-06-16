#!/usr/bin/env bash
# Start the NEXUS Agent engine (OpenHands) locally.
# Run this INSIDE a WSL terminal on Windows (Docker Desktop + WSL2 required).
#
#   bash openhands/start-agent.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker not found. Install Docker Desktop and enable WSL2 integration."
  echo "See openhands/README.md"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon not running. Start Docker Desktop, then retry."
  exit 1
fi

mkdir -p openhands/state

echo "==> Starting NEXUS Agent (this pulls images on first run; may take a few minutes)..."
docker compose -f openhands/docker-compose.yml up

# When it's up, open http://localhost:3030
