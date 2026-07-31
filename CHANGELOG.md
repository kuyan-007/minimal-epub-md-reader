# Changelog

本项目的所有显著变更记录于此。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **MD 公式渲染**：接入 `katex-rs` v0.2.4，pulldown-cmark 启 `ENABLE_MATH` 后拦截 `InlineMath` / `DisplayMath` 事件 → katex 渲染为 HTML。检测到公式才在章节 HTML 头部插入 KaTeX CSS（20 个 woff2 字体已 base64 内嵌为 data URI，零运行时资源依赖）
- **语法覆盖**：`$...$` / `$$...$$` 行内与块级 LaTeX。常见矩阵、积分、求和、希腊字母、化学式均可
- **错误回退**：渲染失败的 LaTeX 回退为 `<code class="math-error">`，hover 看 title 里的错误原因
- **离线零依赖**：KaTeX CSS + 字体通过 `include_str!` 编入二进制，SSR 渲染不需 JS
- **`scripts/inline-katex-css.js`**：从 `node_modules/katex/dist/` 生成 `src/katex-inline.css`，`npm run katex-css` 可手动重跑，prebuild 钩子自动跑

### 依赖

- Rust: `katex-rs = "0.2"`（+ 传递依赖 `katex`、`bon`、`strum` 等）
- npm: `katex`（dev，仅构建期生成 CSS 使用）

### 文档

- 重写 README.md：完整复盘项目技术架构、已修复 BUG 横向教训、设计原则 Code Review Checklist
- 新增 CONTRIBUTING.md：贡献指南 + 极简原则
- 新增 LICENSE：MIT 协议
- 新增 GitHub Actions：CI（PR 编译检查）+ Release（tag 自动出 NSIS）

## [1.2] - 2026-07-30

### 新增

- **拖入文件自动打开**：Rust 端抓 `WindowEvent::DragDrop` 复用 `enqueue_pending_file`
- **Markdown 全文阅读**：`md.rs` 解析 + `##` 二级标题生成目录锚点
- **MD 内嵌图片**：本地图片读取 → data URL 注入 iframe
- **Ctrl+滚轮缩放字号**：10–32px 范围，2px 步长
- **字体切换**：默认 / 楷体 / 宋体 / 雅黑 4 套预设，状态持久化
- **末屏停留 3 秒自动续读**：翻章体验连乗
- **右键单击 / 边缘 hover 呼出目录**：mousedown→mouseup 距离 ≤5px 判定

### 修复

- bookId 不稳定 → `canonicalize().to_ascii_lowercase()` 归一化
- TOC 点击全部跳第 1 章 → href 归一化映射到 filtered 章节索引
- 单实例 / 文件关联 / 拖入新文件不打开 → emit `open-epub` 事件驱动
- 窗口最小化时 single-instance 不唤醒 → `show + unminimize + setFocus` 三连
- iframe 内滚轮翻章失效 → 绑 `iframe.contentDocument`
- 目录入口收得过窄（4px / 800ms）→ 60px / 250ms + 主区域 click 入口

### 重构

- 阅读优先交互：移除多余热键（T / B / PageUp / PageDown 等）
- 翻页 v3：纵向原生滚动 + 一滚一屏（v1 wheel 翻章 / v2 column 横向 → v3 稳定）

## [1.0] - 2026-07-29

### 新增

- **基础 EPUB 阅读**：解析 + 章节渲染 + 进度保存
- **目录 / 背景切换 / 进度续读** 三件核心
- **托盘 + 单实例 + 文件关联**
- **5 套背景预设**：米黄 / 纯白 / 护眼绿 / 深灰 / 纯黑（v1.2 减为 4 套）
- **iframe srcdoc 渲染**：保留 EPUB 原格式
- **NSIS 安装包**：自动关联 .epub / .md 文件类型
