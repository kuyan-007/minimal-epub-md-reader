// 生成应用图标：PNG + ICO（占位，米黄色背景）
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(data) {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crcInput = Buffer.concat([typeBuf, data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(crcInput), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, fillRgba, borderRgba) {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdrData = Buffer.alloc(13);
	ihdrData.writeUInt32BE(size, 0);
	ihdrData.writeUInt32BE(size, 4);
	ihdrData.writeUInt8(8, 8);
	ihdrData.writeUInt8(6, 9); // RGBA
	ihdrData.writeUInt8(0, 10);
	ihdrData.writeUInt8(0, 11);
	ihdrData.writeUInt8(0, 12);
	const ihdr = chunk("IHDR", ihdrData);

	const stride = size * 4;
	const raw = Buffer.alloc(size * (stride + 1));
	for (let y = 0; y < size; y++) {
		raw[y * (stride + 1)] = 0;
		for (let x = 0; x < size; x++) {
			const off = y * (stride + 1) + 1 + x * 4;
			const onBorder = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
			const c = onBorder ? borderRgba : fillRgba;
			raw[off] = c[0];
			raw[off + 1] = c[1];
			raw[off + 2] = c[2];
			raw[off + 3] = c[3];
		}
	}
	const idat = chunk("IDAT", zlib.deflateSync(raw));
	const iend = chunk("IEND", Buffer.alloc(0));
	return Buffer.concat([sig, ihdr, idat, iend]);
}

function makeIco(pngBuf, size) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(1, 4);
	const entry = Buffer.alloc(16);
	entry.writeUInt8(size >= 256 ? 0 : size, 0);
	entry.writeUInt8(size >= 256 ? 0 : size, 1);
	entry.writeUInt8(0, 2);
	entry.writeUInt8(0, 3);
	entry.writeUInt16LE(1, 4);
	entry.writeUInt16LE(32, 6);
	entry.writeUInt32LE(pngBuf.length, 8);
	entry.writeUInt32LE(22, 12);
	return Buffer.concat([header, entry, pngBuf]);
}

const outDir = path.join(__dirname, "..", "src-tauri", "icons");
fs.mkdirSync(outDir, { recursive: true });

// 米黄主色 #f5ecd9，深棕边框 #8b6f3f
const fill = [245, 236, 217, 255];
const border = [139, 111, 63, 255];

const sizes = [32, 128, 256];
for (const s of sizes) {
	const png = makePng(s, fill, border);
	fs.writeFileSync(path.join(outDir, `${s}x${s}.png`), png);
	if (s === 128) fs.writeFileSync(path.join(outDir, "128x128@2x.png"), png);
}

// 主 icon.png 用 256
fs.writeFileSync(path.join(outDir, "icon.png"), makePng(256, fill, border));
// ICO（Windows 用）
fs.writeFileSync(
	path.join(outDir, "icon.ico"),
	makeIco(makePng(64, fill, border), 64),
);

console.log("icons generated ->", outDir);
