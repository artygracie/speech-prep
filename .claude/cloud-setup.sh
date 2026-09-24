#!/bin/bash
#
# Artygroup: one setup script for every cloud environment.
#
# Paste this whole file into the environment's "Setup script" field. It works out
# what the repo needs rather than being told, so the same text serves every repo.
#
# Three constraints it is written around, from the cloud-environments docs:
#   1. Exit zero, or the session refuses to start. Nothing here is fatal.
#   2. Finish inside five minutes.
#   3. It runs as root, and NOT inside the clone, so it has to find the repo.

set -uo pipefail

echo "cwd at start: $PWD"

# --- find the clone -----------------------------------------------------------
REPO="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO" ]; then
  for base in /root /home /workspace /workspaces /repo /repos /src /app /mnt; do
    [ -d "$base" ] || continue
    found="$(find "$base" -maxdepth 4 -name .git -not -path '*/node_modules/*' -print -quit 2>/dev/null)"
    if [ -n "$found" ]; then REPO="$(dirname "$found")"; break; fi
  done
fi

if [ -z "$REPO" ] || [ ! -d "$REPO" ]; then
  echo "WARN: no clone found. Skipping install; the SessionStart hook will handle it."
  exit 0
fi
echo "repo: $REPO"

# --- find the app: the shallowest directory holding a lockfile ----------------
APP=""
for candidate in "$REPO" "$REPO/web" "$REPO/app" "$REPO/frontend" "$REPO/packages/web"; do
  for lock in package-lock.json pnpm-lock.yaml yarn.lock; do
    if [ -f "$candidate/$lock" ]; then APP="$candidate"; LOCK="$lock"; break 2; fi
  done
done

if [ -z "$APP" ]; then
  echo "No JavaScript lockfile in this repo: nothing to install."
  echo "setup finished"
  exit 0
fi
echo "app: $APP (lockfile: $LOCK)"
cd "$APP" || exit 0

# --- install, with the package manager the lockfile names --------------------
case "$LOCK" in
  pnpm-lock.yaml) ${DRY_RUN:+echo DRY-RUN} pnpm install --frozen-lockfile || echo "WARN: pnpm install failed" ;;
  yarn.lock)      ${DRY_RUN:+echo DRY-RUN} yarn install --frozen-lockfile || echo "WARN: yarn install failed" ;;
  *)              ${DRY_RUN:+echo DRY-RUN} npm ci --no-audit --fund=false   || echo "WARN: npm ci failed" ;;
esac

# --- generated code some repos need before they typecheck --------------------
if [ -f "$APP/prisma/schema.prisma" ] || [ -f "$REPO/prisma/schema.prisma" ]; then
  echo "prisma schema found: generating the client"
  ${DRY_RUN:+echo DRY-RUN} npx prisma generate || echo "WARN: prisma generate failed"
fi

# --- a browser, only where the tests actually use one ------------------------
if grep -qE '"(@playwright/test|playwright)"' "$APP/package.json" 2>/dev/null; then
  echo "playwright is a dependency: installing chromium"
  ${DRY_RUN:+echo DRY-RUN} npx playwright install --with-deps chromium \
    || ${DRY_RUN:+echo DRY-RUN} npx playwright install chromium \
    || echo "WARN: playwright install failed; the e2e step will say so"
fi

echo "setup finished in $APP"
exit 0
