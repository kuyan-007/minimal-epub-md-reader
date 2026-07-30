# 极简EPUB阅读器（Minimal EPUB Reader）

Windows 浮动文本窗式 EPUB 阅读器。极简到只有两件事：看目录、换背景。

## 功能

- **可隐藏的浮动文本窗**：无边框、可拖动、可调大小；按 `Esc` 或 `H` 隐藏到托盘
- **目录**：按 `T` 呼出；点击跳转；当前章节高亮
- **背景选择**：5 套预设（米黄/纯白/护眼绿/深灰/纯黑），按 `B` 循环切换
- **阅读进度自动保存**：重开同一本书自动续读
- **保持 EPUB 原格式**：图片、CSS、字体 100% 保留
- **双击 .epub 打开**：安装后自动关联文件类型

## 交互设计（阅读优先）

| 操作 | 方式 |
| ---- | ---- |
| 翻一页 | 滚轮（上下/横向皆可） 或 `←` / `→` 一屏 |
| 跨章节 | 在本章最末屏翻 → 或在首屏翻 ← |
| 隐藏窗口 | `Esc` 或托盘菜单 |
| 呼出 / 关闭目录 | 右键单击主区除浮层外的任意处 |
| 切换背景 | 点击右下齿轮按钮 |
| 章末自动续读 | 本章末屏停留 ≥ 3 秒 → 非末章则自动加载下一章 |

设计原则：默认隐藏所有键盘干扰，只保留 ←/→ 翻页与 Esc 隐藏。章节为原生纵向滚动，一屏 = 一页。滚轮每次跳一屏，键、滚都能翻。靠近左侧或点击中部呼出目录。末屏停留 3 秒自动续读，长篇阅读连乗。

## 编译与运行

环境要求：

- Rust 工具链（rustup + MSVC build tools）
- Node.js 18+（仅用于 Tauri CLI）
- Windows 10/11 + WebView2 Runtime（Win11 自带）

```bash
# 开发模式
npm install
npm run dev

# 打包发布（生成 NSIS 安装包）
npm run build
# 产物在 src-tauri/target/release/bundle/nsis/
```

## 项目结构

```
极简EPUB阅读器/
├── src-tauri/           # Rust 后端
│   ├── src/
│   │   ├── main.rs      # 入口
│   │   ├── lib.rs       # Tauri Builder、托盘、单实例
│   │   ├── epub.rs      # EPUB 解析（epub crate）
│   │   ├── store.rs     # 偏好与进度持久化
│   │   ├── commands.rs  # Tauri commands
│   │   └── examples/    # 临时测试
│   ├── capabilities/    # Tauri 权限
│   ├── icons/           # 应用图标
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                 # 前端（原生 HTML/CSS/JS，零框架）
│   ├── index.html
│   ├── style.css
│   └── main.js
├── scripts/gen-icons.js # 图标生成脚本
└── package.json
```

## 设计原则

- **极简优先**：只做目录 + 背景 + 进度（不做字体调节、书签、笔记等）
- **保持原格式**：用 `<iframe srcdoc>` 渲染章节，100% 保留 EPUB 自带样式
- **键盘优先**：所有功能都能用键盘操作
- **本地优先**：所有数据（进度、偏好）保存在 `%APPDATA%\com.minimal.epub.reader\`

## 数据存储位置

- 偏好：`%APPDATA%\com.minimal.epub.reader\preferences.json`
- 进度：`%APPDATA%\com.minimal.epub.reader\progress.json`
- EPUB 临时图片：`%TEMP%\minimal-epub-reader\<bookId>\`

## 许可证

MIT
