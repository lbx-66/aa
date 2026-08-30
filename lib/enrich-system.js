// ============================================================
// AI 加料引擎（加料管道 P3）
// 纯函数模块：内置模板、强度说明、提示词构建、敏感词检测、加料资格判定。
// 队列编排与流式调用在 index.js（batch-queue + createProfileApiClient）。
// ============================================================

import { CHAPTER_STATUS } from './chapter-system.js';

// 参与加料的原文最大字符数（超出截断，避免超长章节浪费上下文）
export const ENRICH_AI_MAX_CHARS = 4000;

// 加料输出的最小字数要求（提示词强制要求；输出短于该值时标记 short 供 UI 提示）
export const ENRICH_MIN_CHARS = 2000;

// AI 判定"原文无可加料内容"时约定的输出标记
export const ENRICH_NO_MARKER = '无加料';

/**
 * 识别 AI 返回的"无加料"标记：
 *  - 空输出 → 视为无加料；
 *  - 短文本（≤40 字）且命中标记词（无加料/无需/无内容/N/A 等）→ 视为无加料。
 * 加料提示词要求：无内容时只输出一行「无加料」，因此长文本不会是标记。
 */
export function detectNoEnrichOutput(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (t.length > 40) return false;
    return /无(需|可|法)?加料|无需|无内容|没有.*加料|N\/?A|无$/i.test(t);
}

// 加料回传时需要剔除的"非正文"标签块名称：
// 思考/思维链/内心独白等（小此预设的 ECoT 思维链形如 <konatan_planning~>…</konatan_planning~>；
// 常见模型也会输出 <thinking>…</thinking>、<reasoning>…</reasoning> 等）。
const ENRICH_THINK_TAG = '(?:thinking|ecot|reasoning|analysis|planning|scratchpad|thought|brainstorm|konatan_planning~?|plan|思考|思维链|内心独白|思绪)';

/**
 * 过滤 AI 加料回传中的"非正文"内容（纯函数，可单测）：
 *  - 剔除成对/孤立的思考类标签块（<thinking>…</thinking>、<konatan_planning~>…</konatan_planning~> 等）；
 *  - 剔除 [思考]…[/思考] 等方括号思考块；
 *  - 去掉首尾的 ``` 代码围栏（模型偶尔误输出）；
 *  - 压缩多余空行并去除首尾空白。
 * 保留正文内容不变。
 */
export function niFilterEnrichOutput(text) {
    let t = String(text || '');
    // 成对角度标签块（跨行、可带属性）
    t = t.replace(new RegExp(`<${ENRICH_THINK_TAG}[^>]*>[\\s\\S]*?</${ENRICH_THINK_TAG}[^>]*>`, 'gi'), '');
    // 孤立的开/闭标签
    t = t.replace(new RegExp(`</?${ENRICH_THINK_TAG}[^>]*>`, 'gi'), '');
    // 方括号思考块 [思考]…[/思考] [thinking]…[/thinking]
    t = t.replace(/\[((?:思考|思维链|内心独白|thought|thinking|ecot))[^\]]*\]\s*[\s\S]*?\[\/\1\]/gi, '');
    t = t.replace(/\[\/?(?:思考|思维链|内心独白|thought|thinking|ecot)[^\]]*\]/gi, '');
    // 首尾代码围栏
    t = t.replace(/^\s*```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
    return t.replace(/\n{3,}/g, '\n\n').trim();
}

export const ENRICH_INTENSITY_LABELS = {
    light: '轻度（仅暗示）',
    medium: '中度（适度描写）',
    heavy: '重度（详细描写）',
};

export function enrichIntensityLabel(intensity) {
    return ENRICH_INTENSITY_LABELS[intensity] || ENRICH_INTENSITY_LABELS.medium;
}

const ENRICH_INTENSITY_GUIDES = {
    light: '轻度：仅加入轻微暧昧氛围与暗示，点出若有若无的情愫，不展开身体接触描写。',
    medium: '中度：适度展开身体接触与情感互动，保留文学性，描写克制但不回避。',
    heavy: '重度：详细描写身体接触与感官体验，氛围渲染充分，满足题材需要。',
};

export function enrichIntensityGuide(intensity) {
    return ENRICH_INTENSITY_GUIDES[intensity] || ENRICH_INTENSITY_GUIDES.medium;
}

export const DEFAULT_ENRICH_TEMPLATES = [
    {
        id: 'elegant',
        name: '细腻唯美',
        description: '文笔细腻，注重意境、氛围与情感流动，描写含蓄而有画面感',
        prompt: `你是一位细腻的小说润色编辑。本任务：在保留原文人物、情节、语气与叙事节奏的前提下，对指定章节进行适度扩展，融入符合要求的亲密与暧昧描写。

写作风格：{style}
描写强度：{intensity}

创作要求：
1. 以原文为基础，在情节自然衔接处扩展，不改变原有事件走向与人物设定；
2. 亲密描写服务于人物关系与情感推进，避免生硬堆砌；用细节、感官与留白营造氛围；
3. 保持原文的叙述人称与文风（古风/现代/轻松/沉重等），不突兀跳脱；
4. 只输出「加料后的情节」：即新增或扩展的亲密/暧昧内容段落，不要输出与原文重复的叙述，不要整章重写；
5. 若原文没有任何可加料的亲密/暧昧内容，只输出一行：{no_marker}；
6. 加料后的情节总字数不得少于 {min_chars} 字；除加料内容与「{no_marker}」标记外，不要输出任何解释、标题或说明。

判定参考（本章已有的亲密/暧昧内容，可在此基础上自然延伸）：
{keywords}

原文：
{chapter_content}`,
    },
    {
        id: 'subtle',
        name: '含蓄留白',
        description: '极度克制，以暗示、隐喻与留白为主，几乎不直接描写身体接触',
        prompt: `你是一位深谙留白之道的文学编辑。本任务：对指定章节做极克制的扩展，以暗示、隐喻、氛围与"未说出口的情感"为主，几乎不直接描写身体接触。

写作风格：{style}
描写强度：{intensity}

创作要求：
1. 在原文基础上做点到为止的延展：一个眼神、一次停顿、一句双关，都比直白描写更有分量；
2. 情感张力藏在克制里，留给读者想象空间；
3. 保持原文叙述人称与文风；
4. 只输出「加料后的情节」：即新增或扩展的亲密/暧昧内容段落，不要输出与原文重复的叙述，不要整章重写；
5. 若原文没有任何可加料的亲密/暧昧内容，只输出一行：{no_marker}；
6. 加料后的情节总字数不得少于 {min_chars} 字；除加料内容与「{no_marker}」标记外，不要输出任何解释、标题或说明。

判定参考（本章已有的亲密/暧昧内容）：
{keywords}

原文：
{chapter_content}`,
    },
    {
        id: 'bold',
        name: '大胆直白',
        description: '描写大胆直白、细节丰富，身体接触与感官体验刻画细致入微',
        prompt: `你是一位擅长细腻肉笔的小说编辑。本任务：对指定章节进行扩展，以直接、丰富的笔触刻画亲密接触与感官体验，满足题材需要。

写作风格：{style}
描写强度：{intensity}

创作要求：
1. 在原文基础上自然展开亲密场景，动作、触感、呼吸、情绪层层递进；
2. 保持人物性格与关系基调，描写服务于情感张力；
3. 保持原文叙述人称与文风；
4. 只输出「加料后的情节」：即新增或扩展的亲密/暧昧内容段落，不要输出与原文重复的叙述，不要整章重写；
5. 若原文没有任何可加料的亲密/暧昧内容，只输出一行：{no_marker}；
6. 加料后的情节总字数不得少于 {min_chars} 字；除加料内容与「{no_marker}」标记外，不要输出任何解释、标题或说明。

判定参考（本章已有的亲密/暧昧内容，可直接承接展开）：
{keywords}

原文：
{chapter_content}`,
    },
];

/** 段落编号标记符（加料定位锚点用，如 【¶12】）。 */
export const ENRICH_PARAGRAPH_MARK = '¶';

/**
 * 给文本逐段编号（纯函数，可单测）：按换行拆分（合并空行），每段加「【¶N】」前缀。
 * 用于加料请求：AI 看到的原文带编号，回传时用「【¶N】」引用插入位置。
 * 注意：与 mergeEnrichSegments 的拆分规则必须一致（都是 split(/\r?\n+/) + 去空行）。
 */
export function niNumberEnrichParagraphs(text) {
    const paragraphs = String(text || '').split(/\r?\n+/).map(p => p.trim()).filter(p => p.length > 0);
    return paragraphs.map((p, i) => `【${ENRICH_PARAGRAPH_MARK}${i + 1}】${p}`).join('\n\n');
}

/** 模板占位变量填充：{chapter_content} / {keywords} / {style} / {intensity} / {no_marker} / {min_chars}，正文超长截断并逐段编号。 */
export function fillEnrichTemplate(template, { chapterContent = '', keywords = '', style = '', intensity = '', minChars = ENRICH_MIN_CHARS } = {}) {
    const text = String(chapterContent || '');
    const truncated = text.length > ENRICH_AI_MAX_CHARS
        ? `${text.slice(0, ENRICH_AI_MAX_CHARS)}\n\n（原文过长，已截取前 ${ENRICH_AI_MAX_CHARS} 字符）`
        : text;
    return String(template || '')
        .replaceAll('{chapter_content}', niNumberEnrichParagraphs(truncated))
        .replaceAll('{keywords}', String(keywords || ''))
        .replaceAll('{style}', String(style || ''))
        .replaceAll('{intensity}', String(intensity || ''))
        .replaceAll('{no_marker}', ENRICH_NO_MARKER)
        .replaceAll('{min_chars}', String(minChars));
}

/**
 * 构建加料 messages（单条 system，模板已含原文与要求）。
 * 末尾强制追加「输出规范」，保证即使模板来自旧版本（用户已保存的自定义模板）
 * 也遵守：只输出加料后的情节（带段落编号锚点）/ 无内容输出「无加料」标记 / 不少于 minChars 字。
 */
export function buildEnrichMessages(template, { chapterContent = '', keywords = '', style = '', intensity = '', minChars = ENRICH_MIN_CHARS } = {}) {
    const filled = fillEnrichTemplate(template, { chapterContent, keywords, style, intensity, minChars });
    const outputSpec = [
        '【输出规范（必须遵守）】',
        `1. 只输出「加料后的情节」：即新增或扩展的亲密/暧昧内容段落；不要输出与原文重复的叙述，不要整章重写；`,
        `2. 每条加料内容单独成段，并以「【${ENRICH_PARAGRAPH_MARK}段落号】」开头，段落号必须是上面原文中该内容承接/扩展的段落编号（例如【${ENRICH_PARAGRAPH_MARK}12】加料内容……）；`,
        `3. 若原文没有任何可加料的亲密/暧昧内容，只输出一行：${ENRICH_NO_MARKER}；`,
        `4. 加料后的情节总字数不得少于 ${minChars} 字；`,
        `5. 除加料内容、「${ENRICH_NO_MARKER}」标记与段落编号外，不要输出任何解释、标题或说明。`,
    ].join('\n');
    return [{ role: 'system', content: `${filled}\n\n${outputSpec}` }];
}

/**
 * 强制字数补足指令（生成不足最低字数时，追加为第二轮 user 消息）：
 * 要求 AI 在已有加料内容基础上继续扩展，使总字数达标；只输出补充部分。
 */
export function buildEnrichShortfallInstruction(addedLen, minChars) {
    return `【字数补足要求（必须遵守）】
上一轮生成的加料情节仅 ${addedLen} 字，未达到最低要求 ${minChars} 字。
请在已有加料内容的基础上继续扩展描写（也可在原文中寻找更多可加料的位置），使加料后的情节总字数不少于 ${minChars} 字。
只输出本次补充/扩展的加料情节，每条单独成段并以「【${ENRICH_PARAGRAPH_MARK}段落号】」开头（段落号指向上文原文中承接的位置）；不要再重复输出上一轮已有的内容，也不要输出任何解释或说明。`;
}

/**
 * 解析 AI 回传的加料段落（纯函数，可单测）：
 * 从「【¶N】内容…」形式中提取 { paragraph, content } 列表；
 * 兼容 【¶12】 / 【¶ 12】 / ¶12 / 【段12】 等写法；无编号条目则返回 []（调用方按整段兜底处理）。
 */
export function niParseEnrichSegments(output) {
    // 先归一化无括号写法（裸 ¶7 → 【¶7】；已带括号的不动），再统一解析
    const text = String(output || '').replace(/(?<!【)¶\s*(\d+)(?!】)/g, `【${ENRICH_PARAGRAPH_MARK}$1】`);
    if (!text.trim()) return [];
    const segments = [];
    const re = /【\s*[¶P段]\s*(\d+)\s*】\s*([\s\S]*?)(?=【\s*[¶P段]\s*\d+\s*】|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const content = String(m[2] || '').trim();
        if (!content) continue;
        segments.push({ paragraph: Number(m[1]), content });
    }
    return segments;
}

/** 段落拆分（与 niNumberEnrichParagraphs 一致的规则：按换行拆分、去空段）。 */
function niSplitParagraphs(text) {
    return String(text || '').split(/\r?\n+/).map(p => p.trim()).filter(p => p.length > 0);
}

/**
 * 将加料段落无缝回填原文（纯函数，可单测）：
 *  - 与 niNumberEnrichParagraphs 相同的段落拆分规则；
 *  - 每条加料内容作为**新段落**插到对应编号原文段之后（多段按编号升序、保持输出顺序）；
 *  - 编号越界/不存在的段落 → 走兜底：优先插到含 seamKeywords 的最后一段之后，否则追加到末尾；
 *  - 完全没有编号条目（AI 没按格式）→ 整个输出作为一段，走同样的兜底。
 * @param {string} original 原文
 * @param {Array} segments [{paragraph:number, content:string}]
 * @param {object} opts { seamKeywords?: string[] } 兜底定位关键词（可用判定证据里的词）
 * @returns {{ text:string, matched:Array, unmatched:Array, status:'ok'|'partial'|'manual' }}
 */
export function mergeEnrichSegments(original, segments, { seamKeywords = [] } = {}) {
    const parts = niSplitParagraphs(original);
    const list = (Array.isArray(segments) ? segments : []).map(s => ({
        paragraph: Number(s?.paragraph) || 0,
        content: String(s?.content || '').trim(),
    })).filter(s => s.content);
    if (!list.length) {
        return { text: String(original || ''), matched: [], unmatched: [], status: 'manual' };
    }

    const byPara = new Map();
    for (const s of list) {
        if (!byPara.has(s.paragraph)) byPara.set(s.paragraph, []);
        byPara.get(s.paragraph).push(s);
    }

    // 兜底插入点：含 seamKeywords 的最后一段之后
    let seamIdx = -1;
    const kw = (Array.isArray(seamKeywords) ? seamKeywords : []).filter(k => String(k || '').trim());
    if (kw.length) {
        parts.forEach((p, i) => { if (kw.some(k => p.includes(k))) seamIdx = i; });
    }

    const matched = [];
    const out = [];
    for (let i = 0; i < parts.length; i++) {
        out.push(parts[i]);
        const segs = byPara.get(i + 1) || [];
        for (const s of segs) {
            out.push(s.content);
            matched.push(s);
        }
    }

    const matchedSet = new Set(matched);
    const unmatched = list.filter(s => !matchedSet.has(s));
    if (unmatched.length) {
        let insertAt = out.length; // 默认末尾
        if (seamIdx >= 0) {
            let segCountBefore = 0;
            for (let i = 0; i <= seamIdx; i++) segCountBefore += (byPara.get(i + 1) || []).length;
            insertAt = (seamIdx + 1) + segCountBefore;
        }
        out.splice(insertAt, 0, ...unmatched.map(s => s.content));
    }

    const status = !unmatched.length ? 'ok' : (matched.length ? 'partial' : 'manual');
    return { text: out.join('\n\n'), matched, unmatched, status };
}

/** 从判定结果生成关键词摘要（注入模板 {keywords}）。 */
export function buildEnrichKeywordsSummary(judge) {
    if (!judge) return '（无）';
    if (judge.mode === 'keyword' || judge.mode === 'keyword-hybrid') {
        return judge.evidence || '（关键词命中）';
    }
    if (judge.mode === 'ai' && judge.evidence) {
        return `判定结果：${judge.result === 'yes' ? '是' : judge.result === 'doubt' ? '存疑' : '否'}。依据：${judge.evidence}`;
    }
    return '（无）';
}

/**
 * 敏感词检测：返回第一个命中 { hit, word, index }，未命中返回 null。
 * 用于生成前预检与生成后复检。
 */
export function checkSensitive(text, sensitiveWords) {
    const source = String(text || '');
    const words = Array.isArray(sensitiveWords) ? sensitiveWords : [];
    for (const raw of words) {
        const word = String(raw || '').trim();
        if (!word) continue;
        const idx = source.indexOf(word);
        if (idx >= 0) return { hit: true, word, index: idx };
    }
    return null;
}

/**
 * 加料资格：
 *  - 被过滤章节/加料中的章节不可加料；
 *  - 人工标记「不通过」默认禁止（除非手动解锁 _enrichUnlocked）；
 *  - 人工标记「通过」永远放行；
 *  - 其余按判定结果：yes / doubt 可加料（场景引擎的「安全否决」不在其中，天然不可加料）。
 */
export function canEnrichChapter(ch) {
    if (!ch || ch.filtered) return false;
    if (ch.status === CHAPTER_STATUS.ENRICHING) return false;
    if (ch.flag === 'fail' && !ch._enrichUnlocked) return false;
    if (ch.flag === 'pass') return true;
    return !!ch.judge && ['yes', 'doubt'].includes(ch.judge.result);
}
