Vendored from crates.io tauri-plugin-power-monitor 0.1.0 (MIT / Apache-2.0).

YCore Music patch: remove the nonexistent IOPSRelease declaration and release the IOPSCopyPowerSourcesInfo snapshot with CoreFoundation's create-rule RAII wrapper (CFRelease on drop). Both macOS architectures otherwise fail at the native link step. Original licenses are retained.

Upstream: https://github.com/marrionesa/tauri-plugin-power-monitor
Registry source: https://crates.io/crates/tauri-plugin-power-monitor/0.1.0
Remove this Cargo patch when an upstream release contains the correction.
