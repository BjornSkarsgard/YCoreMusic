fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
        && std::env::var_os("CARGO_FEATURE_MACOS_NATIVE_PROBE").is_some()
    {
        let probe = "src/macos/native-probe.m";
        println!("cargo:rerun-if-changed={probe}");
        cc::Build::new()
            .file(probe)
            .flag("-fobjc-arc")
            .compile("ycore_macos_native_probe");
        for framework in [
            "AppKit",
            "AVFoundation",
            "CoreGraphics",
            "CoreMedia",
            "CoreVideo",
            "WebKit",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        let protocol = "src/linux/protocols/xdg-output.xml";
        println!("cargo:rerun-if-changed={protocol}");
        println!("cargo:rerun-if-changed=src/linux/wayland-outputs.c");
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        for (kind, file) in [
            ("client-header", "xdg-output-client.h"),
            ("private-code", "xdg-output-protocol.c"),
        ] {
            assert!(std::process::Command::new("wayland-scanner")
                .arg(kind)
                .arg(protocol)
                .arg(out.join(file))
                .status()
                .expect("wayland-scanner is required for Linux builds")
                .success());
        }
        let wayland = pkg_config::Config::new()
            .probe("wayland-client")
            .expect("Wayland client development headers required");
        let mut build = cc::Build::new();
        for path in wayland.include_paths {
            build.include(path);
        }
        build
            .include(&out)
            .file("src/linux/wayland-outputs.c")
            .file(out.join("xdg-output-protocol.c"))
            .warnings(true)
            .compile("ycore_wayland_outputs");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
        && std::env::var_os("CARGO_FEATURE_AUDIO_ANALYSIS").is_some()
    {
        println!("cargo:rerun-if-changed=src/linux/audio-capture.c");
        let pulse = pkg_config::Config::new()
            .probe("libpulse")
            .expect("libpulse development headers required");
        let mut capture = cc::Build::new();
        for path in pulse.include_paths {
            capture.include(path);
        }
        capture
            .file("src/linux/audio-capture.c")
            .warnings(true)
            .compile("ycore_pulse_capture");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
        && std::env::var_os("CARGO_FEATURE_LINUX_EMBED_REFERRER").is_some()
    {
        println!("cargo:rerun-if-changed=src/linux/media-compat.c");
        cc::Build::new()
            .file("src/linux/media-compat.c")
            .warnings(true)
            .compile("ycore_webkit_media_compat");
        println!("cargo:rustc-link-lib=dl");
        let source = "src/linux/embed-identity.c";
        println!("cargo:rerun-if-changed={source}");
        let package = pkg_config::Config::new()
            .cargo_metadata(false)
            .probe("webkit2gtk-web-extension-4.1")
            .expect("WebKitGTK extension development headers required");
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("libycore-embed-identity.so");
        let compiler = cc::Build::new().get_compiler();
        let mut command = compiler.to_command();
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").unwrap()).unwrap();
        let overlay = std::env::var("TAURI_CONFIG")
            .ok()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok());
        let identifier = overlay
            .as_ref()
            .and_then(|value| value["identifier"].as_str())
            .or_else(|| config["identifier"].as_str())
            .expect("Application identifier required");
        assert!(
            !identifier.is_empty()
                && identifier.len() <= 128
                && identifier
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-'),
            "Invalid embedded client identifier"
        );
        command.arg(format!("-DYCORE_APP_ID=\"{identifier}\""));
        command
            .args(["-shared", "-fPIC", "-O2", "-Wall", "-Wextra", source, "-o"])
            .arg(output);
        for path in package.include_paths {
            command.arg("-I").arg(path);
        }
        for path in package.link_paths {
            command.arg("-L").arg(path);
        }
        for library in package.libs {
            command.arg(format!("-l{library}"));
        }
        assert!(command
            .status()
            .expect("Cannot compile WebKit embed identity helper")
            .success());
    }
    tauri_build::build()
}
