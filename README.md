# 极简EPUB/MD阅读器（Minimal EPUB-MD Reader）

> Windows 浮动文本窗式阅读器，只做三件事：**看目录、换背景、继续读**。

极简到没有字体调节面板、没有书签、没有笔记、没有搜索框——因为这些都是「读者分心的入口」而非「读不下去的根因」。

---

## 一句话原则

**入口收缩 ≠ 极简**。保留高频入口、丢弃低频操作；阅读不打扰、热键尽量静默。

---

## 特色

- **双格式**：原生支持 EPUB（用 `epub` crate 解析）与 Markdown（用 `pulldown-cmark`）
- **100% 保留原格式**：章节用 `<iframe srcdoc>` 渲染，EPUB 自带的 CSS / 图片 / 字体原样呈现
- **MD 公式渲染**：服务端接入 KaTeX，`$...$` / `$$...$$` 行内与块级 LaTeX 直接渲染；CSS + 20 个字体编译进二进制，零运行时资源依赖
- **5 套背景主题**：米黄 / 纯白 / 护眼绿 / 深灰 / 纯黑（AMOLED 友好），CSS 变量驱动，秒切
- **4 套字体预设**：默认思源宋体 / 霞鹜文楷 / 思源黑体 / 微软雅黑，仅作用于 MD 章节
- **三路径统一入口**：双击文件 / 单实例唤起 / 拖入窗口，最终都走同一个 `enqueue_pending_file`
- **进度自动续读**：滚动停止 1.5s 后落盘到 `%APPDATA%`，任何方式打开同一本书都接得上
- **单实例 + 系统托盘**：常驻后台，Esc 隐藏到托盘
- **NSIS 安装包**：自动关联 `.epub` / `.md`，双击即可打开

---

## 功能与交互

### 阅读主交互

| 操作 | 方式 |
| --- | --- |
| 翻页 | 滚轮（一滚一屏） / `←` `→` |
| 切章 | 右键主区域 → 目录点击；或主区域边缘 hover（60px / 250ms） |
| 缩放字号 | `Ctrl` + 滚轮（10–32px，2px 步长） |
| 切换背景 | 右下角 `●` 按钮，5 套循环 |
| 切换字体 | 右下角 `文` 按钮，4 套循环（仅 MD 模式） |
| 隐藏窗口 | `Esc` |
| 最大化 / 恢复 | 双击窗口任意位置 |
| 退出 | 托盘菜单 |

### 打开书（三条路径）

| 路径 | 触发 |
| --- | --- |
| **关联双击** | 安装后双击 `.epub` 或 `.md` 文件 |
| **单实例唤起** | 应用已开，再次双击或拖到 exe 上 |
| **拖入窗口** | 把文件拖到已打开的应用窗口 |

三条路径最终都通过 `open-epub` 事件驱动前端重新打开，保证 bookId 与事件 100% 一致。

### 阅读优先（不要加回）

下面这些是早期版本出现过、后来主动砍掉的低频入口：

- `T` / `Ctrl+T` 呼出目录 → 右键 + 边缘 hover 已覆盖
- `B` / `Ctrl+B` 切换背景 → 右下按钮已覆盖
- `H` 隐藏窗口 → `Esc` 更顺手
- `↑` / `↓` / `PageUp` / `PageDown` / `Space` 翻章 → 一滚一屏已覆盖

---

## 技术架构

### 后端（Rust / Tauri v2）

```
src-tauri/src/
├── main.rs          # 入口
├── lib.rs           # Tauri Builder：托盘 + 单实例 + 窗口事件
├── commands.rs      # Tauri commands + PendingFile 状态
├── epub.rs          # EPUB 解析（epub crate）
├── md.rs            # Markdown 解析（pulldown-cmark + katex-rs）
└── store.rs         # 偏好 / 进度 JSON 持久化
```

**关键依赖**：`tauri` 2.x · `tauri-plugin-single-instance` · `tauri-plugin-fs` · `epub` 2.1.5 · `pulldown-cmark` 0.13 · `katex-rs` 0.2 · `serde` · `base64`

### 前端（原生 HTML / CSS / JS，零框架）

```
src/
├── index.html       # 入口 + UI 骨架
├── main.js          # 全部交互逻辑
└── style.css        # 5 套主题 + KaTeX CSS 注入点
```

**关键设计**：章节用 `<iframe sandbox="allow-same-origin" srcdoc>` 渲染，CSS 变量驱动主题；主 doc 计算完变量后注入 iframe `:root` 桥接（CSS 变量不跨 iframe 继承）。

### 数据存储

| 数据 | 路径 |
| --- | --- |
| 阅读偏好 | `%APPDATA%\com.minimal.epub.reader\preferences.json` |
| 全书进度 | `%APPDATA%\com.minimal.epub.reader\progress.json` |

bookId 由 `canonicalize().to_ascii_lowercase() → hash` 生成，保证同一本书在不同路径表示下稳定。

---

## 使用方法

### 安装

下载 `极简EPUB MD 阅读器_0.1.0_x64-setup.exe`（NSIS 安装包），双击安装。安装时自动关联 `.epub` / `.md` 文件类型。

或者直接运行 `minimal-epub-reader_vX.X.exe`（裸 exe，要求系统已装 WebView2 Runtime，Win11 自带）。

### 第一次打开一本书

三种方式任选其一：

1. **双击** 已关联的 `.epub` / `.md` 文件
2. **拖入** 文件到已打开的窗口
3. 在**托盘菜单**点「显示」后从文件管理器拖入

### 切换背景 / 字体

点击窗口右下角两个小按钮：

- `●` 背景：米黄 → 纯白 → 护眼绿 → 深灰 → 纯黑 → 米黄 ...
- `文` 字体：默认 → 霞鹜文楷 → 思源黑体 → 微软雅黑 → 默认 ...

选择自动保存，下次启动自动恢复。

---

## 编译

### 环境要求

- Rust 工具链（rustup + MSVC build tools，Rust 1.77+）
- Node.js 18+（仅用于 Tauri CLI）
- Windows 10/11 + WebView2 Runtime（Win11 自带）
- `katex` npm 包（构建期生成内嵌 CSS 用，prebuild 钩子自动跑）

### 命令

```bash
# 安装 npm 依赖（首次或换机器时）
npm install

# 开发模式（热重载）
npm run dev

# 打包发布：生成裸 exe + NSIS 安装包
npm run build

# 产物位置
#   裸 exe:  src-tauri/target/release/minimal-epub-reader.exe
#   NSIS:    src-tauri/target/release/bundle/nsis/*.exe
```

---

## 设计原则（Code Review Checklist）

新功能 PR 提交前逐条核对：

- [ ] **极简优先**：是否属于「看目录、换背景、继续读」三件事之一？不是 → 拒
- [ ] **保留高频入口**：入口收缩不等于切断用户可达路径
- [ ] **100% 保留原格式**：章节必须用 iframe srcdoc 渲染，不能 innerHTML
- [ ] **键盘优先**：所有功能都能用键盘操作
- [ ] **本地优先**：数据全在 `%APPDATA%`，不引入云端依赖
- [ ] **路径归一化**：所有 bookId / 资源路径必须 `canonicalize + lowercase + /` 归一化
- [ ] **事件驱动**：后端状态更新必须 `emit` 事件，前端 `listen` 响应
- [ ] **窗口三连**：`show` + `unminimize` + `setFocus` 必须三连
- [ ] **状态归顶层**：跨章节共享的可变变量不能藏在 init 函数内
- [ ] **iframe 内事件绑 `contentDocument`**：wheel / scroll / click / dblclick 都不能绑主 doc
- [ ] **CSS 变量走主题**：颜色 / 间距 / 字号通过 CSS 变量切换，不要 hardcode 颜色字面量

---

## 许可证

MIT
