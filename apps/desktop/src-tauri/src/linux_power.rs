//! Session-scoped idle inhibition. Never changes power settings or blocks a
//! user's explicit suspend/shutdown. D-Bus also releases the lease on crash.
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, OnceLock,
    },
    time::Duration,
};

const SERVICE: &str = "org.freedesktop.ScreenSaver";
const PATH: &str = "/org/freedesktop/ScreenSaver";

struct Control {
    desired: Arc<AtomicBool>,
    wake: mpsc::SyncSender<()>,
}
static CONTROL: OnceLock<Control> = OnceLock::new();

struct Lease {
    connection: zbus::blocking::Connection,
    inhibition: Inhibition,
}
enum Inhibition {
    ScreenSaver(u32),
    Portal(zbus::zvariant::OwnedObjectPath),
}
impl Lease {
    fn acquire() -> Result<Self, zbus::Error> {
        let connection = zbus::blocking::connection::Builder::session()?
            .method_timeout(Duration::from_secs(2))
            .build()?;
        Self::acquire_on(connection)
    }
    fn acquire_on(connection: zbus::blocking::Connection) -> Result<Self, zbus::Error> {
        let reply = connection.call_method(
            Some(SERVICE),
            PATH,
            Some(SERVICE),
            "Inhibit",
            &("YCore Music", "Music video playback"),
        );
        if let Ok(reply) = reply {
            let cookie = reply.body().deserialize()?;
            return Ok(Self {
                connection,
                inhibition: Inhibition::ScreenSaver(cookie),
            });
        }
        // GNOME and other compositors expose the desktop portal instead of
        // org.freedesktop.ScreenSaver. Idle-only (8) never blocks explicit sleep.
        let options = std::collections::HashMap::from([(
            "reason",
            zbus::zvariant::Value::from("Music video playback"),
        )]);
        let reply = connection.call_method(
            Some("org.freedesktop.portal.Desktop"),
            "/org/freedesktop/portal/desktop",
            Some("org.freedesktop.portal.Inhibit"),
            "Inhibit",
            &("", 8u32, options),
        )?;
        let handle = reply.body().deserialize()?;
        Ok(Self {
            connection,
            inhibition: Inhibition::Portal(handle),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        process::{Child, Command, Stdio},
        sync::atomic::AtomicU32,
    };
    struct Daemon(Child);
    impl Drop for Daemon {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    struct ScreenSaver(Arc<AtomicU32>, Arc<AtomicU32>);
    #[zbus::interface(name = "org.freedesktop.ScreenSaver")]
    impl ScreenSaver {
        fn inhibit(&self, application: &str, reason: &str) -> u32 {
            assert_eq!(application, "YCore Music");
            assert!(!reason.is_empty());
            self.0.fetch_add(1, Ordering::SeqCst);
            42
        }
        fn un_inhibit(&self, cookie: u32) {
            assert_eq!(cookie, 42);
            self.1.fetch_add(1, Ordering::SeqCst);
        }
    }
    struct Portal(Arc<AtomicU32>);
    #[zbus::interface(name = "org.freedesktop.portal.Inhibit")]
    impl Portal {
        fn inhibit(
            &self,
            window: &str,
            flags: u32,
            options: std::collections::HashMap<String, zbus::zvariant::OwnedValue>,
        ) -> zbus::zvariant::OwnedObjectPath {
            assert!(window.is_empty());
            assert_eq!(flags, 8);
            assert!(options.contains_key("reason"));
            self.0.fetch_add(1, Ordering::SeqCst);
            zbus::zvariant::OwnedObjectPath::try_from(
                "/org/freedesktop/portal/desktop/request/ycore_test",
            )
            .unwrap()
        }
    }
    struct PortalRequest(Arc<AtomicU32>);
    #[zbus::interface(name = "org.freedesktop.portal.Request")]
    impl PortalRequest {
        fn close(&self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    #[ignore = "Starts its own private dbus-daemon; never contacts the desktop session"]
    fn portal_fallback_inhibits_only_idle_and_closes_request() {
        let child = Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--print-address=1"])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut daemon = Daemon(child);
        let mut address = String::new();
        BufReader::new(daemon.0.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        let acquired = Arc::new(AtomicU32::new(0));
        let released = Arc::new(AtomicU32::new(0));
        let _server = zbus::blocking::connection::Builder::address(address.trim())
            .unwrap()
            .name("org.freedesktop.portal.Desktop")
            .unwrap()
            .serve_at("/org/freedesktop/portal/desktop", Portal(acquired.clone()))
            .unwrap()
            .serve_at(
                "/org/freedesktop/portal/desktop/request/ycore_test",
                PortalRequest(released.clone()),
            )
            .unwrap()
            .build()
            .unwrap();
        let client = zbus::blocking::connection::Builder::address(address.trim())
            .unwrap()
            .method_timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let lease = Lease::acquire_on(client).unwrap();
        assert_eq!(acquired.load(Ordering::SeqCst), 1);
        assert_eq!(released.load(Ordering::SeqCst), 0);
        drop(lease);
        assert_eq!(released.load(Ordering::SeqCst), 1);
    }
    #[test]
    #[ignore = "Starts its own private dbus-daemon; never contacts the desktop session"]
    fn real_dbus_lease_is_released_on_drop() {
        let child = Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--print-address=1"])
            .stdout(Stdio::piped())
            .spawn()
            .expect("dbus-daemon required");
        let mut daemon = Daemon(child);
        let mut address = String::new();
        BufReader::new(daemon.0.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        let acquired = Arc::new(AtomicU32::new(0));
        let released = Arc::new(AtomicU32::new(0));
        let _server = zbus::blocking::connection::Builder::address(address.trim())
            .unwrap()
            .name(SERVICE)
            .unwrap()
            .serve_at(PATH, ScreenSaver(acquired.clone(), released.clone()))
            .unwrap()
            .build()
            .unwrap();
        let client = zbus::blocking::connection::Builder::address(address.trim())
            .unwrap()
            .method_timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let lease = Lease::acquire_on(client).unwrap();
        assert_eq!(acquired.load(Ordering::SeqCst), 1);
        assert_eq!(released.load(Ordering::SeqCst), 0);
        drop(lease);
        assert_eq!(released.load(Ordering::SeqCst), 1);
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        match &self.inhibition {
            Inhibition::ScreenSaver(cookie) => {
                let _ = self.connection.call_method(
                    Some(SERVICE),
                    PATH,
                    Some(SERVICE),
                    "UnInhibit",
                    &(cookie,),
                );
            }
            Inhibition::Portal(path) => {
                let _ = self.connection.call_method(
                    Some("org.freedesktop.portal.Desktop"),
                    path.as_str(),
                    Some("org.freedesktop.portal.Request"),
                    "Close",
                    &(),
                );
            }
        }
    }
}

pub fn request(playing: bool) {
    if !playing && CONTROL.get().is_none() {
        return;
    }
    let control = CONTROL.get_or_init(|| {
        let desired = Arc::new(AtomicBool::new(false));
        let worker_desired = desired.clone();
        let (wake, receiver) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut lease = None;
            loop {
                match receiver.recv_timeout(Duration::from_secs(2)) {
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    _ => while receiver.try_recv().is_ok() {},
                }
                if worker_desired.load(Ordering::Acquire) {
                    if lease
                        .as_ref()
                        .is_some_and(|lease: &Lease| lease.connection.is_closed())
                    {
                        lease = None;
                    }
                    if lease.is_none() {
                        lease = Lease::acquire().ok();
                    }
                    // A Pause may arrive while D-Bus is answering Inhibit.
                    if !worker_desired.load(Ordering::Acquire) {
                        lease = None;
                    }
                } else {
                    lease = None;
                }
            }
        });
        Control { desired, wake }
    });
    control.desired.store(playing, Ordering::Release);
    let _ = control.wake.try_send(());
}
