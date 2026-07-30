// 临时测试：列举图片资源并提取一张到 temp
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: test_resource <epub-file>");
        std::process::exit(1);
    }
    let path = &args[1];
    let resources = minimal_epub_reader_lib::epub::list_image_resources(path);
    println!("Image resources: {}", resources.len());
    for (i, (id, p)) in resources.iter().take(5).enumerate() {
        println!("  [{}] id={} path={}", i, id, p);
    }
    if let Some((first_id, first_path)) = resources.iter().next() {
        println!("\nExtracting first: id={} path={}", first_id, first_path);
        let book_id = "test_book";
        match minimal_epub_reader_lib::epub::extract_image_to_temp(
            book_id,
            first_path,
            path,
        ) {
            Ok(p) => println!("OK -> {}", p),
            Err(e) => println!("FAIL: {}", e),
        }
    }
}