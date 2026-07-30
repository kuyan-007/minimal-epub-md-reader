# AGENT.md · 极简EPUB阅读器（cwd: 项目根）

## 构建节奏

- **不主动构建 exe**：源码改完等指令才 `cargo build --release`
- 验证优先：jsdom+Node / `%APPDATA%\com.minimal.epub.reader\progress.json` / `cargo run --example`

## 记忆

- 每改一处核心 BUG 或设计契约 → `core/project/` 独立 .md（slug: `bugfix-<key>.md` / `feature-<key>.md`），`MEMORY.md` 索引表追加一行
- 每条字段：现象 / 根因+代码 / 修复 / 验证 / 一句话结论

## Tauri v2 + Windows 文件

- bookId = `canonicalize().to_ascii_lowercase()` 再 hash；进度文件用同一 key
- 单实例 / setup / 窗口拖入 都走 `commands::enqueue_pending_file`（emit `open-epub`）
- `use` 别忘 `Emitter, Manager`；`\?\` 是 Windows canonicalize 默认，**兼容不绕开**

## iframe srcdoc 渲染

- 沙箱 `sandbox="allow-same-origin"`，**不**加 `allow-scripts`
- scroll / click / wheel：绑 `iframe.contentDocument`，**不**绑主 doc
- 跨章节共享可变状态放模块顶层，**不**放 init 函数内 `let`
- 窗口拖入文件：Rust `on_window_event` 抓 `WindowEvent::DragDrop(DragDropEvent::Drop { paths })`

## 一屏一页翻页（v3）

- iframe 内 CSS：原生纵向滚动 `overflow-y: auto; scrollbar-width: none; ::-webkit-scrollbar { display: none }`
- `state.totalPages = round(scrollHeight / clientHeight)`；`state.currentPage = round(scrollTop / clientHeight)`
- **wheel 拦截**：preventDefault + `root.scrollTop += deltaY > 0 ? clientHeight : -clientHeight`
- edge-top → prevChapter；edge-bottom → 让 chapter-end 3s 接管续读
- 章末续读：`onLastPage && atEnd && Date.now() - enteredChapterAt > 1500` 后启 3s timer，离开末屏解锁

## 窗口恢复

- `show + unminimize + setFocus` **三连**；单一 `show()` 在最小化态无效

## 快捷键（已收敛）

- `←` / `→` 翻页；`Esc` 隐藏；左边缘 hover 或主区 click 呼出目录
- "以顺序值为依据跳转"必须用 `chapters` 索引，**不**用 NCX playOrder
- 边缘热区 ≥ 60px / 250ms；iframe 中点用 mousedown→mouseup 距离 ≤ 5px

## 阅读优先原则

- 入口收缩 ≠ 极简：保留高频入口，丢弃低频操作
- 任何自动推进入章 ≥ 1.5s 入章保护；末屏停留 3s 才续读；进度保存节流不阻塞渲染

## 调试

- `%APPDATA%\com.minimal.epub.reader\progress.json` 是真值源；bookId 一致 = 同一本书识别
- Node+jsdom 翻页模板参考已删的 `verify_*.js`；Rust 端用 `cargo run --example test_epub -- <path>` 验解析
