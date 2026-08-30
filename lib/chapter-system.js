// ============================================================
// 章节系统（加料管道 P0）
// 职责：章节识别、短章节过滤与导入报告、章节编辑操作（合并/拆分/重命名/删除）、
//       章节状态机、EPUB 文本提取。
// 与现有「清洗管道」完全隔离：只消费 rawText，不触碰 chunks/plots/向量。
// ============================================================

import { _parseZip } from './storage-system.js';
import { niMobiHtmlToText } from './cleaning-system.js';

// ------------------------------------------------------------
// 章节状态机
// ------------------------------------------------------------

export const CHAPTER_STATUS = {
    UNDETECTED: 'undetected',   // 未判定
    DETECTING: 'detecting',     // 判定中
    JUDGED: 'judged',           // 已判定
    ENRICHING: 'enriching',     // 加料中
    ENRICHED: 'enriched',       // 已加料
    MODIFIED: 'modified',       // 已修改（手动编辑）
    FAILED: 'failed',           // 失败
    SKIPPED: 'skipped',         // 跳过
};

export const CHAPTER_STATUS_LABELS = {
    [CHAPTER_STATUS.UNDETECTED]: '未判定',
    [CHAPTER_STATUS.DETECTING]: '判定中',
    [CHAPTER_STATUS.JUDGED]: '已判定',
    [CHAPTER_STATUS.ENRICHING]: '加料中',
    [CHAPTER_STATUS.ENRICHED]: '已加料',
    [CHAPTER_STATUS.MODIFIED]: '已修改',
    [CHAPTER_STATUS.FAILED]: '失败',
    [CHAPTER_STATUS.SKIPPED]: '跳过',
};

// 允许的转移表；所有状态变更必须经过 transitionChapter
const CHAPTER_TRANSITIONS = {
    [CHAPTER_STATUS.UNDETECTED]: [CHAPTER_STATUS.DETECTING, CHAPTER_STATUS.SKIPPED],
    [CHAPTER_STATUS.DETECTING]: [CHAPTER_STATUS.JUDGED, CHAPTER_STATUS.FAILED, CHAPTER_STATUS.SKIPPED, CHAPTER_STATUS.UNDETECTED],
    [CHAPTER_STATUS.JUDGED]: [CHAPTER_STATUS.ENRICHING, CHAPTER_STATUS.SKIPPED],
    [CHAPTER_STATUS.ENRICHING]: [CHAPTER_STATUS.ENRICHED, CHAPTER_STATUS.FAILED, CHAPTER_STATUS.SKIPPED, CHAPTER_STATUS.JUDGED],
    [CHAPTER_STATUS.ENRICHED]: [CHAPTER_STATUS.MODIFIED, CHAPTER_STATUS.ENRICHING],
    [CHAPTER_STATUS.MODIFIED]: [CHAPTER_STATUS.ENRICHING],
    [CHAPTER_STATUS.FAILED]: [CHAPTER_STATUS.DETECTING, CHAPTER_STATUS.ENRICHING, CHAPTER_STATUS.UNDETECTED],
    [CHAPTER_STATUS.SKIPPED]: [CHAPTER_STATUS.DETECTING, CHAPTER_STATUS.ENRICHING, CHAPTER_STATUS.UNDETECTED],
};

export function canTransition(from, to) {
    return (CHAPTER_TRANSITIONS[from] || []).includes(to);
}

/** 唯一的状态转移入口；非法转移返回 false 不修改。 */
export function transitionChapter(chapter, to) {
    if (!chapter || !canTransition(chapter?.status, to)) return false;
    chapter.status = to;
    return true;
}

// ------------------------------------------------------------
// 章节识别
// ------------------------------------------------------------

export const DEFAULT_CHAPTER_PATTERNS = [
    { id: 'cn_num',    label: '中文数字章节', flags: 'm',  source: '^\\s*第[0-9零一二三四五六七八九十百千万两]+[章节回卷部集篇][\\s、.．:：].*' },
    { id: 'cn_plain',  label: '中文章节（无序号）', flags: 'm', source: '^\\s*第[0-9零一二三四五六七八九十百千万两]+[章节回卷部集篇]\\s*$' },
    { id: 'cn_special',label: '序章/楔子/番外等', flags: 'm', source: '^\\s*(序章|楔子|引子|序言|前言|尾声|后记|番外|外传|终章|开局)\\s*$' },
    { id: 'en_num',    label: '英文章节', flags: 'im', source: '^\\s*chapter\\s+[0-9]+.*' },
    { id: 'en_word',   label: '英文特殊章节', flags: 'im', source: '^\\s*(prologue|epilogue|interlude|afterword|foreword)\\s*$' },
    { id: 'md_h1',     label: 'Markdown 一级标题', flags: 'm', source: '^\\s*#\\s+.+' },
    { id: 'md_h2',     label: 'Markdown 二级标题', flags: 'm', source: '^\\s*##\\s+.+' },
];

/** 编译模式列表（含用户自定义），返回 [{regex, label}]；无效自定义正则静默跳过。 */
export function compileChapterPatterns({ patterns = DEFAULT_CHAPTER_PATTERNS, customPatterns = [] } = {}) {
    const compiled = [];
    for (const p of Array.isArray(patterns) ? patterns : []) {
        if (!p || p.enabled === false || !p.source) continue;
        try {
            compiled.push({ regex: new RegExp(p.source, p.flags || 'm'), label: p.label || '内置规则' });
        } catch (_) { /* 忽略非法内置规则 */ }
    }
    for (const raw of Array.isArray(customPatterns) ? customPatterns : []) {
        const source = String(raw || '').trim();
        if (!source) continue;
        try {
            compiled.push({ regex: new RegExp(source, 'm'), label: '自定义' });
        } catch (_) { /* 无效自定义正则，跳过 */ }
    }
    return compiled;
}

/** 字符偏移 → 行号（基于按 \n 切分的行数组）。 */
function lineOfCharOffset(lines, offset) {
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
        if (acc + lines[i].length >= offset) return i;
        acc += lines[i].length + 1;
    }
    return lines.length;
}

/**
 * 识别章节。
 * @param {string} text 全文
 * @param {object} opts
 *   - patterns: 内置模式数组（默认 DEFAULT_CHAPTER_PATTERNS）
 *   - customPatterns: string[] 用户自定义正则
 *   - boundaries: [{offset, label}] 可选后备边界（EPUB spine 文件边界），正则无命中时使用
 * @returns {object[]} 章节数组，每项 {id, index, title, pattern, startLine, endLine, text, charCount, status, flag, filtered}
 */
export function recognizeChapters(text, { patterns = DEFAULT_CHAPTER_PATTERNS, customPatterns = [], boundaries = null } = {}) {
    const source = String(text || '');
    const lines = source.split(/\r?\n/);
    const compiled = compileChapterPatterns({ patterns, customPatterns });
    const hits = [];

    lines.forEach((line, i) => {
        const t = line.trim();
        if (!t) return;
        for (const p of compiled) {
            p.regex.lastIndex = 0;
            if (p.regex.test(t)) {
                hits.push({ lineNo: i, title: t, label: p.label });
                break;
            }
        }
    });

    let chapters = [];

    if (hits.length) {
        chapters = hits.map((h, idx) => {
            const endLine = idx + 1 < hits.length ? hits[idx + 1].lineNo : lines.length;
            const content = lines.slice(h.lineNo + 1, endLine).join('\n').trim();
            return {
                id: '', index: 0, title: h.title, pattern: h.label,
                startLine: h.lineNo, endLine,
                text: content, charCount: content.length,
                status: CHAPTER_STATUS.UNDETECTED, flag: '', filtered: false,
            };
        });
        // 首个标题前的正文作为「开篇」章
        const firstTitleLine = hits[0].lineNo;
        const preamble = lines.slice(0, firstTitleLine).join('\n').trim();
        if (preamble) {
            chapters.unshift({
                id: '', index: 0, title: '开篇', pattern: '前置正文',
                startLine: 0, endLine: firstTitleLine,
                text: preamble, charCount: preamble.length,
                status: CHAPTER_STATUS.UNDETECTED, flag: '', filtered: false,
            });
        }
    } else if (Array.isArray(boundaries) && boundaries.length) {
        // 后备：按 EPUB spine 文件边界切章
        const starts = boundaries.map(b => lineOfCharOffset(lines, b.offset));
        const ends = [...starts.slice(1), lines.length];
        chapters = boundaries.map((b, idx) => {
            const content = lines.slice(starts[idx], ends[idx]).join('\n').trim();
            const title = (b.label || `第 ${idx + 1} 章`).replace(/[_\-.]+/g, ' ').trim() || `第 ${idx + 1} 章`;
            return {
                id: '', index: 0, title, pattern: 'EPUB 文件边界',
                startLine: starts[idx], endLine: ends[idx],
                text: content, charCount: content.length,
                status: CHAPTER_STATUS.UNDETECTED, flag: '', filtered: false,
            };
        });
    } else {
        // 完全无法识别：整篇作为一章
        chapters = [{
            id: '', index: 1, title: '全文', pattern: '未识别到章节标题',
            startLine: 0, endLine: lines.length,
            text: source.trim(), charCount: source.trim().length,
            status: CHAPTER_STATUS.UNDETECTED, flag: '', filtered: false,
        }];
    }

    renumberChapters(chapters);
    return chapters;
}

// ------------------------------------------------------------
// 短章节过滤与导入报告
// ------------------------------------------------------------

/**
 * 按阈值过滤短章节（正文不含标题）。
 * @returns {{keptCount:number, filteredCount:number, filtered:object[], allFiltered:boolean}}
 */
export function applyChapterFilter(chapters, threshold = 200, enabled = true) {
    const list = Array.isArray(chapters) ? chapters : [];
    const limit = Math.max(0, Number(threshold) || 0);
    list.forEach(ch => {
        ch.filtered = !!enabled && ch.charCount < limit;
    });
    return buildChapterImportReport(list, limit, enabled);
}

export function buildChapterImportReport(chapters, threshold = 200, enabled = true) {
    const list = Array.isArray(chapters) ? chapters : [];
    const kept = [];
    const filtered = [];
    for (const ch of list) {
        if (ch.filtered) {
            filtered.push({
                id: ch.id, title: ch.title, charCount: ch.charCount,
                reason: enabled === false ? '过滤已关闭' : `正文不足 ${threshold} 字符`,
            });
        } else {
            kept.push(ch);
        }
    }
    return {
        keptCount: kept.length,
        filteredCount: filtered.length,
        filtered,
        allFiltered: list.length > 0 && kept.length === 0,
    };
}

// ------------------------------------------------------------
// 章节编辑操作
// ------------------------------------------------------------

export function renumberChapters(chapters) {
    (Array.isArray(chapters) ? chapters : []).forEach((ch, i) => {
        ch.index = i + 1;
        ch.id = `ch_${String(i + 1).padStart(4, '0')}`;
    });
    return chapters;
}

/** 合并若干章节（按索引，自动排序去重）；合并文本保留各章标题为【】块。 */
export function mergeChapters(chapters, indices) {
    const list = Array.isArray(chapters) ? chapters : [];
    const sorted = [...new Set((indices || []).map(Number).filter(i => Number.isFinite(i) && i >= 0 && i < list.length))].sort((a, b) => a - b);
    if (sorted.length < 2) return false;
    const first = list[sorted[0]];
    const baseTitle = String(first?.title || '').replace(/（合并.*/, '');
    const merged = sorted.map(i => list[i]);
    const title = `${baseTitle}（合并 ${merged.length} 章）`;
    const text = merged.map(ch => `【${ch.title}】\n${ch.text}`).join('\n\n');
    const newChapter = {
        ...first,
        title,
        text,
        charCount: text.length,
        status: CHAPTER_STATUS.UNDETECTED,
        flag: '',
        judge: null,
        enrich: null,
        filtered: false,
    };
    for (const i of sorted.slice(1).reverse()) list.splice(i, 1);
    list[sorted[0]] = newChapter;
    renumberChapters(list);
    return true;
}

/** 在字符位置拆分章节；位置必须在正文内部（非首尾）。 */
export function splitChapter(chapters, index, at) {
    const list = Array.isArray(chapters) ? chapters : [];
    const ch = list[index];
    if (!ch) return false;
    const pos = Math.max(0, Math.min(ch.text.length, Number(at) || 0));
    if (pos <= 0 || pos >= ch.text.length) return false;
    const head = ch.text.slice(0, pos).trim();
    const tail = ch.text.slice(pos).trim();
    if (!head || !tail) return false;
    const tailTitle = `${ch.title}（下）`;
    const tailChapter = {
        ...ch,
        title: tailTitle,
        text: tail,
        charCount: tail.length,
        status: CHAPTER_STATUS.UNDETECTED,
        flag: '',
        judge: null,
        enrich: null,
        filtered: false,
    };
    ch.title = `${ch.title}（上）`;
    ch.text = head;
    ch.charCount = head.length;
    ch.status = CHAPTER_STATUS.UNDETECTED;
    ch.judge = null;
    ch.enrich = null;
    list.splice(index + 1, 0, tailChapter);
    renumberChapters(list);
    return true;
}

export function renameChapter(chapters, index, title) {
    const ch = (Array.isArray(chapters) ? chapters : [])[index];
    const next = String(title || '').trim();
    if (!ch || !next) return false;
    ch.title = next;
    return true;
}

export function deleteChapters(chapters, indices) {
    const list = Array.isArray(chapters) ? chapters : [];
    const sorted = [...new Set((indices || []).map(Number).filter(i => Number.isFinite(i) && i >= 0 && i < list.length))].sort((a, b) => b - a);
    if (!sorted.length) return false;
    for (const i of sorted) list.splice(i, 1);
    renumberChapters(list);
    return true;
}

// ------------------------------------------------------------
// EPUB 文本提取
// ------------------------------------------------------------

/**
 * 提取 EPUB 正文。返回 { text, boundaries }：
 *  - text: 按 spine 顺序拼接的纯文本
 *  - boundaries: [{offset, label}] 每章文件在 text 中的起点与文件名
 */
export function niExtractEpubText(buf) {
    let files;
    try {
        files = _parseZip(buf);
    } catch (error) {
        throw new Error(`EPUB 解析失败：${error?.message || error}`);
    }
    const names = Object.keys(files || {});
    if (!names.length) throw new Error('EPUB 解析失败：ZIP 中没有文件条目');

    const lowerMap = new Map();
    names.forEach(n => lowerMap.set(n.replace(/\\/g, '/').toLowerCase(), n));

    // 1) container.xml → rootfile
    let rootPath = '';
    const containerName = lowerMap.get('meta-inf/container.xml');
    if (containerName) {
        const xml = new TextDecoder('utf-8').decode(files[containerName]);
        const m = xml.match(/<rootfile[^>]*full-path\s*=\s*["']([^"']+)["']/i);
        if (m) rootPath = m[1].replace(/\\/g, '/');
    }

    // 2) OPF → manifest + spine 顺序
    let order = [];
    if (rootPath) {
        const opfName = lowerMap.get(rootPath.toLowerCase());
        const opf = opfName ? files[opfName] : null;
        if (opf) {
            const xml = new TextDecoder('utf-8').decode(opf);
            const dir = rootPath.slice(0, rootPath.lastIndexOf('/') + 1);
            const manifest = {};
            const itemRe = /<item\b[^>]*>/gi;
            let itemMatch;
            while ((itemMatch = itemRe.exec(xml))) {
                const tag = itemMatch[0];
                const id = (tag.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
                const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
                if (id && href) manifest[id] = href;
            }
            const idrefRe = /<itemref\b[^>]*idref\s*=\s*["']([^"']+)["']/gi;
            let refMatch;
            while ((refMatch = idrefRe.exec(xml))) {
                const href = manifest[refMatch[1]];
                if (href) order.push(dir + href.replace(/\\/g, '/'));
            }
        }
    }
    if (!order.length) {
        order = names.filter(n => /\.x?html?$/i.test(n)).sort();
    }

    // 3) 按顺序提取正文
    const parts = [];
    const boundaries = [];
    let offset = 0;
    for (const name of order) {
        const data = files[name];
        if (!data) continue;
        let html;
        try {
            html = new TextDecoder('utf-8').decode(data);
        } catch (_) {
            continue;
        }
        const text = niMobiHtmlToText(html);
        if (!text) continue;
        boundaries.push({
            offset,
            label: name.replace(/^.*\//, '').replace(/\.[^.]+$/, ''),
        });
        parts.push(text);
        offset += text.length + 2;
    }

    const text = parts.join('\n\n');
    if (!text.trim()) throw new Error('EPUB 中没有提取到可用正文');
    return { text, boundaries };
}

/** 文件扩展名 → 加料管道支持与否（TXT / Markdown / EPUB）。 */
export function niEnrichSupportedExt(fileName = '') {
    const m = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = m ? `.${m[1]}` : '';
    return ['.txt', '.md', '.markdown', '.epub'].includes(ext) ? ext : '';
}
