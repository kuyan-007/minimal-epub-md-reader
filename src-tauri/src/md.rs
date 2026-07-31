// md.rs - Markdown 解析，全文显示 + ## 锚点定位
// 用 pulldown-cmark Event API 转 HTML，所有内容在一个章节中连续显示
// 二级标题 (##) 生成带 id 的 <h2> 标签，供目录滚动定位
//
// v1.6 新增 KaTeX 公式渲染：
//   - 启 Options::ENABLE_MATH 后，$...$ / $$...$$ 产出 InlineMath/DisplayMath 事件
//   - 这两个事件不进入 push_html，转交给 katex-rs 渲染为 HTML
//   - 若检测到公式，章节 HTML 头部追加 KATEX_CSS（字体已内嵌为 data URI）
//   - KaTeX CSS 通过 include_str! 编入二进制，零运行时依赖

use katex::{render_to_string, KatexContext, Settings};
use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};
use pulldown_cmark::HeadingLevel;
use serde::Serialize;
use std::path::Path;

use crate::epub::TocNode;

/// KaTeX 全套 CSS（字体已内嵌为 base64 data URI）。
/// 由 scripts/inline-katex-css.js 从 node_modules/katex 生成。
/// 文件不存在时编译失败——避免运行时才发现。
const KATEX_CSS: &str = include_str!("../../src/katex-inline.css");

/// LaTeX 源码中的 HTML 特殊字符转义，用于公式渲染失败时的回退显示。
fn html_escape(s: &str) -> String {
	let mut out = String::with_capacity(s.len());
	for c in s.chars() {
		match c {
			'&' => out.push_str("&amp;"),
			'<' => out.push_str("&lt;"),
			'>' => out.push_str("&gt;"),
			'"' => out.push_str("&quot;"),
			'\'' => out.push_str("&#39;"),
			_ => out.push(c),
		}
	}
	out
}

#[derive(Debug, Serialize, Clone)]
pub struct MdChapter {
    pub index: usize,
    pub id: String,
    pub title: String,
    pub href: String,
    pub html: String,
    pub base_href: String,
    pub is_cover: bool,
}

#[derive(Debug, Serialize)]
pub struct MdBook {
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub chapters: Vec<MdChapter>,
    pub toc: Vec<TocNode>,
}

fn book_id_from_path(path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    path.to_string_lossy().to_ascii_lowercase().hash(&mut h);
    format!("{:016x}", h.finish())
}

pub fn open(path_str: &str) -> Result<MdBook, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(format!("文件不存在: {path_str}"));
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("读取失败: {e}"))?;
    let md_dir = path.parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".into());

    // 启用扩展选项：删除线、任务列表、脚注、表格、数学公式
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_MATH);
    let parser = Parser::new_ext(&content, opts);

    // KaTeX 上下文与设置：每个解析调用内复用同一 ctx（缓存字体/宏），
    // inline 与 display 各持一份 Settings（display_mode 是编译期常量之外的运行时差异）。
    let katex_ctx = KatexContext::default();
    let katex_inline = Settings::builder()
        .display_mode(false)
        .build();
    let katex_display = Settings::builder()
        .display_mode(true)
        .build();
    let mut has_math = false;

    let mut full_html = String::new();
    let mut toc: Vec<TocNode> = Vec::new();
    let mut event_buf: Vec<Event> = Vec::new();
    let mut in_h2 = false;
    let mut in_img = false;
    let mut h2_title_plain = String::new();
    let mut h2_title_events: Vec<Event> = Vec::new();
    let mut img_src = String::new();
    let mut img_title = String::new();
    let mut order = 0usize;

    // 把 event_buf 中的 events 转 HTML 追加到 target
    fn flush(events: &mut Vec<Event>, target: &mut String) {
        if !events.is_empty() {
            let evts = std::mem::take(events);
            html::push_html(target, evts.into_iter());
        }
    }

    for event in parser {
        // ---- H2 内部模式：收集标题 events ----
        if in_h2 {
            match &event {
                Event::Text(t) => {
                    h2_title_plain.push_str(t);
                    h2_title_events.push(event);
                    continue;
                }
                Event::End(TagEnd::Heading(_)) => {
                    // H2 结束 → 生成带 id 的 <h2> 标签
                    let mut inner_html = String::new();
                    let evts = std::mem::take(&mut h2_title_events);
                    html::push_html(&mut inner_html, evts.into_iter());
                    full_html.push_str(&format!(
                        "<h2 id=\"ch{}\">{}</h2>\n",
                        order,
                        inner_html
                    ));

                    let label = std::mem::take(&mut h2_title_plain);
                    toc.push(TocNode {
                        label: if label.is_empty() {
                            format!("第{}章", order + 1)
                        } else {
                            label
                        },
                        href: format!("#ch{}", order),
                        order,
                        level: 1,
                        children: vec![],
                    });
                    order += 1;
                    in_h2 = false;
                    continue;
                }
                _ => {
                    // 其他事件（粗体、代码等格式标签）
                    h2_title_events.push(event);
                    continue;
                }
            }
        }

        // ---- 正常模式（非 H2 内部） ----
        match &event {
            Event::Start(Tag::Heading { level, .. }) if *level == HeadingLevel::H2 => {
                // flush 之前的内容
                flush(&mut event_buf, &mut full_html);
                // 进入 H2 收集模式
                in_h2 = true;
                h2_title_plain.clear();
                h2_title_events.clear();
            }
            Event::Start(Tag::Image { link_type: _, dest_url, title, id: _ }) => {
                // 保存图片路径，此事件不进入 event_buf
                img_src = dest_url.to_string();
                img_title = title.to_string();
                in_img = true;
            }
            Event::End(TagEnd::Image) => {
                // 输出 wrapper div，后续由前端加载真正图片
                let src = std::mem::take(&mut img_src);
                if !src.is_empty() {
                    let t_a = if img_title.is_empty() {
                        String::new()
                    } else {
                        format!(
                            " title=\"{}\"",
                            img_title.replace('"', "&quot;")
                        )
                    };
                    full_html.push_str(&format!(
                        "<div class=\"md-image-wrapper\" data-src=\"{}\"><img src=\"\" alt=\"\"{}></div>\n",
                        src.replace('"', "&quot;"),
                        t_a,
                    ));
                }
                in_img = false;
            }
            Event::Text(_) if in_img => {
                // 图片 alt 文本：直接丢弃，避免作为普通文字显示
            }
            Event::InlineMath(tex) => {
                // 公式可能出现于段落中间，所以先 flush 之前的文本/格式事件
                flush(&mut event_buf, &mut full_html);
                let src = tex.to_string();
                match render_to_string(&katex_ctx, &src, &katex_inline) {
                    Ok(html) => full_html.push_str(&html),
                    Err(e) => {
                        // 渲染失败回退：在 <code> 里展示原始 LaTeX，title 透露错误原因
                        full_html.push_str(&format!(
                            "<code class=\"math-error math-inline\" title=\"{err}\">{src}</code>",
                            err = html_escape(&e.to_string()),
                            src = html_escape(&src),
                        ));
                    }
                }
                has_math = true;
            }
            Event::DisplayMath(tex) => {
                flush(&mut event_buf, &mut full_html);
                let src = tex.to_string();
                match render_to_string(&katex_ctx, &src, &katex_display) {
                    Ok(html) => full_html.push_str(&html),
                    Err(e) => {
                        full_html.push_str(&format!(
                            "<pre class=\"math-error\" title=\"{err}\">{src}</pre>",
                            err = html_escape(&e.to_string()),
                            src = html_escape(&src),
                        ));
                    }
                }
                has_math = true;
            }
            _ => {
                event_buf.push(event);
            }
        }
    }

    // flush 剩余内容
    flush(&mut event_buf, &mut full_html);

    // 若本章使用了公式，在章节 HTML 头部插入 KaTeX CSS（字体已 base64 内嵌）。
    // 浏览器允许 <style> 出现在 <body> 内，CSS 照样全局生效。
    if has_math {
        full_html = format!("<style>{}</style>\n", KATEX_CSS) + &full_html;
    }

    // 全文都没有 H2 分割时，添加一个默认目录项
    if toc.is_empty() && !full_html.trim().is_empty() {
        toc.push(TocNode {
            label: "正文".into(),
            href: "#".into(),
            order: 0,
            level: 1,
            children: vec![],
        });
    }

    // 全文作为单一章节
    let chapter = MdChapter {
        index: 0,
        id: "full".into(),
        title: title.clone(),
        href: "#".into(),
        html: full_html,
        base_href: md_dir,
        is_cover: false,
    };

    Ok(MdBook {
        book_id: book_id_from_path(path),
        title,
        author: String::new(),
        chapters: vec![chapter],
        toc,
    })
}
