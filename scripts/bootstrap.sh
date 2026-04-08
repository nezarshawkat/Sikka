#!/usr/bin/env bash
set -euo pipefail

echo "Starting Sikka local stack..."
docker compose -f docker/docker-compose.yml up --build
