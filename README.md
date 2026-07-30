# 极简EPUB/MD阅读器（Minimal EPUB-MD Reader）

> Windows 浮动文本窗式 EPUB 阅读器。**极简到只有三件事**：看目录、换背景、继续读。

## 一句话原则

> **入口收缩 ≠ 极简**。保留高频入口、丢弃低频操作；阅读不打扰、热键尽量静默。

---

## 项目愿景

- 用户在桌面打开一本 EPUB，**只想读**，不想被导航、设置、按钮打扰。
- 不要做字体调节、字号调节、书签、笔记、搜索、目录折叠、章节进度条……
- 进度必须能续读（同一本书，无论如何打开）。

---

## 功能与交互契约

### 打开书（三条路径统一入口）

| 路径 | 触发方式 | 内部路由 |
| ------ | --------- | --------- |
| **CLI / 关联双击** | 双击 `.epub` 或 `.md` 启动 exe | `enqueue_pending_file` → emit `open-epub` |
| **单实例 + 新文件** | 应用已运行，再次双击 / 拖到 exe | `single-instance` 回调 → `enqueue_pending_file` → emit `open-epub` |
| **拖入窗口** | 拖文件到已打开窗口 | `WindowEvent::DragDrop(Drop)` → `enqueue_pending_file` → emit `open-epub` |

三条路径都**复用** `commands::enqueue_pending_file`，保证 bookId 生成与事件 emit 100% 一致。

### 阅读主交互

| 操作 | 方式 | 备注 |
| ------ | ------ | ------ |
| 翻页 | 滚轮（一滚一屏） 或 `←` / `→` | 跨界时自动处理 |
| 切换 / 呼出目录 | 右键主区域 / 边缘 hover 60px / 250ms / 点击目录按钮 | mousedown→mouseup 距离 ≤5px 判定 |
| 切换背景 | 点击右下齿轮按钮 | 4 套预设：米黄 / 纯白 / 护眼绿 / 深灰 |
| 隐藏窗口 | `Esc` / 托盘 | `show + unminimize + setFocus` 三连 |
| 退出 | 托盘菜单 | tray 菜单 |
| 进度保存 | 滚动 → 1.5s 节流 | `%APPDATA%\com.minimal.epub.reader\progress.json` |

### 已废弃（不要再加回）

- `T` / `Ctrl+T` 呼出目录（被右键 + 边缘 hover 替代）
- `B` / `Ctrl+B` 切换背景（被右下按钮替代）
- `H` 隐藏窗口（被 Esc 替代）
- `↑` / `↓` / `PageUp` / `PageDown` / `Space` 翻章（被滚轮/箭头替代）
- wheel 翻章（被一滚一屏替代）

---

## 技术架构

### 后端（Rust / Tauri v2）

```
src-tauri/src/
├── main.rs          # 入口（5 行，调用 lib::run）
├── lib.rs           # Tauri Builder、托盘、单实例、窗口事件
├── commands.rs      # Tauri commands + PendingFile 状态
├── epub.rs          # EPUB 解析（epub crate 2.1.5）
├── md.rs            # Markdown 解析（pulldown-cmark）
└── store.rs         # 偏好 / 进度 JSON 持久化
```

**核心 crate**：`tauri` 2.x + `tauri-plugin-single-instance` + `tauri-plugin-fs` + `epub` 2.1.5 + `pulldown-cmark` 0.13 + `serde` + `base64`

### 前端（原生 HTML/CSS/JS，零框架）

```
src/
├── index.html       # 67 行
├── main.js          # 1145 行
└── style.css        # 507 行
```

**关键设计**：

- 章节用 `<iframe sandbox="allow-same-origin" srcdoc>` 渲染，**保留 EPUB 原格式**
- 滚轮 / 焦点 / 输入绑到 `iframe.contentDocument`，跨章节共享可变状态放模块顶层
- CSS 变量驱动主题（`[data-bg]` 切换 → 主 doc 重新计算 → 主 doc 注入到 iframe `:root` —— 变量不跨 iframe 继承）

### 数据流

```
[Tauri command]              [State]               [文件系统]
open_epub(path) ───┐
open_md(path) ─────┤
                   ├──► epub.rs / md.rs ──► BookInfo
save_preferences ──┤
save_progress ─────┤
                   └──► store.rs ──► preferences.json / progress.json
                          (app_data_dir)
```

### 关键技术决策

| 决策 | 原因 |
| ------ | ------ |
| `bookId = canonicalize().to_ascii_lowercase() → hash` | 同一本书在不同路径表示（绝对 / 相对 / UNC `\\?\`）下保持稳定 |
| iframe srcdoc 而非 innerHTML | 100% 保留 EPUB 自带 CSS / 图片 / 字体 |
| 章节资源 data URL 注入 | 绕过 `file://` 在 sandbox iframe 中被拦 |
| NavPoint.order 改为 href 归一化映射 | NCX `playOrder` 在 nav.xhtml 类 EPUB 全为 None |
| `enqueue_pending_file` 三路径复用 | 单一事实源，避免 bookId 与事件不一致 |

---

## 已修复的核心 BUG（横向教训）

| # | BUG | 关键教训 |
| --- | ----- | --------- |
| 1 | **TOC 点击全部跳第 1 章** | `TocNode.order` 误用 NCX `playOrder`；nav.xhtml 全 None → 必须用 href 归一化映射到 filtered 章节索引 |
| 2 | **Ctrl+T / Ctrl+B 失效** | keydown 只看 `e.key`，未识别 `ctrlKey`；文档即契约，列出的快捷键必须实现 |
| 3 | **iframe 内滚轮翻章失效** | iframe srcdoc 内 wheel 不冒泡到主 doc；必须绑 `iframe.contentDocument` |
| 4 | **第二次拖入文件无声** | `take_initial_file` 一次性，single-instance 写的 PendingFile 永远不被取走；必须 event-driven（emit + listen） |
| 5 | **bookId 不稳定** | 路径直接 hash 字符串，绝对/相对/UNC 区别 → 必须 `canonicalize().to_ascii_lowercase()` |
| 6 | **窗口最小化时 single-instance 不弹出** | `show()` 不等于 `unminimize()`；必须 `show + unminimize + setFocus` 三连 |
| 7 | **目录入口收得过窄误删 ESC** | 边缘 4px / 800ms 摸不到 + 没有 click 入口 → 入口收缩 ≠ 极简，要保留高频入口 |
| 8 | **正文翻页模式反复** | v1 wheel 翻章 → v2 column 横向 → v3 纵向原生滚 + 一滚一屏（最终版） |
| 9 | **拖入 .epub 自动打开** | OS 文件拖拽走 Rust `WindowEvent::DragDrop`，不走前端 HTML5 drag events |

每条 BUG 修复独立成 `core/project/bugfix-*.md` / `feature-*.md`，索引见 `MEMORY.md`。

---

## 横向教训（核心 5 条）

1. **Tauri v2 + 单实例文件关联**：CLI argv → setup 钩子 → PendingFile 是 ok 的，但**已运行实例不会重新 bootstrap**；必须有 emit 事件链路。前端 `__TAURI__.event.listen` 注册在 bootstrap 期内，全程有效。

2. **iframe srcdoc 渲染**：章节滚轮 / 焦点 / 输入绑到 `iframe.contentDocument` 而非主 doc；沙箱 `sandbox="allow-same-origin"` 是访问 contentDocument 的最低要求；共享状态必须放模块顶层。

3. **EPUB 解析**：NavPoint.play_order 仅 toc.ncx 有效；spine 顺序 ≠ playOrder ≠ 过滤后索引；路径字符串对比前必归一化（`\` vs `/`、大小写、首部 `./`、Windows `\\?\`）。

4. **窗口恢复**：`show()` / `unminimize()` / `setFocus()` **必须三连**，单一 `show()` 在最小化态无效。

5. **入口收缩 ≠ 极简**：去掉杂物 ≠ 切断入口。"靠近左边" = 用户指尖可达区（≥60px），不是字面 4px。隐藏能力也要保留（ESC 是托盘式应用最常用疏散键）。

---

## 数据存储

- 偏好：`%APPDATA%\com.minimal.epub.reader\preferences.json`
- 进度：`%APPDATA%\com.minimal.epub.reader\progress.json`
- EPUB 临时图片：**已废弃**（改为 data URL 注入，不再写 temp）

---

## 编译与运行

### 环境要求

- Rust 工具链（rustup + MSVC build tools）
- Node.js 18+（仅用于 Tauri CLI）
- Windows 10/11 + WebView2 Runtime（Win11 自带）

### 命令

```bash
# 开发模式
npm install
npm run dev

# 打包发布（生成 NSIS 安装包）
npm run build
# 产物在 src-tauri/target/release/bundle/nsis/
```

> **构建规则**：除非用户明确说「构建」「打包」「编译」，否则不要 `cargo build` / 替换 `minimal-epub-reader.exe`。一次会话内多次修改源代码，全部改完再统一构建（见 `core/project/build-policy.md`）。

### 调试 / 验证替代手段

- **静态语法检查**：jsdom + Node 验证关键算法
- **数据流验证**：启动已有 exe → 触发进度写入 → 读 `%APPDATA%`
- **Rust 端验证**：`cargo run --example test_epub -- <path>` 跑 examples

---

## 项目结构

```
极简EPUB阅读器/
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 5 行入口
│   │   ├── lib.rs                # Tauri Builder（托盘 + 单实例 + 拖入）
│   │   ├── commands.rs           # Tauri commands + PendingFile
│   │   ├── epub.rs               # EPUB 解析
│   │   ├── md.rs                 # Markdown 解析
│   │   ├── store.rs              # 偏好 / 进度持久化
│   │   └── examples/
│   │       ├── test_epub.rs      # 验证 EPUB 解析
│   │       └── test_resource.rs  # 验证图片资源（旧实现遗留）
│   ├── capabilities/
│   │   └── default.json          # Tauri 权限
│   ├── icons/                    # 应用图标（8 个 PNG + 3 个 ICO）
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri 配置 + 文件关联
│   └── build.rs
├── src/                          # 前端（原生 HTML/CSS/JS，零框架）
│   ├── index.html                # 67 行
│   ├── main.js                   # 1145 行
│   └── style.css                 # 507 行
├── scripts/
│   └── gen-icons.js              # 图标生成脚本（一次性已落地）
├── AGENT.md                      # 项目 AI 协作契约
├── README.md                     # 本文件
├── package.json
├── test-reader.md                # MD 模式测试文档
└── *.epub                        # 测试样本
```

---

## 设计原则（Code Review Checklist）

- [ ] **极简优先**：只做目录 + 背景 + 进度（不引入字体调节、书签、笔记等）
- [ ] **保持原格式**：用 `<iframe srcdoc>` 渲染章节，100% 保留 EPUB 自带样式
- [ ] **键盘优先**：所有功能都能用键盘操作
- [ ] **本地优先**：所有数据保存在 `%APPDATA%\com.minimal.epub.reader\`
- [ ] **入口收缩 ≠ 极简**：保留高频入口、丢弃低频操作
- [ ] **路径归一化**：所有 bookId / 资源路径必须 `canonicalize + lowercase + /` 归一化
- [ ] **事件驱动**：任何后端状态更新必须 `emit` 事件，前端 `listen` 响应
- [ ] **窗口三连**：show / unminimize / setFocus 必须三连
- [ ] **状态归顶层**：跨章节共享的可变变量不能藏在 init 函数内

---

## 后续维护提示

- 新增文件关联类型（如 `.txt`）→ 必须在 `tauri.conf.json` + `lib.rs` CLI 检测 + `commands.rs` 三处同步
- 任何"以顺序值为依据跳转"的字段，必须核对"哪个序列"（spine / playOrder / filtered index）
- iframe 内的事件监听（wheel / scroll / click）必须绑到 `iframe.contentDocument`，不要绑主 doc
- 一滚一屏模式（v3）是最稳的，**不要回退**到 wheel 翻章或 column 横向翻页
- 字体/字号相关功能**已被本次精简移出**，如未来要重新引入需在 `feature-*.md` 单独记录

---

## 许可证

MIT
</
