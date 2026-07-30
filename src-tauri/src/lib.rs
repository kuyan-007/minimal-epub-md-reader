// 极简EPUB阅读器 - 应用入口
// 阶段 2：commands 注册 + 进度/偏好持久化 + CLI 参数透传

mod commands;
pub mod epub;
pub mod md;
mod store;

use commands::PendingFile;
use store::ProgressMap;
use std::path::Path;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    DragDropEvent, Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 已有实例收到新启动参数（拖动/关联双击另一个 .epub）。
			// 找出 argv 中的 .epub/.md 路径，emit "open-epub" 让前端重新打开。
			for arg in argv.iter().skip(1) {
				let p = Path::new(arg);
				if p.exists() {
					if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
						if ext.eq_ignore_ascii_case("epub") || ext.eq_ignore_ascii_case("md") {
							commands::enqueue_pending_file(app, p);
							break;
						}
					}
				}
            }
            // 恢复窗口并聚焦
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .manage(PendingFile::default())
        .setup(|app| {
            // 1. 加载所有历史阅读进度
            let progress_map = store::load_all_progress(app.handle());
            app.manage(ProgressMap(std::sync::Mutex::new(progress_map)));

			// 2. 解析 CLI 参数：双击 .epub/.md 时第一个非 flag 参数就是文件路径
			let args: Vec<String> = std::env::args().skip(1).collect();
			for arg in &args {
				let p = Path::new(arg);
				if p.exists() {
					if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
						if ext.eq_ignore_ascii_case("epub") || ext.eq_ignore_ascii_case("md") {
							commands::enqueue_pending_file(app.handle(), p);
							break;
						}
					}
				}
            }

            // 3. 托盘菜单：显示 / 退出
            let show_item = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("Minimal EPUB Reader")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // 将外部文件拖进窗口：
        //   - Webview 没有接收 HTML5 drag events（背后 OS file drop 被 Rust 截发）
        //   - WindowEvent::DragDrop(Drop { paths }) 包含真实路径
        //   - 复用 commands::enqueue_pending_file，发 "open-epub" 给前端
        //   - 同时显示/聚焦窗口，不然隐藏后拖进还是看不见
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
			if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
				// 与 single-instance / CLI 双击一致：取首个 .epub/.md 拖入的书
				for path in paths {
					if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
						if ext.eq_ignore_ascii_case("epub") || ext.eq_ignore_ascii_case("md") {
							commands::enqueue_pending_file(window.app_handle(), &path);
							break;
						}
					}
                }
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::take_initial_file,
            commands::set_initial_file,
            commands::load_preferences,
            commands::save_preferences,
            commands::save_progress,
            commands::load_progress,
            commands::open_epub,
            commands::open_md,
            commands::get_resource,
            commands::get_md_resource,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// 防止 Progress 类型在某些位置未使用警告
#[allow(dead_code)]
fn _force_link(_: store::Progress) -> store::Progress { store::Progress::default() }