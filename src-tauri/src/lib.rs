use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::ImageFormat;
use std::fs;
use std::io::Cursor;
use tauri_plugin_dialog::DialogExt;

/// Decode image bytes (any format), re-encode as PNG with no metadata.
fn sanitize_to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
async fn open_image_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_pick_file();

    let Some(file_path) = path else {
        return Ok(None);
    };

    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    let bytes = fs::read(&path_buf).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;
    Ok(Some(BASE64.encode(&png_bytes)))
}

#[tauri::command]
async fn save_image(app: tauri::AppHandle, base64_png: String) -> Result<(), String> {
    let bytes = BASE64.decode(base64_png.trim()).map_err(|e| e.to_string())?;
    let png_bytes = sanitize_to_png(&bytes)?;

    let path = app
        .dialog()
        .file()
        .add_filter("PNG image", &["png"])
        .set_file_name("redacted.png")
        .blocking_save_file();

    let Some(file_path) = path else {
        return Ok(());
    };

    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    fs::write(&path_buf, &png_bytes).map_err(|e| e.to_string())?;
    Ok(())
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
            sanitize_image,
            write_temp_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
