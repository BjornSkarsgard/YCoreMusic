#!/bin/sh
set -eu
mkdir -p .tools
openbox >.tools/openbox.log 2>&1 &
wm_pid=$!
pulse_pid=''
comp_pid=''
cleanup() {
  if [ -n "$comp_pid" ]; then kill "$comp_pid" 2>/dev/null || true; fi
  kill "$wm_pid" 2>/dev/null || true
  if [ -n "$pulse_pid" ]; then kill "$pulse_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
# A private null output makes real WebKit/GStreamer playback testable without
# sound hardware. Only the hosted runner's child processes use this socket.
if [ "${GITHUB_ACTIONS:-}" = true ] && [ "${YCORE_BASE_PLAYBACK_SMOKE:-}" = 1 ]; then
  pulse_dir=$(mktemp -d "$PWD/.tools/pulse.XXXXXX")
  pulseaudio -n --daemonize=no --use-pid-file=no --exit-idle-time=-1 \
    --log-target="file:$PWD/.tools/pulseaudio.log" \
    --load="module-null-sink sink_name=ycore_test_audio" \
    --load="module-native-protocol-unix socket=$pulse_dir/native auth-anonymous=1" &
  pulse_pid=$!
  export PULSE_SERVER="unix:$pulse_dir/native"
  for attempt in $(seq 1 50); do
    if pactl info >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  pactl info >/dev/null
fi
for attempt in $(seq 1 50); do
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
    break
  fi
  sleep 0.1
done
kill -0 "$wm_pid"
xprop -root _NET_SUPPORTING_WM_CHECK
if [ "${YCORE_LINUX_FEATURES_SMOKE:-}" = 1 ]; then
  test "${YCORE_PRIVATE_X11:-}" = 1
  xcompmgr -n >.tools/xcompmgr.log 2>&1 &
  comp_pid=$!
  sleep 1
  kill -0 "$comp_pid"
  cc scripts/linux-display-fixture.c -o .tools/linux-display-fixture -lX11 -lXrandr
  .tools/linux-display-fixture
fi
node scripts/native-smoke.mjs
