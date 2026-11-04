use zeroize::Zeroizing;
fn entry() -> Result<keyring::Entry, &'static str> {
    keyring::Entry::new("io.encore.desktop", "yandex-oauth")
        .map_err(|_| "Credential store unavailable")
}
pub fn load() -> Result<Zeroizing<String>, &'static str> {
    entry()?
        .get_password()
        .map(Zeroizing::new)
        .map_err(|error| match error {
            keyring::Error::NoEntry => "No saved token. Connect Yandex Music in Settings.",
            _ => "Credential store locked or unavailable",
        })
}
pub fn save(token: &str) -> Result<(), &'static str> {
    entry()?
        .set_password(token)
        .map_err(|_| "Cannot save token in OS credential store")
}
pub fn forget() -> Result<(), &'static str> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Cannot delete saved token"),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "Explicit OS credential store check; writes and removes a synthetic entry"]
    fn os_store_roundtrip() {
        let name = format!(
            "fixture-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let entry = keyring::Entry::new("io.encore.test", &name).unwrap();
        entry.set_password("synthetic-test-value").unwrap();
        let result = entry.get_password();
        let deleted = entry.delete_credential();
        assert_eq!(result.unwrap(), "synthetic-test-value");
        deleted.unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
