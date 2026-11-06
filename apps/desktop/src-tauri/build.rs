fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
        && std::env::var_os("CARGO_FEATURE_LINUX_EMBED_REFERRER").is_some()
    {
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
