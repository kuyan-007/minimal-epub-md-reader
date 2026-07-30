// generate-icons.js - 生成 EUBP 和 MD 格式专属图标
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ICONS_DIR = path.join(__dirname, "src-tauri", "icons");

/**
 * 创建一个带字母标识的 PNG 图像
 * @param {number} size 边长
 * @param {{r,g,b}} bgColor 背景色
 * @param {string} letter 字母标识 ("E" / "M")
 * @param {{r,g,b}} letterColor 字母颜色
 */
function createIcon(size, bgColor, letter, letterColor) {
	const png = new PNG({ width: size, height: size });
	const cx = size / 2;
	const cy = size / 2;
	const radius = size * 0.42;

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const idx = (y * size + x) * 4;
			const dx = x - cx + 0.5;
			const dy = y - cy + 0.5;
			const dist = Math.sqrt(dx * dx + dy * dy);

			// 圆角矩形抗锯齿
			let inside = 0;
			const rx = Math.abs(dx);
			const ry = Math.abs(dy);
			const cornerDist = Math.sqrt(
				Math.max(0, rx - radius + size * 0.08) ** 2 +
					Math.max(0, ry - radius + size * 0.08) ** 2,
			);
			const cornerR = size * 0.08;
			if (rx < radius - cornerR && ry < radius - cornerR) {
				inside = 1;
			} else if (rx > radius || ry > radius) {
				inside = 0;
			} else {
				inside = Math.max(
					0,
					Math.min(1, 1 - (cornerDist - cornerR * 0.5) / cornerR),
				);
			}

			if (inside <= 0) {
				png.data[idx] = 0;
				png.data[idx + 1] = 0;
				png.data[idx + 2] = 0;
				png.data[idx + 3] = 0;
				continue;
			}

			// 背景渐变（上到下微渐变）
			const grad = 0.92 + 0.08 * (y / size);
			png.data[idx] = Math.round(bgColor.r * grad);
			png.data[idx + 1] = Math.round(bgColor.g * grad);
			png.data[idx + 2] = Math.round(bgColor.b * grad);
			png.data[idx + 3] = Math.round(255 * inside);
		}
	}

	// 绘制字母（用简单的像素映射）
	const fontSize = Math.max(6, Math.round(size * 0.55));
	const letterMap = getLetterMap(letter, fontSize);
	const letterW = letterMap[0].length;
	const letterH = letterMap.length;
	const offsetX = Math.round((size - letterW) / 2);
	const offsetY = Math.round((size - letterH) / 2) + 1;

	for (let ly = 0; ly < letterH; ly++) {
		for (let lx = 0; lx < letterW; lx++) {
			if (letterMap[ly][lx]) {
				const px = offsetX + lx;
				const py = offsetY + ly;
				if (px >= 0 && px < size && py >= 0 && py < size) {
					const idx = (py * size + px) * 4;
					// 字母用白色，半透明边缘
					const alpha = letterMap[ly][lx];
					const bgAlpha = png.data[idx + 3] / 255;
					png.data[idx] = Math.round(
						letterColor.r * alpha + bgColor.r * (1 - alpha),
					);
					png.data[idx + 1] = Math.round(
						letterColor.g * alpha + bgColor.g * (1 - alpha),
					);
					png.data[idx + 2] = Math.round(
						letterColor.b * alpha + bgColor.b * (1 - alpha),
					);
					png.data[idx + 3] = Math.round(255 * bgAlpha);
				}
			}
		}
	}

	return PNG.sync.write(png);
}

/**
 * 获取字母的像素映射（抗锯齿）
 */
function getLetterMap(letter, fontSize) {
	// 7x9 比例缩放
	const baseSize = 10;
	const scale = fontSize / baseSize;

	// 字母 E 的 7x9 位图（1=实心, 0.5=半透明边缘）
	const letterE = [
		[0, 1, 1, 1, 1, 1, 1],
		[0, 1, 0, 0, 0, 0, 0],
		[0, 1, 0, 0, 0, 0, 0],
		[0, 1, 1, 1, 1, 0, 0],
		[0, 1, 0, 0, 0, 0, 0],
		[0, 1, 0, 0, 0, 0, 0],
		[0, 1, 0, 0, 0, 0, 0],
		[0, 1, 1, 1, 1, 1, 1],
		[0, 0, 0, 0, 0, 0, 0],
	];

	// 字母 M 的 7x9 位图
	const letterM = [
		[1, 0, 0, 0, 0, 0, 1],
		[1, 1, 0, 0, 0, 1, 1],
		[1, 0, 1, 0, 1, 0, 1],
		[1, 0, 0, 1, 0, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[0, 0, 0, 0, 0, 0, 0],
	];

	const src = letter === "E" ? letterE : letterM;
	const dstW = Math.round(7 * scale);
	const dstH = Math.round(9 * scale);
	const result = Array.from({ length: dstH }, () => Array(dstW).fill(0));

	for (let dy = 0; dy < dstH; dy++) {
		for (let dx = 0; dx < dstW; dx++) {
			// 双线性插值
			const sx = (dx / dstW) * 7;
			const sy = (dy / dstH) * 9;
			const ix = Math.floor(sx);
			const iy = Math.floor(sy);
			const fx = sx - ix;
			const fy = sy - iy;
			const ix1 = Math.min(ix + 1, 6);
			const iy1 = Math.min(iy + 1, 7);
			const v =
				src[iy][ix] * (1 - fx) * (1 - fy) +
				src[iy][ix1] * fx * (1 - fy) +
				src[iy1][ix] * (1 - fx) * fy +
				src[iy1][ix1] * fx * fy;
			result[dy][dx] = Math.max(0, Math.min(1, v));
		}
	}
	return result;
}

/**
 * 将 PNG 数据包装成 ICO 文件
 */
function pngToIco(pngBuffer) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: ICO
	header.writeUInt16LE(1, 4); // count: 1 image

	// 从 PNG 获取尺寸
	const width = pngBuffer.readUInt32BE(16); // IHDR width
	const height = pngBuffer.readUInt32BE(20); // IHDR height

	const entry = Buffer.alloc(16);
	entry.writeUInt8(width === 256 ? 0 : width, 0); // width (0=256)
	entry.writeUInt8(height === 256 ? 0 : height, 1); // height (0=256)
	entry.writeUInt8(0, 2); // colors
	entry.writeUInt8(0, 3); // reserved
	entry.writeUInt16LE(1, 4); // planes
	entry.writeUInt16LE(32, 6); // bpp
	entry.writeUInt32LE(pngBuffer.length, 8); // image size
	entry.writeUInt32LE(22, 12); // offset (header + entry)

	return Buffer.concat([header, entry, pngBuffer]);
}

// ---- 主流程 ----
const SIZES = [32, 64, 128, 256];

// EPUB: 深蓝色 (#5B4B8A→#4A3B78)
const epubBg = { r: 0x5b, g: 0x4b, b: 0x8a };
const epubLetter = { r: 0xff, g: 0xff, b: 0xff };

// MD: 翠绿色 (#3B8A5B→#2B7A4B)
const mdBg = { r: 0x3b, g: 0x8a, b: 0x5b };
const mdLetter = { r: 0xff, g: 0xff, b: 0xff };

async function main() {
	// 生成 PNG 文件
	for (const size of SIZES) {
		// EPUB
		const epubPng = createIcon(size, epubBg, "E", epubLetter);
		fs.writeFileSync(path.join(ICONS_DIR, `epub-${size}x${size}.png`), epubPng);

		// MD
		const mdPng = createIcon(size, mdBg, "M", mdLetter);
		fs.writeFileSync(path.join(ICONS_DIR, `md-${size}x${size}.png`), mdPng);
	}

	// 生成 256x256 主 PNG（用 EPUB 图标）
	const mainPng256 = createIcon(256, epubBg, "E", epubLetter);
	fs.writeFileSync(path.join(ICONS_DIR, "icon.png"), mainPng256);

	// 生成 ICO（Windows 多页 ICO：16+32+48+256）
	function buildMultiIco(bgColor, letter, letterColor) {
		const icoSizes = [16, 32, 48, 64];
		const header = Buffer.alloc(6);
		header.writeUInt16LE(0, 0);
		header.writeUInt16LE(1, 2);
		header.writeUInt16LE(icoSizes.length, 4);

		const entries = [];
		const pngs = [];

		for (const s of icoSizes) {
			const png = createIcon(s, bgColor, letter, letterColor);
			pngs.push(png);
		}

		// 计算偏移量
		let offset = 6 + icoSizes.length * 16;
		for (let i = 0; i < icoSizes.length; i++) {
			const s = icoSizes[i];
			const entry = Buffer.alloc(16);
			entry.writeUInt8(s === 256 ? 0 : s, 0);
			entry.writeUInt8(s === 256 ? 0 : s, 1);
			entry.writeUInt8(0, 2);
			entry.writeUInt8(0, 3);
			entry.writeUInt16LE(1, 4);
			entry.writeUInt16LE(32, 6);
			entry.writeUInt32LE(pngs[i].length, 8);
			entry.writeUInt32LE(offset, 12);
			entries.push(entry);
			offset += pngs[i].length;
		}

		return Buffer.concat([header, ...entries, ...pngs]);
	}

	// 写 ICO
	fs.writeFileSync(
		path.join(ICONS_DIR, "epub.ico"),
		buildMultiIco(epubBg, "E", epubLetter),
	);
	fs.writeFileSync(
		path.join(ICONS_DIR, "md.ico"),
		buildMultiIco(mdBg, "M", mdLetter),
	);

	console.log("✅ 图标生成完毕:");
	console.log("  EPUB:", path.join(ICONS_DIR, "epub.ico"));
	console.log("  MD:  ", path.join(ICONS_DIR, "md.ico"));
	for (const size of SIZES) {
		console.log(`  epub-${size}x${size}.png`);
		console.log(`  md-${size}x${size}.png`);
	}
}

main().catch(console.error);
