use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct Timer(Mutex<Clock>);
#[derive(Default)]
struct Clock {
    deadline: Option<i64>,
    revision: u64,
    expired: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    remaining_seconds: u64,
    active: bool,
    expired: bool,
    revision: u64,
}
impl Clock {
    fn status(&self, now: i64) -> Status {
        Status {
            remaining_seconds: self.deadline.map_or(0, |deadline| {
                ((deadline - now).max(0) as u64).div_ceil(1000)
            }),
            active: self.deadline.is_some(),
            expired: self.expired,
            revision: self.revision,
        }
    }
    fn expire(&mut self, now: i64) -> bool {
        if self.deadline.is_some_and(|deadline| now >= deadline) {
            self.deadline = None;
            self.expired = true;
            true
        } else {
            false
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Read,
    Start { seconds: u32 },
    Cancel,
}
#[tauri::command]
pub fn sleep_timer(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Timer>,
    request: Request,
) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted timer request".into());
    }
    let now = chrono::Utc::now().timestamp_millis();
    let mut timer = state.0.lock().map_err(|_| "Timer unavailable")?;
    match request {
        Request::Read => {}
        Request::Start { seconds } => {
            if !(1..=43200).contains(&seconds) {
                return Err("Timer duration must be 1 second to 12 hours".into());
            }
            timer.revision += 1;
            timer.expired = false;
            timer.deadline = Some(now + i64::from(seconds) * 1000);
        }
        Request::Cancel => {
            timer.revision += 1;
            timer.expired = false;
            timer.deadline = None;
        }
    }
    Ok(timer.status(now))
}
pub fn install(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if app.webview_windows().is_empty() {
            return;
        }
        let state = app.state::<Timer>();
        let result = state.0.lock().ok().and_then(|mut timer| {
            let now = chrono::Utc::now().timestamp_millis();
            timer.expire(now).then(|| timer.status(now))
        });
        if let Some(status) = result {
            let _ = app.emit_to("main", "sleep-timer-expired", status);
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deadline_is_one_shot_and_uses_elapsed_wall_time() {
        let mut clock = Clock {
            deadline: Some(60000),
            revision: 1,
            expired: false,
        };
        assert_eq!(clock.status(1).remaining_seconds, 60);
        assert!(!clock.expire(59999));
        assert!(clock.expire(60000));
        assert!(clock.status(70000).expired);
        assert!(!clock.expire(80000));
        clock.deadline = Some(120000);
        clock.expired = false;
        assert!(clock.expire(3600000));
    }
}
