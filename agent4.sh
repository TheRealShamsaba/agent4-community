#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Install Docker with Compose v2, then run ./agent4.sh again." >&2; exit 1
fi
if ! docker info >/dev/null 2>&1; then echo "Start Docker, then run ./agent4.sh again." >&2; exit 1; fi
case "${1:-start}" in
  start|setup)
    umask 077
    if [ ! -f .env ]; then cp .env.example .env; fi
    chmod 600 .env
    mkdir -p .secrets; chmod 700 .secrets
    if [ ! -f .secrets/setup-token ]; then : > .secrets/setup-token; fi
    if [ ! -s .secrets/setup-token ]; then
      if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32 > .secrets/setup-token
      else docker run --rm node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" > .secrets/setup-token; fi
    fi
    # Compose bind-mounts only this file into the unprivileged container. The
    # containing host directory is 0700, so other host users cannot reach it.
    chmod 644 .secrets/setup-token
    docker compose up --build --wait --wait-timeout 180
    agent4_url=$(awk -F= '$1 == "AGENT4_PUBLIC_URL" {print substr($0,index($0,"=")+1); exit}' .env)
    agent4_url=${agent4_url:-http://localhost:8782}
    agent4_token=$(cat .secrets/setup-token)
    echo ""
    echo "Agent4 is ready. Keep this first-use setup link private:"
    echo "${agent4_url%/}/#setup=$agent4_token"
    echo "Choose your owner account in the browser. Existing owners can sign in at ${agent4_url%/}/"
    ;;
  stop) docker compose stop ;;
  logs) docker compose logs --tail=100 -f agent4 ;;
  backup)
    echo "Pausing Agent4 briefly for a consistent database and file backup."
    docker compose stop agent4
    trap 'docker compose up -d agent4 >/dev/null' EXIT HUP INT TERM
    docker compose run --rm --no-deps agent4 node scripts/backup.js
    docker compose up -d --wait agent4
    trap - EXIT HUP INT TERM
    ;;
  reset-password) docker compose exec agent4 node scripts/reset-password.js ;;
  *) echo "Usage: ./agent4.sh [start|stop|logs|backup|reset-password]" >&2; exit 1 ;;
esac
