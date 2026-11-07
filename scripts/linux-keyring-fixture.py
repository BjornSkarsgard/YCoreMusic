"""Test a real Secret Service on a private D-Bus and throwaway encrypted vault.

Run via dbus-run-session with YCORE_PRIVATE_DBUS=1. The remaining arguments are
an isolated test command. No user vault or OAuth token is read or modified.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

if os.environ.get("YCORE_PRIVATE_DBUS") != "1" or len(sys.argv) < 2:
    raise SystemExit("Requires private dbus-run-session and a test command")
with tempfile.TemporaryDirectory(prefix="ycore-secret-service-") as directory:
    root = Path(directory)
    for name in ("config", "data", "runtime", "control"):
        (root / name).mkdir(mode=0o700)
    environment = {
        **os.environ,
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_RUNTIME_DIR": str(root / "runtime"),
    }
    daemon = subprocess.Popen(
        ["gnome-keyring-daemon", "--foreground", "--components=secrets",
         "--unlock", "--control-directory=" + str(root / "control")],
        env=environment, stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        # A random disposable vault password stays in this pipe and memory.
        daemon.stdin.write(os.urandom(32).hex().encode() + b"\n")
        daemon.stdin.close()
        for _ in range(100):
            owned = subprocess.check_output(
                ["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus",
                 "--object-path", "/org/freedesktop/DBus", "--method",
                 "org.freedesktop.DBus.NameHasOwner", "org.freedesktop.secrets"],
                env=environment, timeout=3, text=True,
            )
            if "true" in owned:
                break
            if daemon.poll() is not None:
                raise RuntimeError("Private Secret Service exited")
            time.sleep(0.05)
        else:
            raise RuntimeError("Private Secret Service did not start")
        subprocess.run(sys.argv[1:], env=environment, check=True, timeout=60)
        print("Real Linux Secret Service: synthetic entry read/write/delete in disposable encrypted vault PASS")
    finally:
        daemon.terminate()
        try:
            daemon.wait(timeout=3)
        except subprocess.TimeoutExpired:
            daemon.kill()
            daemon.wait()
