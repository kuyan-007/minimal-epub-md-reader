// scripts/inline-katex-css.js
// 把 node_modules/katex/dist/katex.min.css 里所有 url(fonts/*.woff2)
// 替换为 base64 data URI，输出 src/katex-inline.css。
// 目的：KaTeX 公式渲染完全离线，零外部资源依赖。
//
// 故意只内嵌 woff2（最小、webview2 全支持），去掉 .woff/.ttf 回退。
// 这样 CSS 体积从 ~1.6MB（三种格式全内嵌）压到 ~400KB。

const fs = require("fs");
const path = require("path");

const KATEX_DIST = path.join(__dirname, "..", "node_modules", "katex", "dist");
const CSS_SRC = path.join(KATEX_DIST, "katex.min.css");
const FONTS_DIR = path.join(KATEX_DIST, "fonts");
const CSS_OUT = path.join(__dirname, "..", "src", "katex-inline.css");

function mimeFor(ext) {
	if (ext === "woff2") return "font/woff2";
	if (ext === "woff") return "font/woff";
	if (ext === "ttf") return "font/truetype";
	return "application/octet-stream";
}

function inlineFonts(css) {
	// 匹配 url(fonts/...) 三种引号形式 + 无引号
	const re = /url\(\s*(["']?)fonts\/([^)"'\s]+)\1\s*\)/g;
	return css.replace(re, (match, quote, fontPath) => {
		const abs = path.join(FONTS_DIR, fontPath);
		if (!fs.existsSync(abs)) {
			console.warn(`  [skip] missing font: ${fontPath}`);
			return match;
		}
		const ext = path.extname(fontPath).slice(1);
		// 只内嵌 woff2；woff/ttf 直接删掉这条 url()，减体积
		if (ext !== "woff2") {
			return ""; // 整个 url(...) 干掉
		}
		const b64 = fs.readFileSync(abs).toString("base64");
		return `url(data:${mimeFor(ext)};base64,${b64})`;
	});
}

function main() {
	if (!fs.existsSync(CSS_SRC)) {
		console.error(`KaTeX CSS not found: ${CSS_SRC}\n请先 npm install katex`);
		process.exit(1);
	}
	if (!fs.existsSync(FONTS_DIR)) {
		console.error(`KaTeX fonts dir not found: ${FONTS_DIR}`);
		process.exit(1);
	}

	let css = fs.readFileSync(CSS_SRC, "utf8");
	const before = css.length;
	css = inlineFonts(css);
	const after = css.length;

	fs.mkdirSync(path.dirname(CSS_OUT), { recursive: true });
	fs.writeFileSync(CSS_OUT, css);

	const kb = (after / 1024).toFixed(1);
	console.log(
		`✓ KaTeX CSS inlined → ${path.relative(process.cwd(), CSS_OUT)} (${kb} KB, ${before}→${after} bytes)`,
	);
}

main();
