// store.rs - 偏好与阅读进度持久化
// 数据存储在 Tauri app_data_dir 下，跨会话保留。
//   preferences.json - 背景预设索引等 UI 偏好
//   progress.json    - { [bookId]: { bookPath, chapter, scroll, updatedAt } }

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default)]
    pub bg_index: u32,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default)]
    pub font_family_index: u32,
}

fn default_font_size() -> u32 { 16 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    #[serde(default)]
    pub book_path: String,
    #[serde(default)]
    pub chapter: i32,
    #[serde(default)]
    pub scroll: f32,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Default)]
pub struct ProgressMap(pub Mutex<HashMap<String, Progress>>);

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取 app_data_dir: {e}"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    Ok(dir)
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("preferences.json"))
}

fn progress_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("progress.json"))
}

// ---------- 偏好 ----------
pub fn load_preferences(app: &AppHandle) -> Result<Preferences, String> {
    let p = prefs_path(app)?;
    if !p.exists() {
        return Ok(Preferences::default());
    }
    let txt = fs::read_to_string(&p).map_err(|e| format!("读取偏好失败: {e}"))?;
    serde_json::from_str(&txt).map_err(|e| format!("解析偏好失败: {e}"))
}

pub fn save_preferences(app: &AppHandle, prefs: &Preferences) -> Result<(), String> {
    let p = prefs_path(app)?;
    let txt = serde_json::to_string_pretty(prefs).map_err(|e| format!("序列化偏好失败: {e}"))?;
    fs::write(&p, txt).map_err(|e| format!("写入偏好失败: {e}"))
}

// ---------- 进度 ----------
pub fn load_all_progress(app: &AppHandle) -> HashMap<String, Progress> {
    let p = match progress_path(app) {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    if !p.exists() {
        return HashMap::new();
    }
    let txt = match fs::read_to_string(&p) {
        Ok(t) => t,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&txt).unwrap_or_default()
}

pub fn save_progress(
    app: &AppHandle,
    map: &HashMap<String, Progress>,
) -> Result<(), String> {
    let p = progress_path(app)?;
    let txt = serde_json::to_string_pretty(map).map_err(|e| format!("序列化进度失败: {e}"))?;
    fs::write(&p, txt).map_err(|e| format!("写入进度失败: {e}"))
}