// commands.rs - 前端可调用的 Tauri commands

use crate::epub;
use crate::store::{self, Preferences, Progress, ProgressMap};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

// ---------- 初始文件（CLI 参数 / 双击 .epub / 拖动到 exe） ----------
//
// 重要：PendingFile 设値以后有三种消费者：
//   1) 前端 bootstrap 的 take_initial_file（仅首次调用拿走）
//   2) 已运行实例收到一个新文件（single-instance 回调、或者联关双击）
//   3) 后续使用 set_initial_file 的未知调用
// 除了 take 以外，后端还要 emit 一个事件让前端可以重新拿。
// 原因：bootstrap 只调用 take_initial_file 一次；
// 第二次启动、或者从托盘恢复窗口，都需要重新 take。

#[derive(Default)]
pub struct PendingFile(pub Mutex<Option<PathBuf>>);

#[tauri::command]
pub fn take_initial_file(pending: State<'_, PendingFile>) -> Option<String> {
    pending
        .0
        .lock()
        .unwrap()
        .take()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_initial_file(pending: State<'_, PendingFile>, path: String) {
    *pending.0.lock().unwrap() = Some(PathBuf::from(path));
}

/// 供后端单实例回调 / setup 钩子调用。比 set_initial_file 多做两件事：
///   1. 尝试 canonicalize（使 bookId 能抹平同一本书的不同路径表示）
///   2. emit "open-epub" 事件，通知前端重新 take
pub fn enqueue_pending_file(app: &AppHandle, raw_path: &Path) {
    let canonical = raw_path.canonicalize().unwrap_or_else(|_| raw_path.to_path_buf());
    *app.state::<PendingFile>().0.lock().unwrap() = Some(canonical.clone());
    // 发送事件：前端 listen 后可以再次 take_initial_file。
    // 事件包含 canonical 路径字符串，让前端能不依赖 take 也能拿到。
    let payload = canonical.to_string_lossy().to_string();
    let _ = app.emit("open-epub", payload);
}

// ---------- 偏好 ----------

#[tauri::command]
pub fn load_preferences(app: AppHandle) -> Result<Preferences, String> {
    store::load_preferences(&app)
}

#[tauri::command]
pub fn save_preferences(app: AppHandle, prefs: Preferences) -> Result<(), String> {
    store::save_preferences(&app, &prefs)
}

// ---------- 阅读进度 ----------

#[tauri::command]
pub fn save_progress(
    app: AppHandle,
    map: State<'_, ProgressMap>,
    book_id: String,
    progress: Progress,
) -> Result<(), String> {
    {
        let mut guard = map.0.lock().unwrap();
        guard.insert(book_id, progress);
    }
    let snapshot = map.0.lock().unwrap().clone();
    store::save_progress(&app, &snapshot)
}

#[tauri::command]
pub fn load_progress(
    map: State<'_, ProgressMap>,
    book_id: String,
) -> Option<Progress> {
    map.0.lock().unwrap().get(&book_id).cloned()
}

// ---------- EPUB ----------

#[derive(Serialize)]
pub struct OpenEpubResult {
    pub book: epub::BookInfo,
    pub css: String,
}

#[tauri::command]
pub fn open_epub(path: String) -> Result<OpenEpubResult, String> {
    let book = epub::open(&path)?;
    let css = epub::collect_all_css(&path);
    Ok(OpenEpubResult { book, css })
}

#[tauri::command]
pub fn get_resource(epub_path: String, src: String) -> Result<String, String> {
    // 读取图片资源并返回 data URL（绕过 file:// 在 sandbox iframe 中被拦）
    let bytes = epub::read_resource(&epub_path, &src)?;
    let mime = infer_mime(&src);
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

fn infer_mime(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/png"
    }
}

fn md5_like(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}