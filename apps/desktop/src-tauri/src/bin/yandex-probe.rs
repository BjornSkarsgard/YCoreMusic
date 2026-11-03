#[path = "../credentials.rs"]
#[allow(dead_code)]
mod credentials;
#[path = "../yandex.rs"]
#[allow(dead_code)]
mod yandex;
use reqwest::{blocking::Client, redirect::Policy};
use std::{
    io::{self, IsTerminal, Write},
    time::Duration,
};
use yandex::*;
use zeroize::Zeroizing;
fn run() -> Result<(), &'static str> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    if arguments == ["--forget-token"] {
        credentials::forget()?;
        println!("Saved token removed");
        return Ok(());
    }
    let legacy = arguments.iter().any(|arg| arg == "--legacy");
    let save = arguments.iter().any(|arg| arg == "--save-token");
    if arguments
        .iter()
        .any(|arg| arg != "--legacy" && arg != "--save-token")
    {
        return Err(
            "Allowed: --legacy, --save-token or --forget-token; never pass token as argument",
        );
    }
    if !io::stdin().is_terminal() {
        return Err("Interactive terminal required; do not pipe tokens");
    }
    println!("Encore S1: creates a recommendation session unless --legacy. No playback/feedback. Token stored only with --save-token.");
    print!("Yandex OAuth token (hidden; enter locally, never in chat): ");
    io::stdout().flush().map_err(|_| "Terminal error")?;
    let token = Zeroizing::new(rpassword::read_password().map_err(|_| "Cannot read hidden input")?);
    let auth = authorization(&token)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize HTTPS client")?;
    let status = request(&client, "account/status", &auth, None)?;
    if status.pointer("/result/account/uid").is_none() {
        return Err("Account not confirmed by API");
    }
    println!("Account request: PASS (identity withheld)");
    if save {
        credentials::save(&token)?;
        println!("Token saved in OS credential store (not a file)");
    }
    if legacy {
        let batch = request(
            &client,
            "rotor/station/user:onyourwave/tracks?settings2=True",
            &auth,
            None,
        )?;
        let ids = ordered_ids(&batch)?;
        print_batch(1, &ids, 0);
        println!("S1: PARTIAL (legacy only)");
    } else {
        session_probe(&client, &auth)?;
    }

    Ok(())
}
fn main() {
    if let Err(message) = run() {
        eprintln!("Probe failed: {message}");
        std::process::exit(1);
    }
}
