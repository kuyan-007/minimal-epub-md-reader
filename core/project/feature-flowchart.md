# MD 流程图

- 现象：`mermaid` 代码块原本只显示源代码，不能阅读流程图。
- 根因与代码：`src-tauri/src/md.rs` 将代码块按普通 Markdown 转 HTML；`src/main.js` 的章节 iframe 禁止脚本运行。
- 修复：`src/flowchart.mjs` 在主页面解析 `flowchart TD/TB/LR` 的常见节点、判断框、分支和箭头，生成 SVG 后替换 MD 章节中的对应代码块；不支持的语法保留源码。
- 验证：`node scripts/test-flowchart.mjs`、`node --check src/main.js`、`node --check src/flowchart.mjs` 通过。
- 结论：流程图在离线环境中渲染，章节 iframe 仍无需运行脚本。
