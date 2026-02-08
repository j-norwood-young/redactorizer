use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::ImageFormat;
use std::fs;
use std::io::Cursor;
use std::path::Path;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize)]
struct OpenImageResult {
    path: String,
    base64: String,
}

/// Decode image bytes (any format), re-encode as PNG with no metadata.
fn sanitize_to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
async fn open_image_dialog(app: tauri::AppHandle) -> Result<Option<OpenImageResult>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_pick_file();

    let Some(file_path) = path else {
        return Ok(None);
    };

    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    let path_str = path_buf
        .to_str()
        .ok_or("Invalid path")?
        .to_string();
    let bytes = fs::read(&path_buf).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;
    Ok(Some(OpenImageResult {
        path: path_str,
        base64: BASE64.encode(&png_bytes),
    }))
}

/// Save image. When overwrite_path is set, write there (no dialog). Otherwise show save dialog.
/// Returns the path written to, or None if the user cancelled the dialog.
#[tauri::command(rename_all = "camelCase")]
async fn save_image(
    app: tauri::AppHandle,
    base64_png: String,
    overwrite_path: Option<String>,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let bytes = BASE64.decode(base64_png.trim()).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;

    let path_buf = if let Some(ref p) = overwrite_path {
        Path::new(p).to_path_buf()
    } else {
        let path = app
            .dialog()
            .file()
            .add_filter("PNG image", &["png"])
            .set_file_name(default_name.as_deref().unwrap_or("redacted.png"))
            .blocking_save_file();
        let Some(file_path) = path else {
            return Ok(None);
        };
        file_path.into_path().map_err(|e| e.to_string())?
    };

    fs::write(&path_buf, &png_bytes).map_err(|e| e.to_string())?;
    path_buf
        .to_str()
        .map(|s| Ok(Some(s.to_string())))
        .unwrap_or(Err("Invalid path".to_string()))
}

/// Load image from a file path (e.g. from OS drag-drop). Returns base64 PNG.
#[tauri::command(rename_all = "camelCase")]
async fn load_image_from_path(path: String) -> Result<(String, String), String> {
    let path_buf = Path::new(&path).to_path_buf();
    let bytes = fs::read(&path_buf).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;
    let base64 = BASE64.encode(&png_bytes);
    let name = path_buf
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image.png")
        .to_string();
    Ok((base64, name))
}

/// Accept base64 of any supported image format; return sanitized PNG base64. For drop/paste.
#[tauri::command(rename_all = "camelCase")]
async fn any_image_to_png_base64(base64_any: String) -> Result<String, String> {
    let bytes = BASE64.decode(base64_any.trim()).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;
    Ok(BASE64.encode(&png_bytes))
}

/// Sanitize image bytes (decode + re-encode as PNG, no metadata). Returns base64 PNG.
#[tauri::command]
async fn sanitize_image(base64_png: String) -> Result<String, String> {
    let bytes = BASE64.decode(base64_png.trim()).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;
    Ok(BASE64.encode(&png_bytes))
}

/// Write sanitized image to a temp file. Returns the file path for sharing.
#[tauri::command]
async fn write_temp_image(base64_png: String) -> Result<String, String> {
    let bytes = BASE64.decode(base64_png.trim()).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;
    let temp_dir = std::env::temp_dir();
    let path = temp_dir.join("redactorizer_redacted.png");
    fs::write(&path, &png_bytes).map_err(|e| e.to_string())?;
    path.into_os_string()
        .into_string()
        .map_err(|_| "Invalid path".to_string())
}

/// Share image: on macOS use native Share menu (AirDrop, Mail, etc.); on other desktops open with default app.
#[tauri::command]
fn share_image_open_with_app(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return share_image_macos_native(&app, &path);

    #[cfg(not(target_os = "macos"))]
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn share_image_macos_native(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2_foundation::{NSArray, NSRect, NSRectEdge, NSURL};
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::path::Path;
    use tauri::Manager;

    let app = app.clone();
    let path = path.to_string();

    dispatch2::run_on_main(move |_mtm| {
        let window = app
            .get_webview_window("main")
            .or_else(|| app.webview_windows().into_values().next())
            .ok_or("No window available for share")?;

        let raw = window
            .window_handle()
            .map_err(|e| format!("Window handle: {}", e))?
            .as_raw();

        let ns_view_ptr = match raw {
            RawWindowHandle::AppKit(api) => api.ns_view.as_ptr(),
            _ => return Err("Not an AppKit window".to_string()),
        };

        let url = NSURL::from_file_path(Path::new(&path))
            .ok_or_else(|| "Invalid file path for share".to_string())?;
        let items = NSArray::from_retained_slice(&[url.into_super()]);

        let allocated = NSSharingServicePicker::alloc();
        let items_ref: &NSArray = unsafe { &*(&*items as *const _ as *const NSArray) };
        let picker = unsafe { NSSharingServicePicker::initWithItems(allocated, items_ref) };

        let view = unsafe { &*ns_view_ptr.cast::<NSView>() };
        picker.showRelativeToRect_ofView_preferredEdge(
            NSRect::default(),
            view,
            NSRectEdge::MinY,
        );

        Ok(())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_share::init())
        .invoke_handler(tauri::generate_handler![
            open_image_dialog,
            save_image,
            load_image_from_path,
            any_image_to_png_base64,
            sanitize_image,
            write_temp_image,
            share_image_open_with_app,
        ])
        .setup(|app| {
            // App submenu (first = application menu on macOS: About, Hide, Quit, etc.)
            let sep = PredefinedMenuItem::separator(app)?;
            let about = PredefinedMenuItem::about(app, None, None)?;
            let hide = PredefinedMenuItem::hide(app, None)?;
            let hide_others = PredefinedMenuItem::hide_others(app, None)?;
            let show_all = PredefinedMenuItem::show_all(app, None)?;
            let quit = PredefinedMenuItem::quit(app, None)?;
            let app_menu = {
                let b = SubmenuBuilder::new(app, "Redactorizer").item(&about);
                #[cfg(target_os = "macos")]
                let b = b.item(&PredefinedMenuItem::services(app, None)?);
                b.item(&sep)
                    .item(&hide)
                    .item(&hide_others)
                    .item(&show_all)
                    .item(&sep)
                    .item(&quit)
                    .build()?
            };

            // File submenu (Open, Save, Save As, Share)
            let open_item = MenuItem::with_id(app, "open", "Open", true, Some("CmdOrCtrl+O"))?;
            let save_item = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as_item =
                MenuItem::with_id(app, "saveAs", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
            let share_item = MenuItem::with_id(app, "share", "Share", true, None::<&str>)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
                .item(&save_item)
                .item(&save_as_item)
                .item(&share_item)
                .build()?;

            // Edit submenu (Copy with Cmd/Ctrl+C)
            let copy_item = MenuItem::with_id(app, "copy", "Copy", true, Some("CmdOrCtrl+C"))?;
            let paste_item = MenuItem::with_id(app, "paste", "Paste", true, Some("CmdOrCtrl+V"))?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&copy_item)
                .item(&paste_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu])
                .build()?;
            app.set_menu(menu)?;
            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                let _ = app_handle.emit("menu-action", id);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
