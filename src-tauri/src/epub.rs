// epub.rs - EPUB 解析与资源提取
//
// 设计：
//   open_epub(path) 时一次性解析全部章节内容、资源清单、目录树，
//   返回给前端保存。前端用 iframe srcdoc 渲染章节以保留 EPUB 原格式。
//   get_resource(book_id, path) 按需读取 EPUB 内的图片等资源，
//   每次调用都会重新打开 EPUB 文件（epub crate 的 EpubDoc<File> 非 Send）。

use epub::doc::{EpubDoc, NavPoint};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct BookInfo {
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub chapters: Vec<ChapterInfo>,
    pub toc: Vec<TocNode>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInfo {
    pub index: usize,
    pub id: String,
    pub title: String,
    pub href: String,
    pub html: String,
    pub base_href: String,
    pub is_cover: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct TocNode {
    pub label: String,
    pub href: String,
    pub order: usize,
    pub level: u32,
    pub children: Vec<TocNode>,
}

/// 用规范化路径生成稳定 bookId（hash）。
///
/// 同一本书在以下场景应识别为同一本：
///   1. 拖到 exe：explorer 给的是完整绝对路径
///   2. 关联双击：同上
///   3. CLI 传递相对路径：例如 `从变身少女开始斩妖除魔.epub`
///   4. 在 app 中设置 PendingFile 后再重新 take：路径不变但已经被多次依赖
/// 这里统一用 canonicalize（如果存在），失败回退原始路径。
/// Windows 上的盘符大小写不敏感，比较前统一小写。
fn book_id_from_path(path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let key = canonical.to_string_lossy().to_ascii_lowercase();
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// 推断章节标题（从 XHTML 中的 h1/h2/h3 或 <title>，否则用文件名）
fn infer_chapter_title(html: &str, fallback: &str) -> String {
    // 极简正则匹配：<h1>...<h2>...<h3> 取最靠前的；没有则用 fallback
    let lower = html.to_ascii_lowercase();
    for tag in ["h1", "h2", "h3"].iter() {
        if let Some(start) = lower.find(&format!("<{}", tag)) {
            if let Some(gt) = lower[start..].find('>') {
                let body_start = start + gt + 1;
                if let Some(end_rel) = lower[body_start..].find(&format!("</{}", tag)) {
                    let body = &html[body_start..body_start + end_rel];
                    let text = strip_tags(body);
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return trimmed.chars().take(80).collect();
                    }
                }
            }
        }
    }
    fallback.to_string()
}

/// 判断是否属于目录性质的资源（nav.xhtml / toc.ncx / nav.xht 等）
fn is_toc_resource(path: &Path, id: &str) -> bool {
    let p = path.to_string_lossy().to_ascii_lowercase();
    let id_lc = id.to_ascii_lowercase();
    p.ends_with("nav.xhtml")
        || p.ends_with("nav.xht")
        || p.ends_with("toc.ncx")
        || p.ends_with("/nav")
        || p.ends_with("/toc")
        || id_lc == "nav"
        || id_lc == "ncx"
        || id_lc == "toc"
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn nav_to_toc(nodes: &[NavPoint], level: u32, href_map: &HashMap<String, usize>) -> Vec<TocNode> {
    nodes
        .iter()
        .map(|n| {
            let href = n.content.to_string_lossy().to_string();
            // 跨平台归一化：EPUB 内 nav.xhtml / toc.ncx 里的 href 在 Windows
            // 反斜杠，前端的 chapter.href 来自 spine 也是反斜杠。两边都换成
            // 正斜杠 + 小写后做精确匹配；若匹配不到则取最后一个 fallback 的 0，
            // 前端拿到 0 会安全地忽略。
            let normalized = href.replace('\\', "/").to_ascii_lowercase();
            let order = href_map.get(&normalized).copied().unwrap_or(0);
            TocNode {
                label: n.label.clone(),
                href,
                order,
                level,
                children: nav_to_toc(&n.children, level + 1, href_map),
            }
        })
        .collect()
}

/// 解析整个 EPUB，返回 BookInfo
pub fn open(path_str: &str) -> Result<BookInfo, String> {
    let path = PathBuf::from(path_str);
    if !path.exists() {
        return Err(format!("文件不存在: {}", path_str));
    }

    let mut doc = EpubDoc::new(&path).map_err(|e| format!("打开 EPUB 失败: {e}"))?;

    // 获取封面图片路径，用于判断哪些章节是封面页
    let cover_path = doc.get_cover_id().and_then(|id| {
        doc.resources.get(&id).map(|r| r.path.clone())
    });

    let title = doc.get_title().unwrap_or_else(|| {
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "未知标题".into())
    });
    let author = doc
        .mdata("creator")
        .map(|m| m.value.clone())
        .or_else(|| doc.mdata("author").map(|m| m.value.clone()))
        .unwrap_or_default();

    // 提取所有章节（先收 raw，最后过滤掉目录页再重新分配 index）
    let total = doc.get_num_chapters();
    let mut raw: Vec<(String, PathBuf, String)> = Vec::with_capacity(total);
    for i in 0..total {
        doc.set_current_chapter(i);
        let (html, _mime) = doc
            .get_current_str()
            .ok_or_else(|| format!("读取章节 {i} 失败"))?;
        let current_path = doc.get_current_path().unwrap_or_default();
        let current_id = doc.get_current_id().unwrap_or_default();
        raw.push((html, current_path, current_id));
    }

    // 过滤掉 nav.xhtml / toc.ncx 等目录页（spine 里的目录不应该当正文）
    let mut chapters: Vec<ChapterInfo> = Vec::with_capacity(raw.len());
    for (html, current_path, current_id) in raw {
        if is_toc_resource(&current_path, &current_id) {
            continue;
        }
        let title_inferred =
            infer_chapter_title(&html, &format!("第 {} 章", chapters.len() + 1));
        let base_href = current_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        chapters.push(ChapterInfo {
            index: chapters.len(),
            id: current_id,
            title: title_inferred,
            href: current_path.to_string_lossy().to_string(),
            html: html.clone(),
            base_href,
            is_cover: cover_path.as_ref().is_some_and(|cp| {
                let cp_str = cp.to_string_lossy().to_ascii_lowercase();
                html.to_ascii_lowercase().contains(&cp_str)
            }),
        });
    }

    // 提取目录（NCX / nav.xhtml）
    // order 字段必须指向「过滤后的章节索引」而不是 NCX playOrder：
    //   1) 部分 EPUB（特别是 nav.xhtml，而非 toc.ncx）会让 NavPoint::play_order
    //      全部为 None，此时 .unwrap_or(0) 会让所有目录项都指向第 1 章。
    //   2) 即便 playOrder 有值，也跟 spine 序号、过滤后的索引没有必然对应关系。
    // 我们改用 href 归一化匹配，把它映射到 filtered chapters 的索引。
    let mut href_map: HashMap<String, usize> = HashMap::with_capacity(chapters.len());
    for (idx, c) in chapters.iter().enumerate() {
        let key = c.href.replace('\\', "/").to_ascii_lowercase();
        // 如果出现重复 href，保留首个（后续同名章节无法跳转，但不会闪退）
        href_map.entry(key).or_insert(idx);
    }
    let toc = nav_to_toc(&doc.toc, 1, &href_map);

    Ok(BookInfo {
        book_id: book_id_from_path(&path),
        title,
        author,
        chapters,
        toc,
    })
}

/// 读取 EPUB 内的资源（图片、字体、CSS 等），按 path 查找
pub fn read_resource(path_str: &str, resource_path: &str) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path_str);
    let mut doc = EpubDoc::new(&path).map_err(|e| format!("打开 EPUB 失败: {e}"))?;

    // 1. 按资源 id 找
    let normalized = resource_path.trim_start_matches('/');
    if let Some(bytes) = doc.get_resource(normalized).map(|(b, _)| b) {
        return Ok(bytes);
    }

    // 2. 按 path 找
    let as_path = Path::new(normalized);
    if let Some(bytes) = doc.get_resource_by_path(as_path) {
        return Ok(bytes);
    }

    // 3. EPUB 内的路径可能是相对的（如 ../Images/cover.jpg），
    //    试一下用文件名匹配
    if let Some(file_name) = Path::new(normalized).file_name() {
        // 先收集候选 id（避免在不可变借用上调用可变方法）
        let mut candidates: Vec<String> = Vec::new();
        for (id, item) in doc.resources.iter() {
            if item.path.file_name() == Some(file_name) {
                candidates.push(id.clone());
            }
        }
        for id in candidates {
            if let Some(bytes) = doc.get_resource(&id).map(|(b, _)| b) {
                return Ok(bytes);
            }
        }
    }

    Err(format!("资源未找到: {resource_path}"))
}

/// 读取 EPUB 内 CSS 资源（按路径），返回字符串
pub fn read_resource_str(path_str: &str, resource_path: &str) -> Result<String, String> {
    let bytes = read_resource(path_str, resource_path)?;
    String::from_utf8(bytes).map_err(|e| format!("资源不是 UTF-8: {e}"))
}

/// 把图片类资源写入临时目录，返回绝对路径，供前端用 file:// 引用
pub fn extract_image_to_temp(
    book_id: &str,
    src: &str,
    epub_path: &str,
) -> Result<String, String> {
    let bytes = read_resource(epub_path, src)?;

    // 推断扩展名
    let ext = Path::new(src)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("bin")
        .to_lowercase();

    let temp_root = std::env::temp_dir().join("minimal-epub-reader").join(book_id);
    fs::create_dir_all(&temp_root).map_err(|e| format!("创建临时目录失败: {e}"))?;

    // 用 src 路径的 hash 做文件名，避免冲突
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    src.hash(&mut h);
    let file_name = format!("{:016x}.{}", h.finish(), ext);
    let dest = temp_root.join(&file_name);
    fs::write(&dest, &bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

/// 收集一本书的所有 CSS 内容（拼接为一个字符串），注入到每个章节的 srcdoc 头部
pub fn collect_all_css(epub_path: &str) -> String {
    let mut doc = match EpubDoc::new(epub_path) {
        Ok(d) => d,
        Err(_) => return String::new(),
    };
    // 1) 先收集所有 CSS 资源的 id
    let mut css_ids: Vec<String> = Vec::new();
    for (id, item) in doc.resources.iter() {
        let mime = &item.mime;
        let path_str = item.path.to_string_lossy();
        let is_css = mime.contains("css")
            || id.ends_with(".css")
            || path_str.ends_with(".css");
        if is_css {
            css_ids.push(id.clone());
        }
    }
    // 2) 再逐个读取内容
    let mut css = String::new();
    for id in css_ids {
        if let Some((text, _)) = doc.get_resource_str(&id) {
            css.push_str("/* ");
            css.push_str(&id);
            css.push_str(" */\n");
            css.push_str(&text);
            css.push('\n');
        }
    }
    css
}

/// 列举所有图片资源（src 路径）
pub fn list_image_resources(epub_path: &str) -> HashMap<String, String> {
    let Ok(doc) = EpubDoc::new(epub_path) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for (id, item) in doc.resources.iter() {
        if item.mime.starts_with("image/") {
            map.insert(
                id.clone(),
                item.path.to_string_lossy().to_string(),
            );
        }
    }
    map
}