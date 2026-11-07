use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;

const PAIR_TTL: Duration = Duration::from_secs(120);
const DEVICE_SECONDS: u64 = 10 * 24 * 60 * 60;
const LEGACY_DEVICE_SECONDS: u64 = 30 * 24 * 60 * 60;
const MAX_DEVICES: usize = 16;

pub(crate) fn secret() -> Result<String, &'static str> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "random_unavailable")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}
fn valid_secret(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub expires_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct Device {
    info: DeviceInfo,
    digest: [u8; 32],
    #[serde(default)]
    last_used_at: u64,
}

pub(crate) struct Pairing {
    store: PathBuf,
    devices: Vec<Device>,
    offer: Option<([u8; 32], Instant)>,
    active: bool,
}

impl Pairing {
    pub(crate) fn open(store: PathBuf) -> Result<Self, &'static str> {
        let mut devices: Vec<Device> = match fs::metadata(&store) {
            Ok(metadata) if metadata.len() <= 32 * 1024 => {
                let bytes = fs::read(&store).map_err(|_| "device_store_unavailable")?;
                serde_json::from_slice(&bytes).map_err(|_| "device_store_invalid")?
            }
            Ok(_) => return Err("device_store_invalid"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(_) => return Err("device_store_unavailable"),
        };
        if devices.len() > MAX_DEVICES {
            return Err("device_store_invalid");
        }
        for device in &mut devices {
            if device.last_used_at == 0 {
                device.last_used_at = device.info.expires_at.saturating_sub(LEGACY_DEVICE_SECONDS);
                device.info.expires_at = device.last_used_at + DEVICE_SECONDS;
            }
        }
        Ok(Self {
            store,
            devices,
            offer: None,
            active: true,
        })
    }

    pub(crate) fn offer(&mut self) -> Result<String, &'static str> {
        let code = secret()?;
        self.offer = Some((digest(&code), Instant::now() + PAIR_TTL));
        Ok(code)
    }

    pub(crate) fn offer_active(&self) -> bool {
        self.offer
            .as_ref()
            .is_some_and(|(_, deadline)| *deadline > Instant::now())
    }

    pub(crate) fn redeem(&mut self, code: &str) -> Result<String, &'static str> {
        if !self.active || !valid_secret(code) {
            return Err("invalid_pairing");
        }
        let valid = self.offer.as_ref().is_some_and(|(expected, deadline)| {
            *deadline > Instant::now() && bool::from(expected.ct_eq(&digest(code)))
        });
        if !valid {
            return Err("invalid_pairing");
        }
        let now = unix_seconds();
        let mut devices: Vec<_> = self
            .devices
            .iter()
            .filter(|device| device.info.expires_at > now)
            .cloned()
            .collect();
        if devices.len() >= MAX_DEVICES {
            return Err("device_limit");
        }
        let id = secret()?;
        let token = secret()?;
        devices.push(Device {
            info: DeviceInfo {
                name: format!("Телефон · {}", &id[..4]),
                id,
                expires_at: now + DEVICE_SECONDS,
            },
            digest: digest(&token),
            last_used_at: now,
        });
        self.persist(devices)?;
        self.offer = None;
        Ok(token)
    }

    pub(crate) fn authorize(&self, token: &str) -> Option<&DeviceInfo> {
        if !self.active || !valid_secret(token) {
            return None;
        }
        let candidate = digest(token);
        self.devices
            .iter()
            .find(|device| {
                device.info.expires_at > unix_seconds()
                    && bool::from(device.digest.ct_eq(&candidate))
            })
            .map(|device| &device.info)
    }

    pub(crate) fn renew(&mut self, token: &str) -> Result<bool, &'static str> {
        let Some(authorized) = self.authorize(token) else {
            return Ok(false);
        };
        let now = unix_seconds();
        let mut devices = self.devices.clone();
        if let Some(device) = devices
            .iter_mut()
            .find(|device| device.info.id == authorized.id)
        {
            if now > device.last_used_at {
                device.last_used_at = now;
                device.info.expires_at = now + DEVICE_SECONDS;
                self.persist(devices)?;
            }
        }
        Ok(true)
    }

    pub(crate) fn devices(&self) -> Vec<DeviceInfo> {
        self.devices
            .iter()
            .filter(|device| device.info.expires_at > unix_seconds())
            .map(|device| device.info.clone())
            .collect()
    }

    pub(crate) fn revoke(&mut self, id: &str) -> Result<(), &'static str> {
        self.persist(
            self.devices
                .iter()
                .filter(|device| device.info.id != id)
                .cloned()
                .collect(),
        )
    }

    pub(crate) fn stop(&mut self) {
        self.active = false;
    }

    fn persist(&mut self, devices: Vec<Device>) -> Result<(), &'static str> {
        let temporary = self.store.with_extension(format!("{}.tmp", secret()?));
        let bytes = serde_json::to_vec(&devices).map_err(|_| "device_store_invalid")?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "device_store_unavailable")?;
        let result = std::io::Write::write_all(&mut file, &bytes).and_then(|_| file.sync_all());
        drop(file);
        if result
            .and_then(|_| fs::rename(&temporary, &self.store))
            .is_err()
        {
            let _ = fs::remove_file(&temporary);
            return Err("device_store_unavailable");
        }
        self.devices = devices;
        Ok(())
    }
}
