// ============================================================
// 加料管道 P4 — 导出（TXT / Markdown / EPUB）
// 纯函数模块：内容模式解析（原文/加料版/对照）、三种格式构建、EPUB 打包。
// 下载动作（Blob + a[download]）在 index.js。
// ============================================================

import { _buildZip, _u8 } from './storage-system.js';

/** 内容模式：enriched=加料版（未加料章回退原文）；original=原文；compare=对照。 */
export const EXPORT_MODES = ['enriched', 'original', 'compare'];

/** 章节是否已有加料版（无加料标记不算）。 */
export function niChapterHasEnrich(ch) {
    return !!(ch?.enrich && !ch.enrich.noContent && ch.enrich.text);
}

/** 未加料章节数（导出加料版/对照时用于警告）。 */
export function niCountNotEnriched(chapters) {
    return (Array.isArray(chapters) ? chapters : []).filter(ch => !niChapterHasEnrich(ch)).length;
}

/** 章节标题（无标题时用 第N章 兜底）。 */
export function niChapterTitle(ch, fallback = '未命名章节') {
    return String(ch?.title || '').trim() || (ch?.index ? `第${ch.index}章` : fallback);
}

/**
 * 按内容模式取章节正文：
 *  - enriched：加料版全文（ch.enrich.text），未加料回退原文；
 *  - original：原文；
 *  - compare：对照（原文 + 加料版，未加料标注）。
 */
export function niResolveExportChapterText(ch, mode = 'enriched') {
    if (!ch) return '';
    const original = String(ch.text || '');
    if (mode === 'original') return original;
    const enriched = niChapterHasEnrich(ch) ? String(ch.enrich.text) : '';
    if (mode === 'enriched') return enriched || original;
    // compare
    const parts = [`【原文】\n${original}`];
    parts.push(enriched ? `【加料版】\n${enriched}` : '【加料版】\n（本章未加料，无加料版）');
    return parts.join('\n\n');
}

/** 段落拆分（按换行、去空段；TXT/MD/EPUB 通用）。 */
export function niExportParagraphs(text) {
    return String(text || '').split(/\r?\n+/).map(p => p.trim()).filter(p => p.length > 0);
}

/** XML 转义（EPUB 内容）。 */
export function niXmlEsc(text) {
    return String(text ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

/** 文件名安全化（去掉非法字符）。 */
export function niSafeFileName(name, fallback = 'novel') {
    const cleaned = String(name || '')
        .replace(/[\\/:*?"<>|\r\n\t]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return cleaned || fallback;
}

/**
 * 构建 TXT 导出文本。
 * @param {Array} chapters 章节数组（{index,title,text,enrich}）
 * @param {object} opts { title?:string, author?:string, mode?:string }
 */
export function niBuildExportText(chapters, { title = '', author = '', mode = 'enriched' } = {}) {
    const list = Array.isArray(chapters) ? chapters : [];
    const head = [];
    if (title) head.push(title);
    if (author) head.push(`作者：${author}`);
    const body = list.map(ch => {
        const headLine = niChapterTitle(ch);
        return `${headLine}\n\n${niResolveExportChapterText(ch, mode)}`;
    });
    return [...head, '', ...body].join('\n\n') + '\n';
}

/**
 * 构建 Markdown 导出文本。
 */
export function niBuildExportMarkdown(chapters, { title = '', author = '', mode = 'enriched' } = {}) {
    const list = Array.isArray(chapters) ? chapters : [];
    const head = [];
    if (title) head.push(`# ${title}`);
    if (author) head.push(`> 作者：${author}`);
    const body = list.map(ch => `## ${niChapterTitle(ch)}\n\n${niResolveExportChapterText(ch, mode)}`);
    return [...head, '', ...body].join('\n\n') + '\n';
}

/**
 * 构建 EPUB（EPUB 3，STORE 压缩；mimetype 首个条目）。
 * @returns {Uint8Array} epub 文件字节
 */
export function niBuildExportEpub(chapters, { title = '未命名', author = '', identifier = '' } = {}) {
    const list = Array.isArray(chapters) ? chapters : [];
    const bookTitle = String(title || '未命名');
    const bookAuthor = String(author || '');
    const bookId = String(identifier || `urn:uuid:${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`);
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const chapterItems = list.map((ch, i) => ({
        id: `c${i + 1}`,
        href: `chapter-${i + 1}.xhtml`,
        title: niChapterTitle(ch),
        text: niResolveExportChapterText(ch, 'enriched'), // EPUB 正文固定用加料版（未加料回退原文）
        compare: false,
    }));

    // 章节 XHTML
    const chapterFiles = chapterItems.map(ch => ({
        name: `OEBPS/${ch.href}`,
        data: _u8(niBuildChapterXhtml(ch)),
    }));

    // nav.xhtml
    const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${niXmlEsc(bookTitle)}</title></head>
<body>
<nav epub:type="toc"><h1>目录</h1><ol>
${chapterItems.map(ch => `<li><a href="${niXmlEsc(ch.href)}">${niXmlEsc(ch.title)}</a></li>`).join('\n')}
</ol></nav>
</body>
</html>`;

    // content.opf
    const manifestItems = [
        `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
        ...chapterItems.map(ch => `<item id="${ch.id}" href="${niXmlEsc(ch.href)}" media-type="application/xhtml+xml"/>`),
    ].join('\n');
    const spineItems = chapterItems.map(ch => `<itemref idref="${ch.id}"/>`).join('\n');
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
<dc:identifier id="pub-id">${niXmlEsc(bookId)}</dc:identifier>
<dc:title>${niXmlEsc(bookTitle)}</dc:title>
${bookAuthor ? `<dc:creator>${niXmlEsc(bookAuthor)}</dc:creator>` : ''}
<dc:language>zh-CN</dc:language>
<meta property="dcterms:modified">${niXmlEsc(modified)}</meta>
</metadata>
<manifest>
${manifestItems}
</manifest>
<spine>
${spineItems}
</spine>
</package>`;

    const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

    // EPUB 要求 mimetype 为第一个条目且未压缩（本 zip 全部 STORE）
    const files = [
        { name: 'mimetype', data: _u8('application/epub+zip') },
        { name: 'META-INF/container.xml', data: _u8(container) },
        { name: 'OEBPS/content.opf', data: _u8(opf) },
        { name: 'OEBPS/nav.xhtml', data: _u8(nav) },
        ...chapterFiles,
    ];
    return _buildZip(files);
}

function niBuildChapterXhtml(ch) {
    const paras = niExportParagraphs(ch.text)
        .map(p => `<p>${niXmlEsc(p)}</p>`)
        .join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${niXmlEsc(ch.title)}</title></head>
<body>
<h2>${niXmlEsc(ch.title)}</h2>
${paras}
</body>
</html>`;
}
