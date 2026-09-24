#!/bin/bash
#
# Runs at the start of EVERY session, local and cloud, via .claude/settings.json.
# It must stay a no-op locally: the laptop manages its own dependencies.
#
# In cloud it is the safety net. The setup script primes a cached snapshot, but
# the cache can be stale, the branch can change the lockfile, and a setup script
# that could not find the clone skips its install entirely. This catches all three.
#
# CLAUDE_PROJECT_DIR is the documented repo root and is set for hooks, unlike $0,
# which is only the script's own path when the script is run as a file.
#
# The stamp is what keeps this quiet: node_modules' mtime moves on every install
# and every stray write, so comparing the lockfile against the directory would
# reinstall on a healthy tree. Compare against the moment of the last install.

set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

REPO="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

APP=""
for candidate in "$REPO" "$REPO/web" "$REPO/app" "$REPO/frontend" "$REPO/packages/web"; do
  for lock in package-lock.json pnpm-lock.yaml yarn.lock; do
    if [ -f "$candidate/$lock" ]; then APP="$candidate"; LOCK="$lock"; break 2; fi
  done
done
[ -n "$APP" ] || exit 0

cd "$APP" || exit 0
STAMP=node_modules/.cloud-install-stamp

if [ ! -d node_modules ]; then
  echo "cloud session: dependencies missing in $APP, installing"
elif [ ! -f "$STAMP" ]; then
  echo "cloud session: no install stamp, installing once to create it"
elif [ "$LOCK" -nt "$STAMP" ]; then
  echo "cloud session: $LOCK changed since the last install, reinstalling"
else
  exit 0
fi

case "$LOCK" in
  pnpm-lock.yaml) pnpm install --frozen-lockfile || echo "WARN: pnpm install failed" ;;
  yarn.lock)      yarn install --frozen-lockfile || echo "WARN: yarn install failed" ;;
  *)              npm ci --no-audit --fund=false  || echo "WARN: npm ci failed" ;;
esac

[ -f prisma/schema.prisma ] && { npx prisma generate || echo "WARN: prisma generate failed"; }

mkdir -p "$(dirname "$STAMP")" && touch "$STAMP"
exit 0
