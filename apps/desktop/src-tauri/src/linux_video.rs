use tauri::{Manager, WebviewWindow};

#[cfg(all(target_os = "linux", feature = "linux-player-host"))]
mod compositor;
#[cfg(all(target_os = "linux", feature = "linux-player-host"))]
pub use compositor::{remove, update};

/// A native snapshot of the existing WebKit surface, never a second player.
/// Restricted to isolated debug profiles until the compositor spike passes.
#[tauri::command]
pub async fn linux_video_probe(
    window: WebviewWindow,
    mirror_label: Option<String>,
    stage: Option<crate::video_mirror::Rect>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main"
        || !cfg!(debug_assertions)
        || !window.state::<crate::storage::StorageState>().test_mode
    {
        return Err("Video probe requires an isolated debug profile".into());
    }
    #[cfg(all(target_os = "linux", feature = "linux-player-host"))]
    {
        if let Some(label) = mirror_label {
            return mirror_probe(&window, &label, stage).await;
        }
        use gtk::prelude::WidgetExt;
        use webkit2gtk::WebViewExt;
        let source = window
            .app_handle()
            .get_webview_window(crate::player_host::LABEL)
            .ok_or("Video engine is not ready")?;
        let (sender, receiver) = std::sync::mpsc::channel();
        source.with_webview(move |view| {
            let webview = view.inner();
            let width = webview.allocated_width();
            let height = webview.allocated_height();
            webview.snapshot(webkit2gtk::SnapshotRegion::Visible, webkit2gtk::SnapshotOptions::NONE,
                None::<&webkit2gtk::gio::Cancellable>, move |snapshot| {
                    let result = (|| -> Result<serde_json::Value, String> {
                        let surface = snapshot.map_err(|_| "WebKit snapshot failed")?;
                        let mut image = gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32,width,height)
                            .map_err(|_| "Cannot allocate video snapshot")?;
                        {
                            let context = gtk::cairo::Context::new(&image).map_err(|_| "Cannot draw snapshot")?;
                            context.set_source_surface(&surface,0.0,0.0).map_err(|_| "Cannot copy snapshot")?;
                            context.paint().map_err(|_| "Cannot paint snapshot")?;
                        }
                        let data = image.data().map_err(|_| "Cannot inspect snapshot")?;
                        let mut hash = 0xcbf29ce484222325u64;
                        let mut non_black = 0;
                        for pixel in data.as_chunks::<4>().0.iter().step_by(97) {
                            if pixel[..3].iter().any(|v| *v>8) { non_black+=1; }
                            for byte in &pixel[..3] { hash=(hash^u64::from(*byte)).wrapping_mul(0x100000001b3); }
                        }
                        Ok(serde_json::json!({"width":width,"height":height,"hash":format!("{hash:016x}"),"nonBlack":non_black}))
                    })();
                    let _=sender.send(result);
                });
        }).map_err(|_| "Cannot dispatch video snapshot")?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|_| "Video snapshot timed out".to_string())?
        })
        .await
        .map_err(|_| "Video probe worker failed".to_string())?
    }
    #[cfg(not(all(target_os = "linux", feature = "linux-player-host")))]
    {
        let _ = (mirror_label, stage);
        Err("Linux video probe is not enabled".into())
    }
}

#[cfg(all(target_os = "linux", feature = "linux-player-host"))]
async fn mirror_probe(
    main: &WebviewWindow,
    label: &str,
    stage: Option<crate::video_mirror::Rect>,
) -> Result<serde_json::Value, String> {
    use gtk::{gdk::prelude::*, prelude::*};
    if label != "main" && !crate::scenes::is_scene(label) {
        return Err("Unknown mirror window".into());
    }
    let window = main
        .app_handle()
        .get_webview_window(label)
        .ok_or("Mirror window unavailable")?;
    let output = std::env::var_os("YCORE_TEST_DATA_DIR")
        .map(std::path::PathBuf::from)
        .ok_or("Missing test directory")?
        .join(format!("linux-mirror-{label}.png"));
    let (sender, receiver) = std::sync::mpsc::channel();
    window.clone().run_on_main_thread(move || {
        let result=(|| -> Result<serde_json::Value,String> {
            let native=window.gtk_window().map_err(|_|"Cannot read mirror window")?;
            let drawable=native.window().ok_or("Mirror is not mapped")?;
            let rect=stage.unwrap_or(crate::video_mirror::Rect{x:0.0,y:0.0,width:f64::from(native.allocated_width()),height:f64::from(native.allocated_height())});
            if !(crate::video_mirror::Surface{visible:true,stage:rect,holes:vec![],dimmed:false}).valid() {return Err("Invalid probe region".into());}
            let pixels=drawable.pixbuf(rect.x.round() as i32,rect.y.round() as i32,rect.width.round() as i32,rect.height.round() as i32).ok_or("Cannot read mirror pixels")?;
            pixels.savev(&output,"png",&[]).map_err(|_|"Cannot save isolated mirror probe")?;
            let bytes=pixels.read_pixel_bytes();let mut hash=0xcbf29ce484222325u64;
            for byte in bytes.as_ref().iter().step_by(97) {hash=(hash^u64::from(*byte)).wrapping_mul(0x100000001b3);}
            Ok(serde_json::json!({"hash":format!("{hash:016x}"),"width":pixels.width(),"height":pixels.height()}))
        })();let _=sender.send(result);
    }).map_err(|_|"Cannot dispatch mirror probe")?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "Mirror probe timed out".to_string())?
    })
    .await
    .map_err(|_| "Mirror probe worker failed".to_string())?
}
