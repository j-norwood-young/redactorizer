use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::ImageFormat;
use std::fs;
use std::io::Cursor;
use std::path::Path;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

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
            any_image_to_png_base64,
            sanitize_image,
            write_temp_image,
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
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&copy_item)
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
