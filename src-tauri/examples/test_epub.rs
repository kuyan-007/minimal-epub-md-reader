// 临时测试：解析 EPUB 并打印摘要
// 运行：cargo run --example test_epub -- <path-to-epub>

use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: test_epub <epub-file>");
        std::process::exit(1);
    }
    let path = &args[1];
    println!("Opening: {path}");
    match minimal_epub_reader_lib::epub::open(path) {
        Ok(book) => {
            println!("Title: {}", book.title);
            println!("Author: {}", book.author);
            println!("Chapters: {}", book.chapters.len());
            for (i, c) in book.chapters.iter().take(3).enumerate() {
                println!(
                    "  [{}] {} ({} chars, base={})",
                    i,
                    c.title,
                    c.html.len(),
                    c.base_href
                );
            }
            if book.chapters.len() > 3 {
                println!("  ... and {} more", book.chapters.len() - 3);
            }
            println!("TOC entries: {}", book.toc.len());
            for t in book.toc.iter().take(5) {
                println!("  TOC[{}] {} -> {}", t.level, t.label, t.href);
            }
            let css = minimal_epub_reader_lib::epub::collect_all_css(path);
            println!("CSS size: {} bytes", css.len());
        }
        Err(e) => {
            eprintln!("ERROR: {e}");
            std::process::exit(2);
        }
    }
}