//! One WebKit snapshot shared by every native Cairo surface. No extra WebView,
//! iframe, media decode, image encoding or network request is used for mirrors.
use crate::video_mirror::Surface;
use gtk::{cairo, glib, prelude::*};
use std::{
    cell::RefCell,
    collections::HashMap,
    rc::Rc,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{Manager, WebviewWindow};
use webkit2gtk::WebViewExt;

static SURFACES: OnceLock<Mutex<HashMap<String, Surface>>> = OnceLock::new();
fn surfaces() -> &'static Mutex<HashMap<String, Surface>> {
    SURFACES.get_or_init(Mutex::default)
}
struct Frame {
    surface: cairo::Surface,
    width: i32,
    height: i32,
}
struct Target {
    area: gtk::DrawingArea,
    options: Rc<RefCell<Surface>>,
}
impl Drop for Target {
    fn drop(&mut self) {
        unsafe {
            self.area.destroy();
        }
    }
}
#[derive(Default)]
struct Compositor {
    targets: HashMap<String, Target>,
    frame: Rc<RefCell<Option<Frame>>>,
    pending: bool,
}
thread_local! { static NATIVE: RefCell<Option<Compositor>> = const { RefCell::new(None) }; }

pub fn remove(label: &str) {
    if let Ok(mut all) = surfaces().lock() {
        all.remove(label);
    }
}
pub fn update(window: &WebviewWindow, surface: &Surface) -> Result<(), String> {
    surfaces()
        .lock()
        .map_err(|_| "Video surfaces unavailable")?
        .insert(window.label().into(), surface.clone());
    let app = window.app_handle().clone();
    window
        .run_on_main_thread(move || {
            NATIVE.with(|slot| {
                if slot.borrow().is_some() {
                    return;
                }
                *slot.borrow_mut() = Some(Compositor::default());
                glib::timeout_add_local(Duration::from_micros(16_667), move || {
                    tick(&app);
                    glib::ControlFlow::Continue
                });
            });
        })
        .map_err(|_| "Cannot dispatch GTK video mirror".into())
}

fn target(
    window: &WebviewWindow,
    frame: Rc<RefCell<Option<Frame>>>,
    surface: Surface,
) -> Result<Target, String> {
    let native = window
        .gtk_window()
        .map_err(|_| "Cannot read mirror window")?;
    let child = native.child().ok_or("Mirror window has no content")?;
    let overlay = if let Ok(overlay) = child.clone().downcast::<gtk::Overlay>() {
        overlay
    } else {
        native.remove(&child);
        let overlay = gtk::Overlay::new();
        overlay.set_hexpand(true);
        overlay.set_vexpand(true);
        overlay.add(&child);
        native.add(&overlay);
        overlay.show();
        overlay
    };
    let area = gtk::DrawingArea::new();
    // A mirror is paint only. Do not create a native input window above the
    // WebKit surface: some GTK/compositor combinations otherwise swallow real
    // pointer events despite GtkOverlay's pass-through dispatch flag.
    area.set_has_window(false);
    area.set_can_focus(false);
    area.set_hexpand(true);
    area.set_vexpand(true);
    let options = Rc::new(RefCell::new(surface));
    let draw_options = options.clone();
    area.connect_draw(move |_, context| {
        let frame = frame.borrow();
        let Some(frame) = frame.as_ref() else {
            return glib::Propagation::Proceed;
        };
        let options = draw_options.borrow();
        let stage = options.stage;
        if !options.visible
            || stage.width <= 0.0
            || stage.height <= 0.0
            || frame.width <= 0
            || frame.height <= 0
        {
            return glib::Propagation::Proceed;
        }
        if context.save().is_err() {
            return glib::Propagation::Proceed;
        }
        let scale =
            (stage.width / f64::from(frame.width)).min(stage.height / f64::from(frame.height));
        let x = stage.x + (stage.width - f64::from(frame.width) * scale) / 2.0;
        let y = stage.y + (stage.height - f64::from(frame.height) * scale) / 2.0;
        // Existing rectangle subtraction also protects DOM controls and dialogs.
        for tile in crate::video_mirror::tiles(
            stage,
            &options.holes,
            f64::from(frame.width),
            f64::from(frame.height),
        ) {
            let rect = tile.destination;
            context.rectangle(rect.x, rect.y, rect.width, rect.height);
        }
        context.clip();
        context.translate(x, y);
        context.scale(scale, scale);
        if context.set_source_surface(&frame.surface, 0.0, 0.0).is_ok() {
            context.source().set_filter(cairo::Filter::Bilinear);
            let _ = context.paint_with_alpha(if options.dimmed { 0.25 } else { 1.0 });
        }
        let _ = context.restore();
        glib::Propagation::Proceed
    });
    overlay.add_overlay(&area);
    overlay.set_overlay_pass_through(&area, true);
    area.show();
    Ok(Target { area, options })
}

fn tick(app: &tauri::AppHandle) {
    let Ok(configs) = surfaces().lock().map(|all| all.clone()) else {
        return;
    };
    let capture=NATIVE.with(|slot| {
        let mut native=slot.borrow_mut();let Some(native)=native.as_mut() else { return false; };
        native.targets.retain(|label,_| configs.contains_key(label)&&app.get_webview_window(label).is_some());
        for (label,options) in configs {
            if !native.targets.contains_key(&label) {
                let Some(window)=app.get_webview_window(&label) else { continue; };
                match target(&window,native.frame.clone(),options.clone()) {
                    Ok(value)=>{native.targets.insert(label.clone(),value);}
                    Err(_)=>{let _=window.eval("document.body.dataset.videoMirrorFailure='Native GTK mirror unavailable';document.dispatchEvent(new Event('video-mirror-error'));");continue;}
                }
            }
            let target=&native.targets[&label];target.area.set_visible(options.visible);*target.options.borrow_mut()=options;
        }
        if native.pending || !native.targets.values().any(|t|t.area.is_drawable()) { return false; }
        native.pending=true;true
    });
    if !capture {
        return;
    }
    let Some(source) = app.get_webview_window(crate::player_host::LABEL) else {
        clear_pending();
        return;
    };
    if source
        .with_webview(|view| {
            let webview = view.inner();
            let width = webview.allocated_width();
            let height = webview.allocated_height();
            webview.snapshot(
                webkit2gtk::SnapshotRegion::Visible,
                webkit2gtk::SnapshotOptions::NONE,
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| {
                    NATIVE.with(|slot| {
                        let mut native = slot.borrow_mut();
                        let Some(native) = native.as_mut() else {
                            return;
                        };
                        native.pending = false;
                        if let Ok(surface) = result {
                            *native.frame.borrow_mut() = Some(Frame {
                                surface,
                                width,
                                height,
                            });
                            for target in native.targets.values().filter(|t| t.area.is_drawable()) {
                                target.area.queue_draw();
                            }
                        }
                    });
                },
            );
        })
        .is_err()
    {
        clear_pending();
    }
}
fn clear_pending() {
    NATIVE.with(|slot| {
        if let Some(native) = slot.borrow_mut().as_mut() {
            native.pending = false;
        }
    });
}
