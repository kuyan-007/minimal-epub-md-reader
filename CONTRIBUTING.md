# 贡献指南

感谢你考虑为本项目做贡献！

## 项目原则（必读）

**极简优先**：只做目录、背景、进度。**不引入**字体调节、书签、笔记、搜索、章节大纲等。

> 入口收缩 ≠ 极简。保留高频入口、丢弃低频操作；阅读不打扰、热键尽量静默。

新功能 PR 必须先回答一个问题：「这是否属于『看目录、换背景、继续读』三件事之一？」如果不是，请先在 issue 讨论。

## 提交 Issue

- **Bug 报告**：用 [Bug Report 模板](.github/ISSUE_TEMPLATE/bug_report.md)
- **功能请求**：用 [Feature Request 模板](.github/ISSUE_TEMPLATE/feature_request.md)
- 提交 bug 前请先搜索是否已有相同问题

## 提交 PR

1. Fork 仓库并创建分支：`git checkout -b feature/xxx` 或 `fix/xxx`
2. 改动后本地验证：
   - Rust 端：`cd src-tauri && cargo check`
   - 前端：`node --check src/main.js`
3. 提交 commit：
   - 主题行 50 字以内
   - 关键改动写正文「为什么」
4. Push 后开 PR，填写描述（关联 issue / 行为变化 / 截图）

## 开发约定

### Rust

- `src-tauri/src/` 不引入 `examples/` 以外的临时测试
- bookId 必须用 `canonicalize().to_ascii_lowercase()` 归一化（参考 `bugfix-bookid-canonicalization`）
- 后端状态更新必须 `emit` 事件，前端 `listen` 响应（参考 `bugfix-pendingfile-event-driven`）

### 前端

- 章节滚轮 / 焦点 / 输入绑到 `iframe.contentDocument`，不要绑主 doc
- 跨章节共享的可变变量放模块顶层，不要放 init 函数内 `let`
- 字体、颜色、间距都通过 CSS 变量走主题

### 文件命名

- 不要直接 commit `.epub` / `.exe` / `.zip`（`.gitignore` 已屏蔽）
- 新增图片请用现有 `src-tauri/icons/` 风格

## 内存中的项目历史

本项目所有 BUG 修复与设计决策记录在 `~/.pi/memory-md/极简EPUB阅读器/core/project/`，
索引见 `MEMORY.md`。这些是给 AI 助手读的项目历史，外部开发者也能浏览。

## 调试技巧

- 看进度：`%APPDATA%\com.minimal.epub.reader\progress.json`
- 静态检查：jsdom + Node 验证关键算法
- Rust 端：`cargo run --example test_epub -- <path-to-epub>`

## 行为准则

请保持友好与专业；不以人身攻击方式讨论技术分歧。
