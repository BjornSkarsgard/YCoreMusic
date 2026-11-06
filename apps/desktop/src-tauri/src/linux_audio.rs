//! PulseAudio/PipeWire-Pulse capture of exactly one stream owned by our process
//! tree. No system mix, microphone, endpoint changes or retained audio files.
use crate::audio_spectrum::{Spectrum, BANDS};
use std::{
    ffi::{c_int, c_void},
    panic::{catch_unwind, AssertUnwindSafe},
    time::{Duration, Instant},
};

unsafe extern "C" {
    fn ycore_pulse_stream(
        stop: unsafe extern "C" fn(*mut c_void) -> c_int,
        owned: unsafe extern "C" fn(u32, *mut c_void) -> c_int,
        pcm: unsafe extern "C" fn(*const f32, usize, *mut c_void),
        data: *mut c_void,
    ) -> c_int;
}
struct Callbacks<'a> {
    stop: &'a dyn Fn() -> bool,
    publish: &'a mut dyn FnMut([f32; BANDS]),
    spectrum: Spectrum,
    last: Instant,
    failed: bool,
}
fn parent(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.get(stat.rfind(')')? + 1..)?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}
fn owned_by(mut pid: u32, root: u32) -> bool {
    for _ in 0..128 {
        if pid == root {
            return true;
        }
        let Some(next) = parent(pid) else {
            return false;
        };
        if next == 0 || next == pid {
            return false;
        }
        pid = next;
    }
    false
}
unsafe extern "C" fn owned(pid: u32, _: *mut c_void) -> c_int {
    owned_by(pid, std::process::id()).into()
}
unsafe extern "C" fn stop(data: *mut c_void) -> c_int {
    let callbacks = unsafe { &mut *data.cast::<Callbacks<'_>>() };
    if callbacks.failed {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| (callbacks.stop)())) {
        Ok(value) => value.into(),
        Err(_) => {
            callbacks.failed = true;
            1
        }
    }
}
unsafe extern "C" fn pcm(samples: *const f32, count: usize, data: *mut c_void) {
    let callbacks = unsafe { &mut *data.cast::<Callbacks<'_>>() };
    if callbacks.failed {
        return;
    }
    if samples.is_null() || count > 1_048_576 || !count.is_multiple_of(2) {
        callbacks.failed = true;
        return;
    }
    let samples = unsafe { std::slice::from_raw_parts(samples, count) };
    if catch_unwind(AssertUnwindSafe(|| {
        callbacks.spectrum.push_stereo(samples);
        if callbacks.last.elapsed() >= Duration::from_millis(16) {
            (callbacks.publish)(callbacks.spectrum.bands());
            callbacks.last = Instant::now();
        }
    }))
    .is_err()
    {
        callbacks.failed = true;
    }
}
pub fn stream(
    _app: &tauri::AppHandle,
    should_stop: impl Fn() -> bool,
    mut publish: impl FnMut([f32; BANDS]),
) -> Result<(), String> {
    let mut callbacks = Callbacks {
        stop: &should_stop,
        publish: &mut publish,
        spectrum: Spectrum::new(48000),
        last: Instant::now(),
        failed: false,
    };
    let code = unsafe {
        ycore_pulse_stream(
            stop,
            owned,
            pcm,
            (&mut callbacks as *mut Callbacks<'_>).cast(),
        )
    };
    if callbacks.failed {
        return Err("Audio analysis callback failed".into());
    }
    match code {
        0 => Ok(()),
        1 => Err("PulseAudio-compatible server is unavailable".into()),
        2 => Err("Waiting for one audio stream owned by YCore Music".into()),
        _ => Err("Own audio stream capture is temporarily unavailable".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn process_scope_rejects_ancestors_and_unrelated_processes() {
        let root = std::process::id();
        assert!(owned_by(root, root));
        assert!(!owned_by(u32::MAX, root));
        if let Some(parent) = parent(root) {
            assert!(!owned_by(parent, root));
        }
        let mut child = std::process::Command::new("sleep")
            .arg("1")
            .spawn()
            .unwrap();
        assert!(owned_by(child.id(), root));
        let _ = child.kill();
        let _ = child.wait();
    }
}
