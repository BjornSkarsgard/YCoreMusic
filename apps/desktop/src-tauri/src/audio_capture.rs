//! Process loopback of the dedicated player-host only; no system mix or microphone.

use std::{
    mem::ManuallyDrop,
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
use windows::{
    core::{implement, Interface, Ref, HRESULT},
    Win32::{
        Foundation::{CloseHandle, E_FAIL, E_POINTER, HANDLE},
        Media::Audio::*,
        System::{
            Com::{
                CoInitializeEx, CoUninitialize, StructuredStorage::PROPVARIANT, BLOB,
                COINIT_MULTITHREADED,
            },
            Threading::{CreateEventW, WaitForSingleObject},
            Variant::VT_BLOB,
        },
    },
};

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Completion {
    sender: Mutex<Option<mpsc::Sender<Result<usize, HRESULT>>>>,
    // The activation blob must outlive asynchronous activation, including a
    // caller timeout. COM retains this completion handler until completion.
    _parameters: Box<AUDIOCLIENT_ACTIVATION_PARAMS>,
}
impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(
        &self,
        operation: Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let result = (|| -> windows::core::Result<IAudioClient> {
            let operation = operation.ok()?;
            let mut result = HRESULT(0);
            let mut interface = None;
            unsafe {
                operation.GetActivateResult(&mut result, &mut interface)?;
            }
            result.ok()?;
            interface
                .ok_or_else(|| windows::core::Error::from(E_POINTER))?
                .cast()
        })()
        .map(|client| client.into_raw() as usize)
        .map_err(|error| error.code());
        if let Some(sender) = self.sender.lock().ok().and_then(|mut sender| sender.take()) {
            if let Err(mpsc::SendError(Ok(pointer))) = sender.send(result) {
                unsafe {
                    drop(IAudioClient::from_raw(pointer as *mut _));
                }
            }
        } else if let Ok(pointer) = result {
            unsafe {
                drop(IAudioClient::from_raw(pointer as *mut _));
            }
        }
        Ok(())
    }
}
struct Com;
impl Drop for Com {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
struct Event(HANDLE);
impl Drop for Event {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
struct Running<'a>(&'a IAudioClient);
impl Drop for Running<'_> {
    fn drop(&mut self) {
        unsafe {
            let _ = self.0.Stop();
        }
    }
}
struct Summary {
    frames: u64,
    packets: u64,
    samples: u64,
    squares: f64,
    peak: f64,
    bands: [f32; crate::audio_spectrum::BANDS],
}
#[cfg(all(debug_assertions, feature = "audio-probe"))]
pub(crate) struct Muted {
    volume: windows::core::AgileReference<ISimpleAudioVolume>,
    previous: bool,
}
fn source_process(app: &tauri::AppHandle) -> windows::core::Result<u32> {
    let source = app
        .get_webview_window(crate::player_host::LABEL)
        .ok_or_else(|| windows::core::Error::from(E_FAIL))?;
    let (sender, receiver) = mpsc::channel();
    source
        .with_webview(move |webview| {
            let result = unsafe {
                webview.controller().CoreWebView2().and_then(|view| {
                    let mut process = 0;
                    view.BrowserProcessId(&mut process)?;
                    Ok(process)
                })
            }
            .map_err(|error| error.code().0);
            let _ = sender.send(result);
        })
        .map_err(|_| windows::core::Error::from(E_FAIL))?;
    let result = receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| windows::core::Error::from(E_FAIL))?
        .map_err(|code| windows::core::Error::from(HRESULT(code)))?;
    if result == 0 {
        return Err(E_FAIL.into());
    }
    Ok(result)
}
#[cfg(all(debug_assertions, feature = "audio-probe"))]
fn own_processes(root: u32) -> windows::core::Result<std::collections::HashSet<u32>> {
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    let snapshot = Event(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }?);
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut parents = Vec::new();
    if unsafe { Process32FirstW(snapshot.0, &mut entry) }.is_ok() {
        loop {
            parents.push((entry.th32ParentProcessID, entry.th32ProcessID));
            if unsafe { Process32NextW(snapshot.0, &mut entry) }.is_err() {
                break;
            }
        }
    }
    let mut owned = std::collections::HashSet::from([root]);
    loop {
        let count = owned.len();
        for (parent, child) in &parents {
            if owned.contains(parent) {
                owned.insert(*child);
            }
        }
        if count == owned.len() {
            break;
        }
    }
    Ok(owned)
}
#[cfg(all(debug_assertions, feature = "audio-probe"))]
pub(crate) fn mute_owned(app: &tauri::AppHandle, muted: bool) -> windows::core::Result<usize> {
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    }
    let _com = Com;
    let state = app.state::<crate::audio_probe::AudioProbeState>();
    let mut saved = state
        .muted
        .lock()
        .map_err(|_| windows::core::Error::from(E_FAIL))?;
    if !muted {
        let mut failed = false;
        let mut count = 0;
        saved.retain(|entry| {
            match entry
                .volume
                .resolve()
                .and_then(|volume| unsafe { volume.SetMute(entry.previous, std::ptr::null()) })
            {
                Ok(()) => {
                    count += 1;
                    false
                }
                Err(_) => {
                    failed = true;
                    true
                }
            }
        });
        return if failed {
            Err(E_FAIL.into())
        } else {
            Ok(count)
        };
    }
    if !saved.is_empty() {
        return Ok(saved.len());
    }
    let owned = own_processes(source_process(app)?)?;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }?;
    let devices = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }?;
    for index in 0..unsafe { devices.GetCount() }? {
        let device = unsafe { devices.Item(index) }?;
        let manager: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None) }?;
        let sessions = unsafe { manager.GetSessionEnumerator() }?;
        for index in 0..unsafe { sessions.GetCount() }? {
            let control: IAudioSessionControl2 = unsafe { sessions.GetSession(index) }?.cast()?;
            if !owned.contains(&unsafe { control.GetProcessId() }?) {
                continue;
            }
            let volume: ISimpleAudioVolume = control.cast()?;
            let previous = unsafe { volume.GetMute() }?.as_bool();
            let reference = windows::core::AgileReference::new(&volume)?;
            unsafe { volume.SetMute(true, std::ptr::null()) }?;
            saved.push(Muted {
                volume: reference,
                previous,
            });
            if !unsafe { volume.GetMute() }?.as_bool() {
                return Err(E_FAIL.into());
            }
        }
    }
    if saved.is_empty() {
        return Err(E_FAIL.into());
    }
    Ok(saved.len())
}
fn capture(
    process: u32,
    stop: impl Fn() -> bool,
    mut publish: impl FnMut([f32; crate::audio_spectrum::BANDS]),
) -> Result<Summary, (&'static str, HRESULT)> {
    let stage = |name| move |error: windows::core::Error| (name, error.code());
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(stage("com"))?;
    }
    let _com = Com;
    let parameters = Box::new(AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: process,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    });
    let parameter_pointer = (&*parameters as *const AUDIOCLIENT_ACTIVATION_PARAMS)
        .cast_mut()
        .cast::<u8>();
    let (sender, receiver) = mpsc::channel();
    let completion: IActivateAudioInterfaceCompletionHandler = Completion {
        sender: Mutex::new(Some(sender)),
        _parameters: parameters,
    }
    .into();
    // Borrowed blob memory is owned by Completion, never PropVariantClear.
    let mut variant = ManuallyDrop::new(PROPVARIANT::default());
    unsafe {
        let inner = &mut *variant.Anonymous.Anonymous;
        inner.vt = VT_BLOB;
        inner.Anonymous.blob = BLOB {
            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: parameter_pointer,
        };
    }
    let _operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*variant),
            &completion,
        )
    }
    .map_err(stage("activate"))?;
    let pointer = receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| ("activation_timeout", HRESULT(0x800705B4u32 as i32)))?
        .map_err(|code| ("activate_result", code))?;
    // Both callback and worker are in the MTA. Transfer the owned COM
    // reference within that apartment; no interface from another app is used.
    let client = unsafe { IAudioClient::from_raw(pointer as *mut _) };
    let format = WAVEFORMATEX {
        wFormatTag: 3,
        nChannels: 2,
        nSamplesPerSec: 44100,
        nAvgBytesPerSec: 352800,
        nBlockAlign: 8,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            0,
            0,
            &format,
            None,
        )
    }
    .map_err(stage("initialize"))?;
    let event = Event(unsafe { CreateEventW(None, false, false, None) }.map_err(stage("event"))?);
    unsafe { client.SetEventHandle(event.0) }.map_err(stage("event_handle"))?;
    let reader: IAudioCaptureClient =
        unsafe { client.GetService() }.map_err(stage("capture_client"))?;
    unsafe { client.Start() }.map_err(stage("start"))?;
    let _running = Running(&client);
    let mut last_publish = Instant::now();
    let mut last_samples = Instant::now();
    let mut spectrum = crate::audio_spectrum::Spectrum::new(44100);
    let mut summary = Summary {
        frames: 0,
        packets: 0,
        samples: 0,
        squares: 0.0,
        peak: 0.0,
        bands: [0.0; crate::audio_spectrum::BANDS],
    };
    while !stop() {
        unsafe {
            WaitForSingleObject(event.0, 50);
        }
        while !stop() && unsafe { reader.GetNextPacketSize() }.map_err(stage("packet_size"))? > 0 {
            let mut data = std::ptr::null_mut();
            let mut frames = 0;
            let mut flags = 0;
            unsafe { reader.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
                .map_err(stage("read"))?;
            if frames > 44100 * 2 {
                unsafe {
                    let _ = reader.ReleaseBuffer(frames);
                }
                return Err(("packet_limit", E_FAIL));
            }
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 == 0 && frames > 0 {
                if data.is_null() {
                    unsafe {
                        let _ = reader.ReleaseBuffer(frames);
                    }
                    return Err(("null_buffer", E_POINTER));
                }
                let samples =
                    unsafe { std::slice::from_raw_parts(data.cast::<f32>(), frames as usize * 2) };
                spectrum.push_stereo(samples);
                for value in samples {
                    let sample = if value.is_finite() {
                        f64::from(*value)
                    } else {
                        0.0
                    };
                    summary.squares += sample * sample;
                    summary.peak = summary.peak.max(sample.abs());
                }
            } else {
                spectrum.silence(frames as usize);
            }
            if frames > 0 {
                last_samples = Instant::now();
            }
            summary.frames += u64::from(frames);
            summary.samples += u64::from(frames) * 2;
            summary.packets += 1;
            unsafe { reader.ReleaseBuffer(frames) }.map_err(stage("release"))?;
        }
        if last_publish.elapsed() >= Duration::from_millis(33) {
            if last_samples.elapsed() > Duration::from_millis(100) {
                spectrum.silence(2048);
            }
            publish(spectrum.bands());
            last_publish = Instant::now();
        }
    }
    summary.bands = spectrum.bands();
    Ok(summary)
}
#[cfg(all(debug_assertions, feature = "audio-probe"))]
pub fn run(app: &tauri::AppHandle) -> serde_json::Value {
    let started = Instant::now();
    let result = source_process(app)
        .map_err(|error| ("source_identity", error.code()))
        .and_then(|process| {
            capture(
                process,
                || started.elapsed() >= Duration::from_secs(2),
                |_| {},
            )
        });
    match result {
        Ok(value) => {
            serde_json::json!({"available":true,"frames":value.frames,"packets":value.packets,"sampleRate":44100,"channels":2,"rms":if value.samples==0{0.0}else{(value.squares/value.samples as f64).sqrt()},"peak":value.peak,"bands":value.bands.as_slice(),"scope":"own_process_tree","filesWritten":false})
        }
        Err((stage, code)) => {
            serde_json::json!({"available":false,"stage":stage,"code":format!("0x{:08X}",code.0 as u32),"scope":"own_process_tree","filesWritten":false})
        }
    }
}

pub fn stream(
    app: &tauri::AppHandle,
    stop: impl Fn() -> bool,
    publish: impl FnMut([f32; crate::audio_spectrum::BANDS]),
) -> Result<(), String> {
    let process = source_process(app).map_err(|_| "Audio source is not ready".to_string())?;
    capture(process, stop, publish)
        .map(|_| ())
        .map_err(|(stage, code)| format!("Audio analysis {stage}: 0x{:08X}", code.0 as u32))
}
