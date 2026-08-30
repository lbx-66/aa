// ============================================================
// 亲密行为判定引擎（加料管道 P2）
// 双模式：
//  1. 关键词模式（无需 API）：关键词 + 正则 + 权重评分，产出 score/confidence/evidence
//  2. AI 深度分析（需 API）：提示词模板构建 + JSON 响应解析（{has_intimacy, confidence, evidence}）
// 纯函数模块，可单测；队列编排在 index.js（batch-queue）。
// ============================================================

import { CHAPTER_STATUS, transitionChapter } from './chapter-system.js';

export const JUDGE_RESULT_LABELS = {
    yes: '是',
    no: '否',
    doubt: '存疑',
};

export function judgeResultLabel(result) {
    return JUDGE_RESULT_LABELS[result] || String(result || '');
}

// ------------------------------------------------------------
// 附加特征配置（非 AI 初筛增强，全部可开关）
// ------------------------------------------------------------

export const DEFAULT_SCORE_FEATURES = {
    cooccur: true,            // 共现窗口加分：窗口内不同词共现 → 额外分
    paragraph: true,          // 段落峰值：单句内不同命中 ≥3 的句子数 → 加分
    ellipsis: true,           // 省略号/括号省略写法 → 加分
    metaphorDownweight: true, // 比喻语境（像…一样/仿佛…般）内的命中剔除，防误判
    windowChars: 80,          // 共现窗口大小（字符）
};

// 比喻结构：命中词前 lookBack 内出现完整比喻结构，或 6 字内直接出现比喻词
const METAPHOR_MARKERS = ['像', '仿佛', '如同', '好似', '宛如', '犹如', '似乎', '好像'];
const METAPHOR_STRUCT_RE = /(?:像|仿佛|如同|好似|宛如|犹如|似乎|好像).{0,6}?(?:一样|一般|似的|般)/;

function metaphorAdjacent(source, start, lookBack = 12) {
    if (!source || start < 0) return false;
    const from = Math.max(0, start - lookBack);
    const ctx = source.slice(from, start);
    if (METAPHOR_STRUCT_RE.test(ctx)) return true;
    const near = source.slice(Math.max(0, start - 6), start);
    return METAPHOR_MARKERS.some(m => near.includes(m));
}

/** 共现窗口加分：窗口内不同词两两共现计数，封顶 4。 */
function cooccurrenceBonus(kept, windowChars) {
    const sorted = [...kept].sort((a, b) => a.start - b.start);
    let pairs = 0;
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            if (sorted[j].start - sorted[i].end > windowChars) break;
            if (sorted[i].label !== sorted[j].label) pairs++;
        }
    }
    return Math.min(4, pairs);
}

/** 段落峰值：单句内不同命中 ≥3 的句子每句 +1，封顶 3。 */
function paragraphPeakBonus(source, kept) {
    if (!kept.length) return 0;
    const segments = source.split(/[。！？!?\n]+/);
    let offset = 0;
    let bonus = 0;
    for (const seg of segments) {
        const segStart = offset;
        offset += seg.length + 1;
        const segEnd = offset;
        const words = new Set();
        kept.forEach(h => { if (h.start >= segStart && h.start < segEnd) words.add(h.label); });
        if (words.size >= 3) bonus++;
    }
    return Math.min(3, bonus);
}

/** 省略号/括号省略写法：连续省略号组数（封顶 2）+ 括号省略写法（+2），总封顶 3。 */
function ellipsisBonusScore(source) {
    let bonus = 0;
    const ell = (String(source || '').match(/……{2,}/g) || []).length;
    if (ell > 0) bonus += Math.min(2, ell);
    if (/(?:此处省略|以下省略|（省略)/.test(String(source || ''))) bonus += 2;
    return Math.min(3, bonus);
}

export const DEFAULT_JUDGE_RULES = {
    mode: 'keyword',          // 'keyword' | 'hybrid' | 'ai'
    // 初筛从宽：阈值 2，强信号词（吻/暧昧/调情 等权重 2+）单出即「是」；
    // 歧义词（高潮/进入/灌溉 等）已降权到 1，单出只标「可疑」，交给 AI 精判兜底
    threshold: 2,
    aiThreshold: 0.6,         // AI 模式 confidence 低于此值 → doubt
    features: { ...DEFAULT_SCORE_FEATURES },
    keywords: [
        // ── 省略/留白（FADE：强烈暗示已发生，权重 3）──
        { word: '此处省略', weight: 3 },
        { word: '省略一万字', weight: 3 },
        { word: '省略十万字', weight: 3 },
        { word: '省略百万字', weight: 3 },
        { word: '一夜无话', weight: 3 },
        { word: '一夜风流', weight: 3 },
        { word: '一夜狂欢', weight: 3 },
        { word: '春宵苦短', weight: 3 },
        { word: '大战三百回合', weight: 3 },
        { word: '懂得都懂', weight: 3 },
        { word: '关门之后', weight: 3 },
        { word: '接下来发生的事不便细说', weight: 3 },
        { word: '接下来发生的事情不便细说', weight: 3 },
        { word: '不可描述', weight: 3 },
        { word: '难以描述', weight: 3 },
        { word: '难以言喻的声音', weight: 3 },
        { word: '有词云', weight: 3 },
        { word: '只道是', weight: 1 },
        { word: '后面的事情无需多言', weight: 3 },
        { word: '接下来的事情不必多说', weight: 3 },
        { word: '不必多说什么了', weight: 3 },
        // ── 隐喻（METAPHOR：强证据，权重 3~4）──
        { word: '翻云覆雨', weight: 4 },
        { word: '颠鸾倒凤', weight: 4 },
        { word: '巫山云雨', weight: 4 },
        { word: '共赴巫山', weight: 4 },
        { word: '一番云雨', weight: 4 },
        { word: '春色无边', weight: 3 },
        { word: '春光满室', weight: 3 },
        { word: '一夜荒唐', weight: 3 },
        { word: '荒唐了一夜', weight: 3 },
        { word: '春风一度', weight: 3 },
        { word: '深入交流', weight: 3 },
        { word: '深入探讨', weight: 3 },
        { word: '交流到天亮', weight: 3 },
        { word: '折腾到天亮', weight: 3 },
        { word: '折腾了一夜', weight: 3 },
        { word: '耕耘一夜', weight: 3 },
        { word: '辛勤耕耘', weight: 3 },
        { word: '努力耕耘', weight: 3 },
        { word: '交公粮', weight: 3 },
        { word: '缴纳公粮', weight: 3 },
        { word: '打桩', weight: 3 },
        { word: '开炮', weight: 3 },
        { word: '补充魔力', weight: 3 },
        { word: '补魔', weight: 3 },
        { word: '榨干', weight: 3 },
        { word: '吃干抹净', weight: 3 },
        { word: '惩罚到天亮', weight: 3 },
        { word: '研究生命', weight: 3 },
        { word: '研究人生', weight: 3 },
        { word: '友好切磋', weight: 3 },
        { word: '切磋到天亮', weight: 3 },
        { word: '运动了一夜', weight: 3 },
        { word: '做了一夜运动', weight: 3 },
        { word: '房间里响起', weight: 3 },
        { word: '屋里响起', weight: 3 },
        { word: '卧室里响起', weight: 3 },
        { word: '狂欢场', weight: 3 },
        { word: '来回轮转', weight: 3 },
        { word: '仪式仍没有半点停歇', weight: 3 },
        { word: '仪式没有停歇', weight: 3 },
        { word: '灌溉', weight: 1 },
        { word: '滋润', weight: 1 },
        { word: '检查身体', weight: 1 },
        { word: '履行义务', weight: 1 },
        { word: '履行主人的义务', weight: 1 },
        { word: '春意盎然', weight: 1 },
        // ── 场景铺垫（SETUP：弱证据，组合判定，权重 1~2）──
        { word: '压在床上', weight: 2 },
        { word: '床上', weight: 1 },
        { word: '床榻', weight: 1 },
        { word: '浴室', weight: 1 },
        { word: '温泉', weight: 1 },
        { word: '关上门', weight: 1 },
        { word: '锁上门', weight: 1 },
        { word: '独处', weight: 1 },
        { word: '夜深人静', weight: 1 },
        { word: '是夜', weight: 1 },
        { word: '怀里', weight: 1 },
        { word: '搂住', weight: 1 },
        { word: '抱起', weight: 1 },
        // ── 前戏（FOREPLAY：中/强证据，权重 1~3）──
        { word: '唇齿纠缠', weight: 4 },
        { word: '深吻', weight: 4 },
        { word: '舔吻', weight: 3 },
        { word: '揉捏', weight: 3 },
        { word: '湿润', weight: 3 },
        { word: '前戏', weight: 3 },
        { word: '解开衣服', weight: 3 },
        { word: '褪去衣服', weight: 3 },
        { word: '衣衫滑落', weight: 3 },
        { word: '爱抚', weight: 3 },
        { word: '吻住', weight: 2 },
        { word: '吻', weight: 2 },
        { word: '亲吻', weight: 2 },
        { word: '抚摸', weight: 2 },
        { word: '挑逗', weight: 2 },
        { word: '手指', weight: 1 },
        { word: '指尖', weight: 1 },
        // ── 口部（ORAL：强证据，权重 2~4）──
        { word: '口交', weight: 4 },
        { word: '口中服侍', weight: 4 },
        { word: '吮吸', weight: 3 },
        { word: '吞吐', weight: 3 },
        { word: '含住', weight: 3 },
        { word: '咽下', weight: 2 },
        { word: '舌头', weight: 2 },
        { word: '小嘴', weight: 2 },
        { word: '埋首', weight: 2 },
        // ── 插入（PENETRATION：最强证据，权重 4）──
        { word: '插入', weight: 4 },
        { word: '抽送', weight: 4 },
        { word: '抽插', weight: 4 },
        { word: '顶送', weight: 4 },
        { word: '贯入', weight: 4 },
        { word: '交合', weight: 4 },
        { word: '交媾', weight: 4 },
        { word: '肉棒', weight: 4 },
        { word: '阴茎', weight: 4 },
        { word: '挺进', weight: 4 },
        { word: '没入', weight: 4 },
        { word: '撞入', weight: 4 },
        { word: '深入体内', weight: 4 },
        { word: '进入', weight: 1 },
        { word: '送入', weight: 1 },
        { word: '冲刺', weight: 1 },
        // ── 节奏（PACE：中证据；歧义词权重 1，定向词权重 2）──
        { word: '越来越快', weight: 1 },
        { word: '猛烈', weight: 1 },
        { word: '撞击', weight: 1 },
        { word: '起伏', weight: 1 },
        { word: '挺动', weight: 2 },
        { word: '晃腰', weight: 2 },
        { word: '律动', weight: 2 },
        { word: '加速', weight: 1 },
        { word: '节奏', weight: 1 },
        { word: '缓慢', weight: 1 },
        // ── 高潮（PEAK：中/强证据；「高潮」等歧义词权重 1，定向词权重 3~4）──
        { word: '射精', weight: 4 },
        { word: '痉挛', weight: 3 },
        { word: '喷出', weight: 3 },
        { word: '泄出', weight: 3 },
        { word: '战栗着绷紧', weight: 3 },
        // 「高潮」与「剧情高潮」歧义，权重 1 → 单独出现走 AI 精判
        { word: '高潮', weight: 1 },
        { word: '顶点', weight: 1 },
        { word: '释放', weight: 1 },
        // ── 收尾（ENDING：中证据，权重 1~3）──
        { word: '云收雨歇', weight: 3 },
        { word: '雨歇云收', weight: 3 },
        { word: '替她盖好被子', weight: 3 },
        { word: '退出来', weight: 2 },
        { word: '抽身', weight: 2 },
        { word: '相拥', weight: 2 },
        { word: '抱在怀里', weight: 2 },
        { word: '喘息片刻', weight: 2 },
        { word: '擦拭', weight: 2 },
        { word: '清理干净', weight: 2 },
        { word: '平复', weight: 1 },
        // ── 事后（AFTERMATH：强证据，权重 2~3）──
        { word: '香汗淋漓', weight: 3 },
        { word: '娇躯横陈', weight: 3 },
        { word: '娇躯铺满', weight: 3 },
        { word: '娇躯布满', weight: 3 },
        { word: '遍地娇躯', weight: 3 },
        { word: '嗓子沙哑', weight: 3 },
        { word: '床铺凌乱', weight: 3 },
        { word: '衣衫散乱', weight: 3 },
        { word: '事毕', weight: 3 },
        { word: '腿软', weight: 2 },
        { word: '双腿酸软', weight: 2 },
        { word: '不能下地', weight: 2 },
        { word: '下不了地', weight: 2 },
        { word: '扶着墙', weight: 2 },
        { word: '扶墙', weight: 2 },
        { word: '容光焕发', weight: 2 },
        { word: '神清气爽', weight: 2 },
        { word: '余韵', weight: 2 },
        { word: '狂欢之后', weight: 2 },
        { word: '相拥睡去', weight: 2 },
        { word: '一根指头都不想动', weight: 2 },
        { word: '睡到中午', weight: 2 },
        { word: '爬不起身', weight: 2 },
        { word: '一瘸一拐', weight: 2 },
        { word: '走路不稳', weight: 2 },
        { word: '浑身酸痛', weight: 2 },
        // ── 暧昧氛围 / 情感暗示（中证据，权重 1~2）──
        { word: '欲拒还迎', weight: 2 },
        { word: '脸红心跳', weight: 2 },
        { word: '欲语还休', weight: 2 },
        { word: '气息交缠', weight: 2 },
        { word: '暧昧', weight: 2 },
        { word: '调情', weight: 2 },
        { word: '勾引', weight: 2 },
        { word: '引诱', weight: 2 },
        { word: '撩拨', weight: 2 },
        { word: '心动', weight: 1 },
        { word: '悸动', weight: 1 },
        { word: '脸红', weight: 1 },
        { word: '心跳', weight: 1 },
        { word: '耳热', weight: 1 },
        { word: '喘息', weight: 1 },
        { word: '轻喘', weight: 1 },
        { word: '呢喃', weight: 1 },
        { word: '低语', weight: 1 },
        { word: '含情', weight: 1 },
        { word: '媚眼', weight: 1 },
        { word: '眼波流转', weight: 1 },
        // ── 直接接触 / 亲密场景（保留原分级）──
        { word: '耳鬓厮磨', weight: 4 },
        { word: '肌肤相亲', weight: 4 },
        { word: '春宵', weight: 4 },
        { word: '洞房', weight: 4 },
        { word: '云雨', weight: 4 },
        { word: '宽衣解带', weight: 4 },
        { word: '拥入怀中', weight: 3 },
        { word: '十指相扣', weight: 3 },
        { word: '缠绵', weight: 3 },
        { word: '交缠', weight: 3 },
        { word: '温存', weight: 3 },
        { word: '共枕而眠', weight: 3 },
        { word: '拥抱', weight: 1 },
        { word: '环抱', weight: 1 },
        { word: '抱住', weight: 1 },
        { word: '轻抚', weight: 1 },
        { word: '摩挲', weight: 1 },
        { word: '牵手', weight: 1 },
        { word: '依偎', weight: 1 },
        { word: '贴近', weight: 1 },
    ],
    regexes: [
        // 身体部位类（句中任意位置命中，gim 匹配）
        { pattern: '(?:她|他|我|你)的(?:唇|颈|锁骨|腰|背|腿|肩)', weight: 1 },
        // 亲密动作类
        { pattern: '(?:轻轻|深深|用力|贪婪|温柔)[地着]?(?:吻|抱|搂|抚|亲)', weight: 2 },
        // 气息交缠类
        { pattern: '(?:气息|呼吸|热气|吐息).{0,5}(?:扑|拂|喷|交缠|相闻)', weight: 3 },
        // 衣饰/场景类
        { pattern: '(?:宽衣|解带|褪去|半褪|衣衫.{0,3}尽)', weight: 3 },
        { pattern: '(?:春宵|洞房|云雨|翻云覆雨|颠鸾倒凤)', weight: 4 },
        // 省略写法
        { pattern: '此处省略.{0,8}字', weight: 3 },
        // 解开/褪去衣物（中间可有"她的/了"等字）
        { pattern: '(?:解开|褪去|脱去).{0,4}(?:衣服|衣衫|衣裳|外衫)', weight: 3 },
        // 一夜组合（折腾/耕耘/运动/狂欢/荒唐/交流）
        { pattern: '(?:一夜|整夜|一晚上).{0,4}(?:折腾|耕耘|运动|狂欢|荒唐|交流|缠绵)', weight: 3 },
        // 事后组合（次日 + 腿软/下不了地/扶墙/嗓子沙哑/床铺凌乱/香汗/娇躯/酸软）
        { pattern: '(?:第二天|翌日).{0,10}(?:腿软|下不了地|扶.{0,2}墙|嗓子沙哑|床铺凌乱|香汗|娇躯|酸软)', weight: 3 },
    ],
};

export const DEFAULT_JUDGE_PROMPT = `你是小说内容分析器。本任务只做一件事：判断给定章节是否包含亲密/暧昧描写，并输出结构化 JSON。不要角色扮演，不要输出分析过程。

## 判定标准（按证据强度分档，confidence 必须服从分档）

一、强证据 → has_intimacy: true，confidence 0.8~0.99
- 直接的身体接触与亲密动作：接吻、深吻、热吻、拥抱、抚摸、爱抚、依偎、十指相扣、耳鬓厮磨、肌肤相亲
- 明确的亲密场景：温存、春宵、洞房、云雨、翻云覆雨、共枕而眠
- 露骨的暧昧互动：调情、挑逗、勾引、撩拨、欲拒还迎

二、中证据 → has_intimacy: true，confidence 0.6~0.79
- 明显的暧昧氛围与情感暗示：脸红心跳、眼波流转、含情脉脉、欲语还休
- 以亲密为目的的蓄势与铺垫（靠近、低语、气息交缠、衣衫半解等）
- 上下文强烈暗示（如"这一夜很长""次日腰酸"）

三、模糊地带 → confidence 0.4~0.59（has_intimacy 可 true 可 false；插件会标记「存疑」）
- 仅出现单个弱信号词（如"脸红""心跳""暧昧"），无氛围延续与行为支撑
- 描写含糊、双关、暗示极隐晦，无法确定作者意图

四、无证据 → has_intimacy: false，confidence 0.8~0.99
- 没有任何亲密相关描写；或仅有中性接触（握手、搀扶、普通拥抱道别）

## 排除项（出现相关词也一律不判为是）
- 比喻、联想、环境描写中的泛泛用词（如"晚风像吻一样轻柔""月色暧昧"）
- 暴力、扭打、打斗中的肢体接触
- 亲属之间的正常亲密（母亲亲吻孩子的额头）
- 非爱情的"暧昧"（如"局势暧昧""态度暧昧""意味不明"）

## 输出要求
- 只输出一个 JSON 对象，禁止任何其他文字、解释或 Markdown 代码围栏。
- evidence 必须引用原文片段（用「」或引号括起原句，一两句即可），说明判定依据；不要概括复述。
- confidence 必须如实反映证据强度，服从上面四档，不得随意填写；拿不准时给 0.4~0.59。

格式：
{"has_intimacy": true或false, "confidence": 0到1的小数, "evidence": "引用原文的依据说明"}

【规则参考】
{rules}

【章节正文】
{chapter_content}`;

// 正文参与 AI 判定的最大字符数（超出截断，避免超长章节浪费 token）
export const JUDGE_AI_MAX_CHARS = 6000;

/** 取命中词/正则附近的上下文（用于证据展示）。 */
function contextAround(text, from, half = 16) {
    if (!text || from < 0) return '';
    const start = Math.max(0, from - half);
    const end = Math.min(text.length, from + half);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/**
 * 关键词模式评分（含可开关的附加特征：共现窗口/段落峰值/省略号/比喻剔除）。
 * 命中按「文本区间」收集并去重：重叠区间（如「亲吻」内部的「吻」）只保留权重最高的命中。
 * @param {string} text 章节正文
 * @param {object} rules { keywords:[{word,weight}], regexes:[{pattern,weight}], threshold, features? }
 * @param {object} opts 传 { features: false } 关闭全部附加特征；或 { features: {...} } 覆盖单项
 * @returns {{hit:boolean, score:number, threshold:number, confidence:number, hitCount:number, evidence:object[], features:object, mode:'keyword'}}
 */
export function scoreIntimacy(text, rules = {}, opts = {}) {
    const source = String(text || '');
    const threshold = Math.max(0, Number(rules.threshold) || 0);
    const keywords = Array.isArray(rules.keywords) ? rules.keywords : [];
    const regexes = Array.isArray(rules.regexes) ? rules.regexes : [];
    const MAX_HITS = 2000;
    const useFeatures = opts.features !== false;
    const featureCfg = {
        ...DEFAULT_SCORE_FEATURES,
        ...(rules.features && typeof rules.features === 'object' ? rules.features : {}),
        ...(opts.features && typeof opts.features === 'object' ? opts.features : {}),
    };
    const hits = [];

    for (const kw of keywords) {
        const word = String(kw?.word || '').trim();
        if (!word) continue;
        const weight = Math.max(0, Number(kw?.weight) || 0);
        if (weight <= 0) continue;
        let from = 0;
        while ((from = source.indexOf(word, from)) !== -1) {
            if (!(useFeatures && featureCfg.metaphorDownweight && metaphorAdjacent(source, from))) {
                hits.push({ start: from, end: from + word.length, weight, type: 'keyword', label: word });
            }
            from += word.length;
            if (hits.length >= MAX_HITS) break;
        }
        if (hits.length >= MAX_HITS) break;
    }

    for (const rx of regexes) {
        const pattern = String(rx?.pattern || '');
        if (!pattern) continue;
        const weight = Math.max(0, Number(rx?.weight) || 0);
        if (weight <= 0) continue;
        let re;
        try { re = new RegExp(pattern, 'gim'); } catch (_) { continue; }
        let m;
        while ((m = re.exec(source)) !== null) {
            const len = Math.max(1, String(m[0] || '').length);
            if (!(useFeatures && featureCfg.metaphorDownweight && metaphorAdjacent(source, m.index))) {
                hits.push({ start: m.index, end: m.index + len, weight, type: 'regex', label: pattern });
            }
            if (hits.length >= MAX_HITS) break;
        }
        if (hits.length >= MAX_HITS) break;
    }

    // 区间去重：按起点排序（同起点长区间/高权重优先），重叠时保留权重更高者
    hits.sort((a, b) => a.start - b.start || (b.end - a.end) || (b.weight - a.weight));
    const kept = [];
    for (const h of hits) {
        const prev = kept[kept.length - 1];
        if (prev && h.start < prev.end) {
            if (h.weight > prev.weight) kept[kept.length - 1] = h;
        } else {
            kept.push(h);
        }
    }

    const baseScore = kept.reduce((sum, h) => sum + h.weight, 0);
    // 附加特征加分
    const features = { cooccurBonus: 0, paragraphBonus: 0, ellipsisBonus: 0 };
    if (useFeatures) {
        if (featureCfg.cooccur) features.cooccurBonus = cooccurrenceBonus(kept, featureCfg.windowChars || 80);
        if (featureCfg.paragraph) features.paragraphBonus = paragraphPeakBonus(source, kept);
        if (featureCfg.ellipsis) features.ellipsisBonus = ellipsisBonusScore(source);
    }
    const score = Math.max(0, baseScore + features.cooccurBonus + features.paragraphBonus + features.ellipsisBonus);
    const evidence = kept.slice(0, 20).map(h => ({
        type: h.type,
        word: h.label,
        weight: h.weight,
        context: contextAround(source, h.start),
    }));
    const hit = threshold > 0 ? score >= threshold : score > 0;
    const confidence = Math.min(0.99, threshold > 0 ? score / (threshold * 2) : score > 0 ? 0.6 : 0);
    return { hit, score, threshold, confidence, hitCount: kept.length, evidence, features, mode: 'keyword' };
}

/** 规则摘要文本（注入 AI 提示词 {rules}）。 */
export function buildJudgeRulesSummary(rules = {}) {
    const parts = [];
    const keywords = (Array.isArray(rules.keywords) ? rules.keywords : [])
        .filter(k => k?.word)
        .map(k => `${k.word}（权重${k.weight ?? 1}）`);
    if (keywords.length) parts.push(`关键词：${keywords.join('、')}`);
    const regexes = (Array.isArray(rules.regexes) ? rules.regexes : [])
        .filter(r => r?.pattern)
        .map(r => `${r.pattern}（权重${r.weight ?? 1}）`);
    if (regexes.length) parts.push(`正则：${regexes.join('；')}`);
    return parts.join('\n') || '（无规则参考）';
}

/** 填充判定提示词模板：替换 {chapter_content} / {rules}，正文超长截断。 */
export function fillJudgeTemplate(template, { chapterContent = '', rulesSummary = '' } = {}) {
    const text = String(chapterContent || '');
    const truncated = text.length > JUDGE_AI_MAX_CHARS
        ? `${text.slice(0, JUDGE_AI_MAX_CHARS)}\n\n（正文过长，已截取前 ${JUDGE_AI_MAX_CHARS} 字符）`
        : text;
    return String(template || '')
        .replaceAll('{chapter_content}', truncated)
        .replaceAll('{rules}', String(rulesSummary || ''));
}

/** 构建 AI 判定的 messages（单条 system，模板已含正文）。 */
export function buildJudgeMessages(template, { chapterContent = '', rulesSummary = '' } = {}) {
    const filled = fillJudgeTemplate(template, { chapterContent, rulesSummary });
    return [{ role: 'system', content: filled }];
}

/**
 * 解析 AI 判定响应。
 * @returns {{result:'yes'|'no', confidence:number, evidence:string}}
 * @throws 响应不是有效 JSON 或缺少关键字段
 */
export function parseJudgeResponse(raw) {
    const source = String(raw || '').trim();
    if (!source) throw new Error('判定 API 返回为空');
    let cleaned = source
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
    let obj = null;
    try { obj = JSON.parse(cleaned); } catch (_) { /* 尝试提取裸 JSON */ }
    if (!obj || typeof obj !== 'object') {
        const m = source.match(/\{[\s\S]*\}/);
        if (m) {
            try { obj = JSON.parse(m[0]); } catch (_) { obj = null; }
        }
    }
    if (!obj || typeof obj !== 'object') throw new Error('判定结果不是有效 JSON');

    let has = obj.has_intimacy;
    if (has === undefined && obj.hasIntimacy !== undefined) has = obj.hasIntimacy;
    if (has === undefined && obj.result !== undefined) has = obj.result;
    let result;
    if (typeof has === 'boolean') result = has ? 'yes' : 'no';
    else if (has === 'yes' || has === 'true') result = 'yes';
    else if (has === 'no' || has === 'false') result = 'no';
    else throw new Error('判定结果缺少 has_intimacy 字段');

    const confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0));
    const evidence = String(obj.evidence || obj.reason || obj.summary || '').trim();
    return { result, confidence, evidence };
}

/** 识别"返回被长度截断"类错误（finish_reason: length / 截断）。 */
export function isTruncatedError(err) {
    const msg = String(err?.message || err || '');
    return /截断|finish_reason.{0,10}length|max_tokens/i.test(msg);
}

/**
 * 判定请求的输出上限（tokens）：每次截断重试递增翻倍，封顶 cap。
 * @param {number} truncatedCount 已发生截断的次数
 * @param {number} base 基础上限（默认 800，足够输出判定 JSON）
 * @param {number} cap 上限封顶（默认 8000）
 */
export function judgeResponseLength(truncatedCount = 0, base = 800, cap = 8000) {
    return Math.min(Math.max(1, cap), Math.max(1, base) * Math.pow(2, Math.max(0, truncatedCount)));
}

/**
 * 关键词初筛三分类（混合模式用）：
 *  - 强命中（score ≥ threshold）→ yes，直接定论，不需要 AI
 *  - 部分命中（0 < score < threshold）→ doubt + hybridPending，标记为可疑，交给 AI 精判
 *  - 完全无命中 → no，直接定论
 */
export function classifyKeywordResult(scored) {
    if (scored?.hit) return { result: 'yes', hybridPending: false };
    if ((scored?.score || 0) > 0) return { result: 'doubt', hybridPending: true };
    return { result: 'no', hybridPending: false };
}

/** 将关键词评分结果转换为章节 judge 存储格式。 */
export function keywordJudgeToStore(scored) {    return {
        result: scored.hit ? 'yes' : 'no',
        confidence: scored.confidence,
        evidence: (scored.evidence || [])
            .map(e => e.type === 'keyword' ? `「${e.word}」` : `/${e.word}/`)
            .join('、') + (scored.hitCount > 0 ? `（共 ${scored.hitCount} 处命中）` : '') || '未命中任何规则',
        mode: 'keyword',
        score: scored.score,
        hitCount: scored.hitCount || 0,
        at: Date.now(),
    };
}

/** 将 AI 解析结果写入章节（含 doubt 阈值判断），并推进状态机。 */
export function applyJudgeToChapter(chapter, parsed, { aiThreshold = 0.6, mode = 'ai' } = {}) {
    if (!chapter) return false;
    // 从待判定/失败/跳过直接落结果时，先合法推进到「判定中」
    if (chapter.status !== CHAPTER_STATUS.DETECTING && !transitionChapter(chapter, CHAPTER_STATUS.DETECTING)) {
        return false;
    }
    const isDoubt = parsed.confidence < Number(aiThreshold) || 0;
    chapter.judge = {
        result: isDoubt ? 'doubt' : parsed.result,
        confidence: parsed.confidence,
        evidence: parsed.evidence || '',
        mode,
        at: Date.now(),
    };
    delete chapter.error;
    return transitionChapter(chapter, CHAPTER_STATUS.JUDGED);
}
