#!/usr/bin/env bash
set -euo pipefail

# Run from the Sikka project root after unzipping this fix pack.
if [ ! -f "package.json" ] || [ ! -d "artifacts/api-server" ]; then
  echo "ERROR: Run this from the Sikka project root (the folder that contains package.json and artifacts/api-server)." >&2
  exit 1
fi

if [ ! -f "artifacts/api-server/src/data/egyptTransitSeed.json" ]; then
  echo "ERROR: artifacts/api-server/src/data/egyptTransitSeed.json is missing." >&2
  exit 1
fi

if [ ! -f "artifacts/api-server/src/data/egyptTrainsSeed.json" ]; then
  echo "ERROR: artifacts/api-server/src/data/egyptTrainsSeed.json is missing." >&2
  exit 1
fi

mkdir -p artifacts/api-server/data
cp -f artifacts/api-server/src/data/*.json artifacts/api-server/data/

node --check artifacts/api-server/build.mjs

echo "Render deploy fix applied."
echo "The backend build now copies artifacts/api-server/src/data -> artifacts/api-server/data so the server will not crash with ENOENT for egyptTransitSeed.json."
echo "Use this Render build command: pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build"
echo "Use this Render start command: pnpm --filter @workspace/api-server run start"
echo "Note: if Neon says quota exceeded, that is a Neon account/project limit, not this code crash."
