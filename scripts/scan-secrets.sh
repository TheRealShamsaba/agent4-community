#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node scripts/check-public-source.js
agent4_export=$(mktemp -d)
trap 'rm -rf "$agent4_export"' EXIT HUP INT TERM
git checkout-index --all --prefix="$agent4_export/"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git . --config .gitleaks.toml --redact --no-banner
  gitleaks dir "$agent4_export" --config .gitleaks.toml --redact --no-banner
elif command -v docker >/dev/null 2>&1; then
  agent4_scanner="ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
  docker run --rm -v "$(pwd -P):/repo:ro" -w /repo "$agent4_scanner" git . --config .gitleaks.toml --redact --no-banner
  docker run --rm -v "$agent4_export:/source:ro" -v "$(pwd -P)/.gitleaks.toml:/scan.toml:ro" "$agent4_scanner" dir /source --config /scan.toml --redact --no-banner
else
  echo "Install Gitleaks or start Docker to scan the public source." >&2; exit 1
fi
