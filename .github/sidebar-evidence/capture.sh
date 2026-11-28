#!/bin/bash
# Seed two Workspaces, hold one Session running against a local mock endpoint, then capture the packaged app's sidebar (Issue 64).
set +e -x
label=$1; out=$2; scripts=$3
mkdir -p "$out"
find apps/desktop/.desktop-build -maxdepth 8 -name 'Nexus Superharness.app' -print > "$out/found.txt" 2>/dev/null
app=$(head -1 "$out/found.txt")
[ -n "$app" ] || { echo "no packaged app" > "$out/error.txt"; exit 0; }
proc='Nexus Superharness'

mkdir -p "$HOME/.dsh/sessions" "$HOME/Projects/web-console" "$HOME/Projects/billing-service"
cp "$scripts/seed.ts" apps/web/tests/zz-evidence-seed.ts
pnpm exec tsx apps/web/tests/zz-evidence-seed.ts "$HOME/.dsh/sessions" snapshots/web/seeded-history/session.v3.jsonl \
  "$HOME/Projects/billing-service::Add invoice export endpoint" \
  "$HOME/Projects/web-console::Review dashboard layout" \
  "$HOME/Projects/billing-service::Upgrade payment SDK" \
  "$HOME/Projects/web-console::Fix login redirect" > "$out/seed.log" 2>&1

node "$scripts/mock-messages.mjs" 18080 "$out/mock.log" &
printf 'DEEPSEEK_API_KEY=sk-evidence-placeholder\nDEEPSEEK_BASE_URL=http://127.0.0.1:18080\n' > "$HOME/.dsh/.env"

DEEPSEEK_API_KEY=sk-evidence-placeholder DEEPSEEK_BASE_URL=http://127.0.0.1:18080 \
  "$app/Contents/MacOS/$proc" --remote-debugging-port=9222 > "$out/app.log" 2>&1 &
sleep 20
node "$scripts/drive.mjs" "$label" "$out" > "$out/capture.log" 2>&1
screencapture -x "$out/screen-final.png"
pkill -f "$proc"
exit 0
