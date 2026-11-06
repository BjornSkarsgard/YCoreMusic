#!/bin/sh
set -eu
# The hosted Azure mirror stalled this project's CI at tens of KB/s. Change only
# the ephemeral Actions runner, retaining Ubuntu's signed repositories and TLS.
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  for source in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
    if [ -f "$source" ]; then
      sudo sed -i 's|https\?://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' "$source"
    fi
  done
fi
case "${1:-build}" in
  build) extra='' ;;
  native) extra='webkit2gtk-driver xvfb xauth openbox dbus-x11 fonts-dejavu x11-utils' ;;
  package) extra='libfuse2' ;;
  *) echo 'Expected build, native or package' >&2; exit 2 ;;
esac
apt_get() {
  sudo env DEBIAN_FRONTEND=noninteractive apt-get \
    -o Acquire::Retries=2 -o Acquire::http::Timeout=20 \
    -o Acquire::https::Timeout=20 -o Acquire::ForceIPv4=true \
    -o DPkg::Lock::Timeout=60 -o Dpkg::Options::=--force-confold "$@"
}
apt_get update
# Word splitting is intentional: extra contains only the fixed package lists above.
apt_get install -y --no-install-recommends libwebkit2gtk-4.1-dev build-essential \
  libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev libdbus-1-dev $extra
