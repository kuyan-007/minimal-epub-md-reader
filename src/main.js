// ============================================================
// 极简EPUB阅读器 - 前端入口
// 功能：目录 + 背景选择 + 阅读进度（严格按需求，无字体调节）
// ============================================================

const TAURI = window.__TAURI__;
if (!TAURI) {
	console.error(
		"__TAURI__ 未暴露，请确认 tauri.conf.json 中 withGlobalTauri: true",
	);
}
const invoke = TAURI?.core?.invoke;
const getCurrentWindow = TAURI?.window?.getCurrentWindow;
const listen = TAURI?.event?.listen;

const BG_PRESETS = [
	{ id: "beige", name: "米黄", dataAttr: null },
	{ id: "white", name: "纯白", dataAttr: "white" },
	{ id: "green", name: "护眼绿", dataAttr: "green" },
	{ id: "dark", name: "深灰", dataAttr: "dark" },
];

/** 4 种小说阅读常用字体
 *  family 为空（索引 0）= 不覆盖，用 EPUB 原字体 */
const FONT_PRESETS = [
	{ id: "default", name: "默认", family: "" },
	{ id: "kaiti", name: "楷体", family: "KaiTi, 楷体, STKaiti, serif" },
	{ id: "songti", name: "宋体", family: "SimSun, 宋体, STSong, serif" },
	{
		id: "yahei",
		name: "雅黑",
		family: '"Microsoft YaHei", 微软雅黑, sans-serif',
	},
];

const state = {
	bookId: null,
	bookPath: null,
	title: null,
	author: null,
	chapters: [], // [{ index, id, title, href, html, base_href }]
	toc: [], // [{ label, href, order, level, children }]
	currentChapter: -1,
	currentBgIndex: 0,
	scrollPercent: 0,
	globalCss: "", // EPUB 内 CSS 汇总
	pendingScroll: null,
	tocAscending: true, // 目录排序：正序？
	// 进入当前章节的时间戳，用于给"自动跳转下一章"加一道入章保护：
	//   如果刚跳转或刚打开书的前 1.5 秒不触发，避免用户从序章末尾跳过来
	//   或首屏正好很矮时立刻被推进下一章。
	enteredChapterAt: 0,
	// 当前章节 iframe 的 contentDocument，供键盘 / 滚轮翻页调用
	// （指向那个各章节独立的滚动容器；旧章节 iframe 被销毁后该引用会被覆盖）
	currentDoc: null,
	// 当前章页数 / 当前页号，一般在 scroll / resize 后重算
	currentPage: 0,
	totalPages: 1,
	fontSize: 16,
	fontFamilyIndex: 0,
};

const $ = (sel) => document.querySelector(sel);
const els = {
	reader: $("#reader"),
	empty: $("#empty-state"),
	toc: $("#toc"),
	tocList: $("#toc-list"),
	tocClose: $("#toc-close"),
	bgToggle: $("#bg-toggle"),
	chapterTitle: $("#chapter-title"),
	chapterProg: $("#chapter-progress"),
	chapterNav: $("#chapter-nav"),
	fontToggle: $("#font-toggle"),
};

// ---------- 背景 ----------
function applyBackground(idx) {
	const preset = BG_PRESETS[idx];
	if (!preset) return;
	if (preset.dataAttr) {
		document.documentElement.setAttribute("data-bg", preset.dataAttr);
	} else {
		document.documentElement.removeAttribute("data-bg");
	}
	state.currentBgIndex = idx;
	savePreferences();
	syncThemeToIframe();
}

function cycleBackground() {
	const next = (state.currentBgIndex + 1) % BG_PRESETS.length;
	applyBackground(next);
}

// ---------- 目录 ----------
function renderToc() {
	els.tocList.replaceChildren();

	function appendNodes(nodes) {
		// 按 order 字段排序（正序↑ 或 倒序↓）
		const sorted = [...nodes].sort((a, b) =>
			state.tocAscending ? a.order - b.order : b.order - a.order,
		);
		for (const node of sorted) {
			const btn = document.createElement("button");
			btn.className = `toc-item depth-${Math.min(node.level || 1, 4)}`;
			btn.textContent = node.label;
			btn.dataset.order = String(node.order);
			if (node.order === state.currentChapter) btn.classList.add("active");
			btn.addEventListener("click", () => {
				jumpToChapter(node.order);
				toggleToc(false);
			});
			els.tocList.appendChild(btn);
			if (node.children && node.children.length) appendNodes(node.children);
		}
	}

	appendNodes(state.toc);

	if (els.tocList.children.length === 0) {
		const empty = document.createElement("div");
		empty.style.cssText =
			"padding:16px;color:var(--text-muted);font-size:12px;text-align:center;";
		empty.textContent = "（无目录）";
		els.tocList.appendChild(empty);
	}

	// 更新排序按钮文字
	const sortBtn = document.getElementById("toc-sort");
	if (sortBtn) sortBtn.textContent = state.tocAscending ? "正序" : "倒序";
}

function toggleTocSort() {
	state.tocAscending = !state.tocAscending;
	renderToc();
}

function toggleToc(show) {
	const shouldShow = show ?? els.toc.classList.contains("hidden");
	if (shouldShow) {
		els.toc.classList.remove("hidden");
		const active = els.tocList.querySelector(".toc-item.active");
		if (active) active.scrollIntoView({ block: "center", behavior: "smooth" });
	} else {
		els.toc.classList.add("hidden");
	}
}

// ---------- 章节渲染：iframe srcdoc 保持 EPUB 原格式 ----------
function buildChapterSrcdoc(chapter) {
	// 注入：全局 CSS + 章节 HTML，并替换 <img> src 为本地临时路径
	// 这里采取保守策略：仅在章节 HTML 引用图片时调用 get_resource
	// base href 用于解析相对路径
	let html = chapter.html;

	// 确保有 doctype / html 包裹
	if (!/<html[\s>]/i.test(html)) {
		html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
	}

	// 注入 CSS（在 head 末尾追加）
	const baseHref = chapter.base_href
		? `file:///${chapter.base_href.replace(/\\/g, "/")}/`
		: "";
	if (state.globalCss) {
		html = html.replace(
			/<\/head>/i,
			`<style>${state.globalCss}</style></head>`,
		);
	}
	if (baseHref) {
		html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
	}

	// 把章节内容包到 <div class="chapter-body">。
	// 该容器供纵向滚动 + 一屏一页 render。
	// 浏览器原生流自动排列 img/table/pre。
	html = html.replace(/<body([^>]*)>/i, `<body$1><div class="chapter-body">`);
	html = html.replace(/<\/body>/i, `</div></body>`);

	return html;
}

function renderChapter(order) {
	if (order < 0 || order >= state.chapters.length) return;

	const chapter = state.chapters[order];

	// 移除旧的 iframe 与空状态
	const oldFrame = document.getElementById("chapter-frame");
	if (oldFrame) oldFrame.remove();
	if (els.empty) {
		els.empty.remove();
	}

	const iframe = document.createElement("iframe");
	iframe.id = "chapter-frame";
	iframe.setAttribute("sandbox", "allow-same-origin");
	iframe.srcdoc = buildChapterSrcdoc(chapter);

	els.reader.appendChild(iframe);

	state.currentChapter = order;
	state.currentDoc = null;
	state.currentPage = 0;
	state.totalPages = 1;
	// 在 renderChapter 刚执行就计时，等 iframe 加载完成后“入章保护”
	// 已过 1.5s 才会允许自动跳转下一章。
	state.enteredChapterAt = Date.now();

	// 加载完成后：
	//  1) 解析 HTML 中所有 <img>，把 src 替换为临时文件路径
	//  2) 注入上下原生滚动 + 一屏一页 CSS（无 column）
	//  3) 恢复进度（按页定位）
	iframe.addEventListener("load", async () => {
		try {
			const doc = iframe.contentDocument;
			if (!doc) return;
			state.currentDoc = doc;
			const root = doc.documentElement;

			// 处理图片
			const imgs = Array.from(doc.querySelectorAll("img"));
			for (const img of imgs) {
				const src = img.getAttribute("src");
				if (
					!src ||
					src.startsWith("data:") ||
					src.startsWith("file://") ||
					src.startsWith("http")
				)
					continue;
				try {
					const dataUrl = await invoke("get_resource", {
						epubPath: state.bookPath,
						src,
					});
					img.setAttribute("src", dataUrl);
				} catch (e) {
					console.warn("image load failed:", src, e);
				}
			}

			// 注入【上下原生滚动 · 一屏一页】CSS：
			//   - 不再用 column；chapter-body 简单纵向 block
			//   - html/body overflow-y: auto（原生滚动，但不能横向溢）
			//   - ::-webkit-scrollbar { display: none } 隐藏滚动条
			//   - img/table/pre max-width: 100% 防超页
			//   - 一屏高度 = clientHeight，scrollTop / scrollHeight 决页号与进度
			function applyPageCSS() {
				const styleId = "page-scroll-css";
				let styleEl = doc.getElementById(styleId);
				if (!styleEl) {
					styleEl = doc.createElement("style");
					styleEl.id = styleId;
					doc.head.appendChild(styleEl);
				}
				styleEl.textContent = `
					/* 不设 height，让 html/body 自然延伸。
					   overflow-y: auto 在 html 上建立滚动容器。 */
					html {
						overflow-y: auto;
						overflow-x: hidden;
						scrollbar-width: none;
					}
					body {
						margin: 0;
						padding: 0;
						background: var(--bg-frame);
						color: var(--text);
					}
					html::-webkit-scrollbar {
						display: none;
					}
					.chapter-body {
						padding: 24px 32px;
						box-sizing: border-box;
						font-size: 16px;
						line-height: 1.6;
					}
					.chapter-body img, .chapter-body table, .chapter-body pre {
						max-width: 100%;
					}
				`;
			}
			applyPageCSS();
			recomputePagination();
			applyFontSize(state.fontSize);
			syncThemeToIframe();
			applyFontFamily(state.fontFamilyIndex);

			// 恢复进度：按比例设 scrollTop
			if (state.pendingScroll != null) {
				const maxH = root.scrollHeight - root.clientHeight;
				if (maxH > 0) {
					root.scrollTop = maxH * state.pendingScroll;
				}
				state.pendingScroll = null;
			}

			// 图片异步加载后可能导致高度变化，ResizeObserver 跟一下
			if (typeof ResizeObserver !== "undefined") {
				const ro = new ResizeObserver(() => {
					recomputePagination();
				});
				ro.observe(root);
			}

			// 章节内滚动 → 进度保存
			// 章末续读逻辑在 wheel handler 中实现（两次向底滚 = 下一章）
			let saveTimer = null;
			doc.addEventListener("scroll", () => {
				recomputePagination();

				const st = root.scrollTop;
				const totalH = root.scrollHeight;
				const viewH = root.clientHeight;

				// 进度保存：当前位置 / 总可滚距离
				const maxScroll = totalH - viewH;
				const ratio = maxScroll > 0 ? st / maxScroll : 0;
				clearTimeout(saveTimer);
				saveTimer = setTimeout(() => {
					state.scrollPercent = Math.min(1, Math.max(0, ratio));
					saveProgress();
					updateBookProgress();
				}, 1500);

				// 离开底屏就解除武装，下次到底要重新连续滚两次
				if (!(totalH > viewH && st + viewH >= totalH - 4)) {
					window._chapterEndArmed = false;
				}
			});

			// 滚轮 → 一滚一页（scrollTop ± clientHeight），但已到顶/底则交给 prev/next chapter。
			doc.addEventListener(
				"wheel",
				(e) => {
					e.preventDefault();

					// Ctrl + 滚轮：字体大小缩放（步长 2px，范围 10-32）
					if (e.ctrlKey) {
						const step = 2;
						const newFs = Math.max(
							10,
							Math.min(32, state.fontSize + (e.deltaY > 0 ? -step : step)),
						);
						if (newFs !== state.fontSize) {
							state.fontSize = newFs;
							applyFontSize(newFs);
							savePreferences();
						}
						return;
					}

					if (Math.abs(e.deltaY) < 1) return;
					const direction = e.deltaY > 0 ? 1 : -1;
					const viewH = root.clientHeight;
					const current = root.scrollTop;
					const maxScroll = root.scrollHeight - viewH;

					if (direction > 0 && current >= maxScroll - 4) {
						// 已经在本章最末屏。两次向底滚 = 下一章。
						const onLastPage =
							state.totalPages <= 1 ||
							state.currentPage === state.totalPages - 1;
						if (!onLastPage) return;
						if (!window._chapterEndArmed) {
							// 第一次到底：武装，还不动
							window._chapterEndArmed = true;
						} else if (
							state.currentChapter < state.chapters.length - 1 &&
							Date.now() - state.enteredChapterAt > 1500
						) {
							// 第二次到底：执行
							window._chapterEndArmed = false;
							nextChapter();
						} else if (
							state.currentChapter === state.chapters.length - 1 &&
							Date.now() - state.enteredChapterAt > 1500
						) {
							// 全书最后一章到底 → 全书读完
							window._chapterEndArmed = false;
							showBookComplete();
						}
						return;
					}
					if (direction < 0 && current <= 4) {
						// 已经在本章最顶屏：跳到上一章末尾一屏
						if (state.currentChapter > 0) {
							state.pendingScroll = 1.0; // 恢复到底
							prevChapter();
						}
						return;
					}

					const target = current + direction * viewH;
					root.scrollTop = Math.max(0, Math.min(maxScroll, target));
				},
				{ passive: false },
			);

			// iframe 内右键单击呼出 / 切换目录
			// 用 mousedown→mouseup 距离判定避免选文字时误触发。
			// 阻止浏览器的右键菜单。
			doc.addEventListener("contextmenu", (e) => e.preventDefault());
			let mDownX = 0,
				mDownY = 0;
			doc.addEventListener("mousedown", (e) => {
				mDownX = e.clientX;
				mDownY = e.clientY;
			});
			doc.addEventListener("mouseup", (e) => {
				if (Math.abs(e.clientX - mDownX) > 5) return;
				if (Math.abs(e.clientY - mDownY) > 5) return;
				if (e.button === 2) {
					toggleToc(); // 右键切换
				} else if (e.button === 0 && !els.toc.classList.contains("hidden")) {
					toggleToc(false); // 左键隐藏
				}
			});
		} catch (e) {
			console.warn("chapter iframe init failed:", e);
		}
	});

	showChapterNav(chapter.title, order, state.chapters.length);
	saveProgress();
	updateBookProgress();
}

function jumpToChapter(order) {
	if (order < 0 || order >= state.chapters.length) return;
	if (order === state.currentChapter) return;
	state.currentChapter = order;
	renderChapter(order);
	renderToc();
}

// nextChapter/prevChapter 只调 jumpToChapter（jumpToChapter 负责计时）
function nextChapter() {
	if (state.chapters.length === 0) return;
	if (state.currentChapter < state.chapters.length - 1) {
		jumpToChapter(state.currentChapter + 1);
	}
}

function prevChapter() {
	if (state.chapters.length === 0) return;
	if (state.currentChapter > 0) {
		jumpToChapter(state.currentChapter - 1);
	}
}

// ---------- 翻页 ----------
// iframe 内采用上下原生滚动 + 一屏一页：
//   - 一页 = clientHeight；scrollTop / clientHeight 决定当前页
//   - 进度位置 = scrollTop / (scrollHeight - clientHeight)
//   - 翻页粒度 = 1 clientHeight（←/→ 与滚轮都走这里）
function recomputePagination() {
	const doc = state.currentDoc;
	if (!doc) return;
	const root = doc.documentElement;
	const viewH = root.clientHeight || 1;
	const totalH = root.scrollHeight;
	state.totalPages = Math.max(1, Math.round(totalH / viewH));
	state.currentPage = Math.min(
		state.totalPages - 1,
		Math.max(0, Math.round(root.scrollTop / viewH)),
	);
}

function gotoPage(page) {
	const doc = state.currentDoc;
	if (!doc) return;
	const root = doc.documentElement;
	const viewH = root.clientHeight || 1;
	const target = Math.max(0, Math.min(state.totalPages - 1, Math.round(page)));
	root.scrollTop = target * viewH;
	recomputePagination();
	showChapterNav(
		state.chapters[state.currentChapter]?.title,
		state.currentChapter,
		state.chapters.length,
	);
}

function nextPage() {
	const doc = state.currentDoc;
	if (!doc) return;
	if (state.currentPage < state.totalPages - 1) {
		gotoPage(state.currentPage + 1);
	} else if (state.currentChapter < state.chapters.length - 1) {
		// 本章最后一屏 → 进入下一章
		nextChapter();
	}
	// 末章末屏 → 不响应
}

function prevPage() {
	const doc = state.currentDoc;
	if (!doc) return;
	if (state.currentPage > 0) {
		gotoPage(state.currentPage - 1);
	} else if (state.currentChapter > 0) {
		// 本章首屏 → 上一章
		prevChapter();
	}
	// 首章首屏 → 不响应
}

function showChapterNav(title, current, total) {
	els.chapterTitle.textContent = title || "—";
	let prog = `${current + 1} / ${total}`;
	if (state.totalPages > 1) {
		prog += ` · 第 ${state.currentPage + 1}/${state.totalPages} 页`;
	}
	els.chapterProg.textContent = prog;
	els.chapterNav.classList.add("visible");
	clearTimeout(showChapterNav._t);
	showChapterNav._t = setTimeout(() => {
		els.chapterNav.classList.remove("visible");
	}, 2000);
}

// ---------- 字体缩放 ----------
function applyFontSize(fs) {
	const doc = state.currentDoc;
	if (!doc) return;
	let styleEl = doc.getElementById("page-fontsize");
	if (!styleEl) {
		styleEl = doc.createElement("style");
		styleEl.id = "page-fontsize";
		doc.head.appendChild(styleEl);
	}
	styleEl.textContent = `.chapter-body { font-size: ${fs}px !important; }`;
}

/** 把当前主题的 CSS 变量值注入 iframe 的 :root，
 *  让 iframe 内的 var(--text)／var(--bg-frame) 正确解析。
 *  CSS 变量不跨 iframe 继承，这是必要桥梁。 */
function syncThemeToIframe() {
	const doc = state.currentDoc;
	if (!doc) return;
	const cs = getComputedStyle(document.documentElement);
	let styleEl = doc.getElementById("iframe-theme-vars");
	if (!styleEl) {
		styleEl = doc.createElement("style");
		styleEl.id = "iframe-theme-vars";
		doc.head.appendChild(styleEl);
	}
	const bg = cs.getPropertyValue("--bg-frame").trim() || "#f5ecd9";
	const text = cs.getPropertyValue("--text").trim() || "#2b2b2b";
	styleEl.textContent = `:root { --bg-frame: ${bg}; --text: ${text}; }`;
}

// ---------- 字体切换 ----------
function applyFontFamily(idx) {
	const preset = FONT_PRESETS[idx];
	if (!preset) return;
	state.fontFamilyIndex = idx;
	// 更新按钮文字
	if (els.fontToggle) {
		els.fontToggle.textContent = preset.name;
	}
	// 注入 iframe
	const doc = state.currentDoc;
	if (!doc) return;
	let styleEl = doc.getElementById("iframe-font-family");
	if (!styleEl) {
		styleEl = doc.createElement("style");
		styleEl.id = "iframe-font-family";
		doc.head.appendChild(styleEl);
	}
	if (preset.family) {
		styleEl.textContent = `.chapter-body { font-family: ${preset.family} !important; }`;
	} else {
		// 默认 = 不覆盖，清空之前的字体内联样式
		styleEl.textContent = ".chapter-body { font-family: inherit; }";
	}
}

function cycleFontFamily() {
	const next = (state.fontFamilyIndex + 1) % FONT_PRESETS.length;
	applyFontFamily(next);
	savePreferences();
}

// ---------- 全书阅读进度 ----------
/** 按「当前章索引 + 本章进度」算出全书百分比，更新右上角。
 *  C 章进度 S → (C + S) / N */
function updateBookProgress() {
	const el = document.getElementById("book-progress");
	if (!el) return;
	if (
		state.currentChapter < 0 ||
		!state.chapters ||
		state.chapters.length === 0
	) {
		el.textContent = "";
		el.classList.remove("visible");
		return;
	}
	const pct =
		((state.currentChapter + (state.scrollPercent || 0)) /
			state.chapters.length) *
		100;
	const clamped = Math.min(100, Math.max(0, pct));
	el.textContent = `${Math.round(clamped)}%`;
	el.classList.add("visible");
}

// ---------- 全书读完提示 ----------
function showBookComplete() {
	const el = document.getElementById("book-complete");
	if (!el) return;
	el.classList.remove("hidden");
	clearTimeout(window._bookCompleteTimer);
	window._bookCompleteTimer = setTimeout(() => {
		el.classList.add("hidden");
	}, 2000);
}

// ---------- 打开 EPUB ----------
async function openEpub(path) {
	try {
		const result = await invoke("open_epub", { path });
		state.bookPath = path;
		state.bookId = result.book.book_id;
		state.title = result.book.title;
		state.author = result.book.author;
		state.chapters = result.book.chapters;
		state.toc = result.book.toc;
		state.globalCss = result.css;

		renderToc();

		// 续读
		let resumeChapter = 0;
		let resumeScroll = 0;
		if (invoke) {
			try {
				const prog = await invoke("load_progress", { bookId: state.bookId });
				if (prog && prog.chapter >= 0 && prog.chapter < state.chapters.length) {
					resumeChapter = prog.chapter;
					resumeScroll = prog.scroll || 0;
				}
			} catch (e) {
				console.warn("load_progress failed", e);
			}
		}
		state.pendingScroll = resumeScroll;
		renderChapter(resumeChapter);
	} catch (e) {
		alert("打开 EPUB 失败:\n" + e);
	}
}

// ---------- 持久化 ----------
async function savePreferences() {
	if (!invoke) return;
	try {
		await invoke("save_preferences", {
			prefs: {
				bgIndex: state.currentBgIndex,
				fontSize: state.fontSize,
				fontFamilyIndex: state.fontFamilyIndex,
			},
		});
	} catch (e) {
		console.warn("save_preferences failed", e);
	}
}

async function saveProgress() {
	if (!invoke || !state.bookId) return;
	try {
		await invoke("save_progress", {
			bookId: state.bookId,
			progress: {
				bookPath: state.bookPath,
				chapter: state.currentChapter,
				scroll: state.scrollPercent,
				updatedAt: Date.now(),
			},
		});
	} catch (e) {
		console.warn("save_progress failed", e);
	}
}

async function loadPreferences() {
	if (!invoke) {
		applyBackground(0);
		return;
	}
	try {
		const prefs = await invoke("load_preferences");
		if (prefs && typeof prefs.bg_index === "number") {
			const idx = Math.min(prefs.bg_index, BG_PRESETS.length - 1);
			applyBackground(idx);
		} else {
			applyBackground(0);
		}
		if (prefs && typeof prefs.font_size === "number") {
			state.fontSize = prefs.font_size;
		}
		if (prefs && typeof prefs.font_family_index === "number") {
			applyFontFamily(
				Math.min(prefs.font_family_index, FONT_PRESETS.length - 1),
			);
		}
	} catch (e) {
		applyBackground(0);
	}
}

// ---------- 快捷键 & 交互 ----------
//
// 交互模型（阅读优先）：
//   鼠标：靠近左侧某阈值后自动显示目录
//   点击：主区域除浮层控件以外点击切换目录
//   滚轮：一滚一页（一屏） = scrollTop ± clientHeight
//   键盘 ←/→：上一屏 / 下一屏，跨章边界自动处理；ESC：隐藏窗口
//   正文：到达本章末尾 + 未在末章 → 停留 3 秒后自动加载下一章
function bindShortcuts() {
	document.addEventListener("keydown", (e) => {
		const tag = e.target.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA") return;
		if (e.ctrlKey || e.altKey || e.metaKey) return;

		switch (e.key) {
			case "ArrowLeft":
				e.preventDefault();
				// 跨多章时优先跨越章节边界，避免用户括到首章开头还能继续上翻
				prevPage();
				break;
			case "ArrowRight":
				e.preventDefault();
				nextPage();
				break;
			case "Escape":
				// 恢复 ESC 隐藏窗口能力（保留为托盘交互）
				e.preventDefault();
				if (getCurrentWindow) getCurrentWindow().hide();
				break;
		}
	});

	els.tocClose.addEventListener("click", () => toggleToc(false));
	const sortBtn = document.getElementById("toc-sort");
	if (sortBtn) sortBtn.addEventListener("click", toggleTocSort);
	els.bgToggle.addEventListener("click", cycleBackground);
	if (els.fontToggle) {
		els.fontToggle.addEventListener("click", cycleFontFamily);
	}

	// 右键单击主区域呼出 / 切换目录
	// 排除：目录浮层、右下背景按钮、章节导航浮层、拖动条。
	// 阻止浏览器右键菜单弹出。
	document.addEventListener("contextmenu", (e) => e.preventDefault());
	// 右键→切换目录
	document.addEventListener("click", (e) => {
		if (e.button !== 2) return;
		if (e.target.closest("#toc, #bg-toggle, #chapter-nav, #drag-region"))
			return;
		toggleToc();
	});
	// 左键单击主区域→目录可见时隐藏
	document.addEventListener("click", (e) => {
		if (e.button !== 0) return;
		if (e.target.closest("#toc, #bg-toggle, #chapter-nav, #drag-region"))
			return;
		if (!els.toc.classList.contains("hidden")) {
			toggleToc(false);
		}
	});
}

// 收到后端 emit 的 open-epub：可能是 second-instance、也可能是联关双击。
// 路径作为 payload 传来；如果未提供，也可去 take_initial_file 拿。
async function handleOpenEpubEvent(payloadPath) {
	let path = payloadPath;
	if (path) {
		try {
			await invoke("set_initial_file", { path });
		} catch (e) {
			console.warn("set_initial_file failed", e);
		}
	} else {
		try {
			path = await invoke("take_initial_file");
		} catch (e) {
			console.warn("take_initial_file failed", e);
		}
	}
	if (path) await openEpub(path);
}

// ---------- 启动 ----------
async function bootstrap() {
	bindShortcuts();
	await loadPreferences();

	if (listen) {
		try {
			await listen("open-epub", (e) => {
				handleOpenEpubEvent(e.payload);
			});
		} catch (err) {
			console.warn("listen(open-epub) failed", err);
		}
	}

	if (invoke) {
		try {
			const initialFile = await invoke("take_initial_file");
			if (initialFile) {
				await openEpub(initialFile);
			}
		} catch (e) {
			console.warn("take_initial_file failed", e);
		}
	}
}

bootstrap();
