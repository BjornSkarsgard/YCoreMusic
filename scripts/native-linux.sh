#!/bin/sh
set -eu
mkdir -p .tools
openbox >.tools/openbox.log 2>&1 &
wm_pid=$!
trap 'kill "$wm_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 50); do
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
    break
  fi
  sleep 0.1
done
kill -0 "$wm_pid"
xprop -root _NET_SUPPORTING_WM_CHECK
node scripts/native-smoke.mjs
