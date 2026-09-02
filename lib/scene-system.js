// ============================================================
// 场景分析引擎（判定逻辑移植自 Auto Scene 3.5 纯加料器.py）
// 纯函数模块，无外部依赖：
//   场景词库（照搬 Python 原版）→ 阶段分类 → 段落聚类 → 窗口补全决策
//   → 安全否决 → 1v1~1vN 模式识别 → 全书 R18 画像
// 供 judge-system.js（关键词判定）与 enrich-system.js（加料提示词）使用。
// ============================================================

// ------------------------------------------------------------
// 词库（照搬 Python 原版，勿随意增删——判定语义与其对齐）
// ------------------------------------------------------------

export const FADE_TERMS = [
    '此处省略', '省略一万字', '省略十万字', '省略百万字', '一夜无话',
    '一夜风流', '一夜狂欢', '春宵苦短', '大战三百回合', '懂得都懂',
    '关门之后', '接下来发生的事不便细说', '接下来发生的事情不便细说',
    '不可描述', '难以描述', '难以言喻的声音', '有词云', '只道是',
    '后面的事情无需多言', '接下来的事情不必多说', '不必多说什么了'
];

export const METAPHOR_TERMS = [
    '翻云覆雨', '颠鸾倒凤', '巫山云雨', '共赴巫山', '春风一度', '春意盎然',
    '深入交流', '深入探讨', '交流到天亮', '折腾到天亮', '折腾了一夜',
    '耕耘一夜', '辛勤耕耘', '努力耕耘', '交公粮', '缴纳公粮', '打桩',
    '开炮', '补充魔力', '补魔', '灌溉', '滋润', '榨干', '吃干抹净',
    '惩罚到天亮', '检查身体', '履行义务', '履行主人的义务', '研究生命',
    '研究人生', '友好切磋', '切磋到天亮', '运动了一夜', '做了一夜运动',
    '房间里响起', '屋里响起', '卧室里响起', '狂欢场', '来回轮转',
    '仪式仍没有半点停歇', '仪式没有停歇', '一夜荒唐', '荒唐了一夜',
    '一番云雨', '云收雨歇', '雨歇云收', '春色无边', '春光满室'
];

export const SETUP_TERMS = [
    '卧室', '房间', '床上', '床榻', '浴室', '温泉', '关上门', '锁上门',
    '独处', '夜深人静', '是夜', '深夜', '怀里', '搂住', '抱起', '压在床上'
];

export const FOREPLAY_TERMS = [
    '亲吻', '吻住', '深吻', '抚摸', '揉捏', '湿润', '前戏',
    '挑逗', '舔吻', '爱抚', '解开衣服', '褪去衣服', '衣衫滑落'
];

export const ORAL_TERMS = ['口交', '含住', '吞吐', '吮吸', '咽下', '舌头', '小嘴', '埋首', '口中服侍'];

export const PENETRATION_TERMS = [
    '插入', '抽送', '抽插', '顶送', '贯入', '交合', '交媾',
    '肉棒', '阴茎', '挺进', '没入', '撞入', '深入体内'
];

export const PACE_TERMS = ['越来越快', '猛烈', '撞击', '起伏', '挺动', '晃腰', '律动'];

export const PEAK_TERMS = ['痉挛', '射精', '喷出', '泄出', '战栗着绷紧'];

export const ENDING_TERMS = [
    '退出来', '抽身', '相拥', '抱在怀里', '睡去', '平复',
    '喘息片刻', '擦拭', '清理干净', '替她盖好被子', '云收雨歇', '雨歇云收'
];

// 高频歧义词：日常文本极常见（敲键盘/指路/退界面/剧情高潮等），
// 单独出现不能作为场景证据——不参与窗口候选与评分，仅作弱信号展示。
// （曾误报案例：手指→敲代码/指路/护肤，退出/停下→退银行界面/停下键盘）
export const AMBIGUOUS_TERMS = [
    '手指', '指尖',           // 前戏（日常高频：指路/敲键盘/护肤）
    '进入', '冲刺', '送入',   // 插入（进入房间/冲刺高考/送入考场）
    '加速', '节奏', '缓慢',   // 节奏（日常高频）
    '高潮', '顶点', '释放',   // 高潮（剧情高潮/顶点平台/释放压力）
    '退出', '停下',           // 结尾（退出界面/停下脚步）
];

export const AFTERMATH_TERMS = [
    '第二天', '翌日', '腿软', '双腿酸软', '不能下地', '下不了地', '扶墙',
    '容光焕发', '神清气爽', '事毕', '余韵', '狂欢之后', '相拥睡去',
    '一根指头都不想动', '睡到中午', '嗓子沙哑', '床铺凌乱', '衣衫散乱',
    '香汗淋漓', '娇躯横陈', '娇躯铺满', '娇躯布满', '遍地娇躯',
    '爬不起身', '一瘸一拐', '走路不稳', '浑身酸痛'
];

// 明确未成年或身体年龄模糊标记。"少女"单独不构成否决（与原版一致）。
export const MINOR_TERMS = [
    '未成年', '幼女', '女童', '小学生', '初中生', '小学女生', '初中女生',
    '十七岁', '十六岁', '十五岁', '十四岁', '十三岁', '十二岁', '十一岁',
    '十岁', '九岁', '八岁', '七岁', '六岁', '五岁', '小女孩', '小姑娘还是孩子',
    '儿童身体', '孩子的身体', '小孩子的身体', '幼小身体'
];

export const NONCONSENT_TERMS = [
    '强奸', '强暴', '迷药', '下药', '昏迷不醒', '失去意识', '哭喊求救',
    '明确拒绝', '拼命反抗', '被迫发生关系', '强迫发生关系'
];

export const MULTI_MALE_TERMS = ['众男', '多个男人', '几个男人轮流', '男人们轮流', '一女多男', '多人轮奸'];

export const ROLE_TERMS = [
    '夫人', '太太', '太后', '皇后', '女王', '女皇', '圣女', '妻子', '新娘',
    '未亡人', '母亲', '妈妈', '阿姨', '姑姑', '大姐姐', '御姐', '妃子',
    '姬妾', '少妇', '娘娘', '女神', '天使', '天使长', '女仆长', '精灵女王',
    '女精灵', '猫女', '狐女', '魅魔', '修女', '寡妇', '女医生', '女教师'
];

export const GROUP_TERMS = {
    '1vN': [
        '众女', '女人们', '夫人们', '美人们', '天使们', '魅魔们', '妻妾们',
        '众多女人', '数十名', '上百名', '一大群女人', '一群美人', '成群的女人',
        '娇躯铺满', '娇躯布满', '娇躯横陈', '遍地娇躯', '人群与香汗间来回轮转',
        '狂欢场', '应有尽有', '一个接一个', '轮番上阵', '轮流侍奉'
    ],
    // 1vX 的 X 是女性人数而非现场总人数；普通「二人/三人/四人」不直接作证据。
    '1v4': ['四女', '四位女性', '四姐妹', '四个女人', '五人一起'],
    '1v3': ['三女', '三位女性', '三姐妹', '三凤', '三个女人', '四人一起'],
    '1v2': ['两女', '二女', '两位女性', '姐妹二人', '母女二人', '母女俩', '双姝', '两姐妹', '二乔', '三人一起']
};

export const GROUP_ROLE_LEXEMES = [
    '猫女', '天使', '堕天使', '月兔', '奶牛娘', '白羊族少女', '暗夜精灵',
    '花妖', '元素精灵', '龙族少女', '狐女', '魅魔', '女仆', '修女', '夫人',
    '人妻', '女神', '精灵', '龙女', '兔女', '蛇女', '妖女', '仙女'
];

export const FIRST_TIME_TERMS = ['第一次', '初次', '初夜', '处子', '处女', '完璧', '未经人事', '从未被男人', '破瓜', '生涩', '首次', '初红'];

// 字面义否决词：隐喻词出现在农田/战场/工地等字面语境时降权，防误判。
export const LITERAL_VETO_TERMS = [
    '农田', '庄稼', '耕田', '种田', '播种粮食', '插秧', '收割', '麦田', '稻田',
    '战场', '军队', '士兵', '攻城', '行军', '训练场', '练剑', '练拳', '修炼功法',
    '施工', '地基', '打地基', '建筑工地', '锻造', '打铁', '发动机', '矿井', '开采矿石'
];

export const SCENE_STAGE_LABELS = {
    fade: '省略/留白',
    metaphor: '隐喻',
    setup: '场景铺垫',
    foreplay: '前戏',
    oral: '口部',
    penetration: '插入',
    pace: '节奏',
    peak: '高潮',
    ending: '结尾',
    aftermath: '事后',
    weak: '弱信号(歧义词)',
};

export const DECISION_LABELS = {
    skip_complete_existing: '场景已完整，无需补充',
    skip_existing_dense: '高R18书：场景已密集，跳过',
    insert_full_scene: '省略/隐喻处：补全完整场景',
    insert_before_aftermath: '事后描写前：补全完整场景',
    append_missing_peak_and_ending: '插入后缺高潮与结尾：续写',
    append_missing_ending: '高潮后缺结尾：补结尾',
    append_after_foreplay: '前戏后缺推进：续写',
    skip_no_clear_gap: '无明确缺口',
    skip_safety_veto: '安全否决',
};

export const COMPLETION_LABELS = {
    full: '完整场景',
    tail_after_penetration: '插入后的高潮+结尾',
    ending_only: '仅结尾',
    after_foreplay: '前戏后的推进',
};

export const SAFETY_REASON_LABELS = {
    mc_body_not_adult_in_this_chapter: '该章不在成年身体允许范围',
    excluded_or_underage_character: '命中排除/未成年名单角色',
    minor_or_age_ambiguous: '未成年或年龄模糊标记',
    nonconsent: '非自愿内容',
    multiple_male_participants: '多人（男）参与',
    no_confirmed_adult_female_participant: '无确认成年女性参与者',
    no_named_participant: '无具名参与者',
};

// ------------------------------------------------------------
// 场景配置（与原版 config.json 对齐；插件侧默认值）
// ------------------------------------------------------------

export const DEFAULT_SCENE_CONFIG = {
    // 全书 R18 画像
    r18_chapter_score: 8,        // 单章显式场景分达到该值计为 R18 章
    r18_chapter_ratio: 0.08,     // R18 章占比 ≥ 该值 → high_r18
    r18_hits_per_10k: 2.5,       // 每万字显式命中 ≥ 该值 → high_r18
    // 窗口聚类
    maximum_paragraph_gap: 3,    // 候选段间隔 ≤ 该值合并为同一场景窗口
    context_paragraphs_before: 3,// 窗口前扩段落数
    context_paragraphs_after: 3, // 窗口后扩段落数
    // 窗口分类
    complete_scene_score: 10,    // 场景分 ≥ 该值且有核心+结尾 → 视为已完整
    dense_scene_score: 8,        // 场景分 ≥ 该值且有核心 → 视为密集
    allow_partial_completion: true, // 允许部分补全（只补高潮/结尾等尾巴）
    // 安全否决
    allowed_chapter_ranges: [],  // 允许的成年身体章节区间，空 = 全部允许
    adult_body_override_in_allowed_ranges: false, // 允许区间内忽略未成年词
    adult_female_allowlist: [],  // 确认成年女性参与者名单；非空时窗口必须命中其一
    require_named_participant: false, // 是否要求具名参与者（1vN 群体可豁免）
    excluded_names: [],          // 排除名单（命中即否决）
    safetyVetoEnabled: true,     // 安全否决总开关（未成年/非自愿/多人男/排除名单）；false = 关闭词法否决
    // 名字提取（供 1v1~1vN 模式识别）
    female_names: [],            // 手动女主名单
    aliases: {},                 // 别名映射 {原名: 规范名}
    auto_extract_female_names: true, // 自动提取女主名字
    auto_name_limit: 120,
    enable_role_name_fallback: false, // 无名字时按人设词兜底
    mc_name: '主角',
    // 批量场景扫描（一次 AI 调用扫描 N 章）
    batch_chapters_per_call: 10,     // 每批章数
    batch_max_chars_per_chapter: 1200, // 每章打包给 AI 的场景材料上限（字符）
};

// ------------------------------------------------------------
// 基础工具
// ------------------------------------------------------------

function niNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** 子串命中：返回词表中所有出现在 text 中的词条（与原版 hits 一致）。 */
export function hits(text, terms) {
    const source = String(text || '');
    return (Array.isArray(terms) ? terms : []).filter(t => t && source.includes(t));
}

// ------------------------------------------------------------
// 阶段分类与打分（原版 stage_map / metaphor_score / explicit_score）
// ------------------------------------------------------------

export function stageMap(text) {
    return {
        fade: hits(text, FADE_TERMS),
        metaphor: hits(text, METAPHOR_TERMS),
        foreplay: hits(text, FOREPLAY_TERMS),
        oral: hits(text, ORAL_TERMS),
        penetration: hits(text, PENETRATION_TERMS),
        pace: hits(text, PACE_TERMS),
        peak: hits(text, PEAK_TERMS),
        ending: hits(text, ENDING_TERMS),
        aftermath: hits(text, AFTERMATH_TERMS),
        weak: hits(text, AMBIGUOUS_TERMS), // 高频歧义词：仅展示，不参与候选/评分/决策
    };
}

/** 隐喻场景打分（含字面义否决扣分）。 */
export function metaphorScore(text) {
    const metaphorHits = hits(text, METAPHOR_TERMS);
    const setupHits = hits(text, SETUP_TERMS);
    const aftermathHits = hits(text, AFTERMATH_TERMS);
    const adultRoleHits = hits(text, ROLE_TERMS);
    const vetoHits = hits(text, LITERAL_VETO_TERMS);
    let score = Math.min(12, metaphorHits.length * 3)
        + Math.min(4, setupHits.length)
        + Math.min(6, aftermathHits.length * 2)
        + Math.min(3, adultRoleHits.length);
    if (vetoHits.length && !aftermathHits.length && metaphorHits.length <= 1) score -= 8;
    return {
        score,
        metaphorHits,
        setupHits,
        aftermathHits,
        adultRoleHits,
        literalVetoHits: vetoHits,
        highConfidence: score >= 7 && metaphorHits.length > 0
            && (setupHits.length > 0 || aftermathHits.length > 0 || metaphorHits.length >= 2),
    };
}

const EXPLICIT_WEIGHTS = { foreplay: 1, oral: 2, penetration: 3, pace: 1, peak: 3, ending: 2, aftermath: 1 };

/** 显式场景加权分（每类命中数封顶 3，与原版一致）。 */
export function explicitScore(stages) {
    let total = 0;
    for (const [name, weight] of Object.entries(EXPLICIT_WEIGHTS)) {
        const arr = (stages && stages[name]) || [];
        total += weight * Math.min(3, arr.length);
    }
    return total;
}

// ------------------------------------------------------------
// 段落与窗口聚类（原版 split_paragraphs / candidate_paragraph / cluster_candidates）
// ------------------------------------------------------------

export function splitParagraphs(text) {
    const source = String(text || '');
    const out = [];
    const re = /[^\n]+(?:\n+|$)/g;
    let m;
    let index = 0;
    while ((m = re.exec(source)) !== null) {
        const txt = m[0].trim();
        if (txt) out.push({ index: index++, start: m.index, end: m.index + m[0].length, text: txt });
    }
    return out;
}

/** 段落级候选：命中任一阶段词（省略/隐喻/前戏/口部/插入/节奏/高潮/结尾/事后）。 */
export function candidateParagraph(text) {
    const source = String(text || '');
    return FADE_TERMS.some(t => source.includes(t))
        || METAPHOR_TERMS.some(t => source.includes(t))
        || AFTERMATH_TERMS.some(t => source.includes(t))
        || FOREPLAY_TERMS.some(t => source.includes(t))
        || ORAL_TERMS.some(t => source.includes(t))
        || PENETRATION_TERMS.some(t => source.includes(t))
        || PEAK_TERMS.some(t => source.includes(t))
        || ENDING_TERMS.some(t => source.includes(t));
}

/**
 * 场景窗口聚类：候选段按最大间隔合并成窗口，再前后扩上下文。
 * @returns {Array<{paragraphIndexes:number[], start:number, end:number, scope:string, anchor:string}>}
 */
export function clusterCandidates(text, config = {}) {
    const paragraphs = splitParagraphs(text);
    const indexes = paragraphs.map((p, i) => candidateParagraph(p.text) ? i : -1).filter(i => i >= 0);
    if (!indexes.length) return [];
    const maxGap = Math.max(0, niNum(config.maximum_paragraph_gap, DEFAULT_SCENE_CONFIG.maximum_paragraph_gap));
    const groups = [];
    let current = [indexes[0]];
    for (const idx of indexes.slice(1)) {
        if (idx - current[current.length - 1] <= maxGap) {
            current.push(idx);
        } else {
            groups.push(current);
            current = [idx];
        }
    }
    groups.push(current);
    const before = Math.max(0, niNum(config.context_paragraphs_before, DEFAULT_SCENE_CONFIG.context_paragraphs_before));
    const after = Math.max(0, niNum(config.context_paragraphs_after, DEFAULT_SCENE_CONFIG.context_paragraphs_after));
    return groups.map(group => {
        const lo = Math.max(0, Math.min(...group) - before);
        const hi = Math.min(paragraphs.length, Math.max(...group) + after + 1);
        const core = paragraphs.slice(Math.min(...group), Math.max(...group) + 1);
        return {
            paragraphIndexes: group,
            start: core[0].start,
            end: core[core.length - 1].end,
            scope: paragraphs.slice(lo, hi).map(p => p.text).join('\n'),
            anchor: core.map(p => p.text).join('\n'),
        };
    });
}

// ------------------------------------------------------------
// 全书 R18 画像（原版 detect_book_profile）
// ------------------------------------------------------------

export function detectBookProfile(chapterTexts, config = {}) {
    const chapters = Array.isArray(chapterTexts) ? chapterTexts : [];
    let explicitChapters = 0;
    let metaphorChapters = 0;
    let totalHits = 0;
    const totalChars = chapters.reduce((s, t) => s + String(t || '').length, 0) || 1;
    for (const t of chapters) {
        const source = String(t || '');
        const stages = stageMap(source);
        const score = explicitScore(stages);
        const mscore = metaphorScore(source);
        totalHits += ['foreplay', 'oral', 'penetration', 'pace', 'peak', 'ending']
            .reduce((s, k) => s + (stages[k] || []).length, 0);
        if (score >= niNum(config.r18_chapter_score, DEFAULT_SCENE_CONFIG.r18_chapter_score)) explicitChapters++;
        if (mscore.highConfidence) metaphorChapters++;
    }
    const ratio = explicitChapters / Math.max(1, chapters.length);
    const per10k = totalHits * 10000 / totalChars;
    const high = ratio >= niNum(config.r18_chapter_ratio, DEFAULT_SCENE_CONFIG.r18_chapter_ratio)
        || per10k >= niNum(config.r18_hits_per_10k, DEFAULT_SCENE_CONFIG.r18_hits_per_10k);
    return {
        profile: high ? 'high_r18' : 'normal',
        explicitChapterRatio: Math.round(ratio * 10000) / 10000,
        explicitHitsPer10kChars: Math.round(per10k * 10000) / 10000,
        explicitChapters,
        metaphorChapters,
        totalChapters: chapters.length,
    };
}

// ------------------------------------------------------------
// 窗口补全决策（原版 classify_window）
// ------------------------------------------------------------

export function classifyWindow(text, bookProfile = 'normal', config = {}) {
    const stages = stageMap(text);
    const score = explicitScore(stages);
    const mscore = metaphorScore(text);
    const hasCore = Boolean(stages.oral.length || stages.penetration.length);
    const complete = Boolean(
        (stages.penetration.length && stages.peak.length && stages.ending.length) ||
        (stages.oral.length && stages.peak.length && stages.ending.length) ||
        (score >= niNum(config.complete_scene_score, DEFAULT_SCENE_CONFIG.complete_scene_score)
            && hasCore && stages.ending.length)
    );
    const dense = score >= niNum(config.dense_scene_score, DEFAULT_SCENE_CONFIG.dense_scene_score) && hasCore;
    const hardGap = Boolean(stages.fade.length) || mscore.highConfidence;
    const onlyGap = hardGap && !hasCore && !stages.peak.length;
    const aftermathWithoutCore = Boolean(stages.aftermath.length) && !hasCore && !stages.peak.length;
    const penetrationMissingTail = Boolean(stages.penetration.length) && !stages.peak.length && !stages.ending.length;
    const peakMissingEnding = Boolean(stages.peak.length) && !stages.ending.length;
    const allowPartial = config.allow_partial_completion !== false;

    let decision;
    let completionMode;
    if (complete) {
        decision = 'skip_complete_existing'; completionMode = null;
    } else if (bookProfile === 'high_r18' && dense && !hardGap && !stages.aftermath.length) {
        decision = 'skip_existing_dense'; completionMode = null;
    } else if (onlyGap) {
        decision = 'insert_full_scene'; completionMode = 'full';
    } else if (aftermathWithoutCore && (hardGap || mscore.score >= 4)) {
        decision = 'insert_before_aftermath'; completionMode = 'full';
    } else if (penetrationMissingTail && (hardGap || stages.aftermath.length || allowPartial)) {
        decision = 'append_missing_peak_and_ending'; completionMode = 'tail_after_penetration';
    } else if (peakMissingEnding && allowPartial) {
        decision = 'append_missing_ending'; completionMode = 'ending_only';
    } else if (stages.foreplay.length && !stages.penetration.length && hardGap) {
        decision = 'append_after_foreplay'; completionMode = 'after_foreplay';
    } else {
        decision = 'skip_no_clear_gap'; completionMode = null;
    }
    return {
        decision,
        completionMode,
        stages,
        metaphor: mscore,
        explicitScore: score,
        completeExisting: complete,
        denseExisting: dense,
    };
}

// ------------------------------------------------------------
// 安全否决（原版 safety_reason）
// ------------------------------------------------------------

function chapterAllowed(chapterNumber, config) {
    const ranges = config.allowed_chapter_ranges || [];
    if (!ranges.length) return true;
    const num = niNum(chapterNumber, 0);
    return ranges.some(pair => Array.isArray(pair) && pair.length === 2
        && niNum(pair[0], 0) <= num && num <= niNum(pair[1], 0));
}

export function safetyReason(text, chapterNumber = 0, names = [], config = {}) {
    const source = String(text || '');
    if (!chapterAllowed(chapterNumber, config)) return 'mc_body_not_adult_in_this_chapter';

    const excluded = config.excluded_names || [];
    const foundExcluded = excluded.filter(t => t && source.includes(t));
    if (foundExcluded.length) return 'excluded_or_underage_character:' + foundExcluded.slice(0, 10).join('|');

    const foundMinor = hits(source, MINOR_TERMS);
    const adultOverride = Boolean(config.adult_body_override_in_allowed_ranges && chapterAllowed(chapterNumber, config));
    if (foundMinor.length && !adultOverride) return 'minor_or_age_ambiguous:' + foundMinor.slice(0, 10).join('|');

    const foundNc = hits(source, NONCONSENT_TERMS);
    if (foundNc.length) return 'nonconsent:' + foundNc.slice(0, 10).join('|');

    const foundMm = hits(source, MULTI_MALE_TERMS);
    if (foundMm.length) return 'multiple_male_participants:' + foundMm.slice(0, 10).join('|');

    const allowlist = config.adult_female_allowlist || [];
    if (allowlist.length && !allowlist.some(name => source.includes(name))) {
        return 'no_confirmed_adult_female_participant';
    }
    if (config.require_named_participant && !names.length) {
        // 强证据的 1vN 群体可由集体角色代表，无需具名；显式成年名单激活时不豁免。
        const group = largeGroupEvidence(text);
        const unnamedAdultGroup = Boolean(
            !allowlist.length
            && group.is1vN
            && (
                group.enumeratedRoleCount >= 3
                || group.roleLexemes.length >= 3
                || (group.strongBodyField && group.rotational)
            )
        );
        if (!unnamedAdultGroup) return 'no_named_participant';
    }
    return null;
}

// ------------------------------------------------------------
// 模式识别（原版 large_group_evidence / resolve_mode）
// ------------------------------------------------------------

export function largeGroupEvidence(text) {
    const source = String(text || '');
    const direct = hits(source, GROUP_TERMS['1vN']);
    const lexemes = hits(source, GROUP_ROLE_LEXEMES);
    // 枚举句式：猫女、天使、堕天使、月兔…（顿号分隔的连续人设词）
    let enumMax = 0;
    const enumRe = /[\u4e00-\u9fff·]{1,8}(?:、[\u4e00-\u9fff·]{1,8}){2,}/g;
    let m;
    while ((m = enumRe.exec(source)) !== null) {
        const count = GROUP_ROLE_LEXEMES.filter(t => m[0].includes(t)).length;
        if (count > enumMax) enumMax = count;
    }
    const strongBodyField = ['娇躯铺满', '娇躯布满', '娇躯横陈', '遍地娇躯'].some(t => source.includes(t));
    const rotational = ['来回轮转', '轮番上阵', '一个接一个', '轮流侍奉'].some(t => source.includes(t));
    return {
        directHits: direct,
        roleLexemes: lexemes,
        enumeratedRoleCount: enumMax,
        strongBodyField,
        rotational,
        is1vN: Boolean(
            direct.length || strongBodyField
            || (rotational && lexemes.length >= 2)
            || enumMax >= 5
            || lexemes.length >= 7
        ),
    };
}

const COORDINATION_TERMS = [
    '她们', '众人', '几女', '诸女', '一起侍奉', '共同侍奉', '同时侍奉',
    '一同上床', '一同服侍', '轮流', '轮番', '交替', '姐妹一起', '母女一起'
];

/** 1v1~1vN 模式：先看群体证据，再看协调语义 + 名字数升级（与原版一致）。 */
export function resolveMode(text, names = []) {
    const source = String(text || '');
    const groupEvidence = largeGroupEvidence(source);
    if (groupEvidence.is1vN) return { mode: '1vN', groupEvidence };
    for (const mode of ['1v4', '1v3', '1v2']) {
        if (GROUP_TERMS[mode].some(t => source.includes(t))) return { mode, groupEvidence };
    }
    if (COORDINATION_TERMS.some(t => source.includes(t))) {
        const n = names.length;
        if (n >= 5) return { mode: '1vN', groupEvidence };
        if (n === 4) return { mode: '1v4', groupEvidence };
        if (n === 3) return { mode: '1v3', groupEvidence };
        if (n === 2) return { mode: '1v2', groupEvidence };
    }
    return { mode: '1v1', groupEvidence };
}

// ------------------------------------------------------------
// 女性名字提取（原版 build_auto_female_names / extract_names）
// ------------------------------------------------------------

const NAME_BAD_EXACT = new Set([
    '这个', '那个', '自己', '对方', '女人', '少女', '夫人', '妈妈', '母亲', '姐姐', '妹妹',
    '主人', '系统', '泽堃', '她们', '她也', '她又', '她则', '她还', '她却', '她只',
    '微微', '缓缓', '轻轻', '慢慢', '继续', '随后', '接着', '于是', '不过', '但是',
    '满意', '有些', '忽然', '突然', '低声', '轻声', '柔声', '冷声', '娇声',
    '点了', '摇了', '皱了', '抬了', '笑了', '问了', '说道', '问道', '答道'
]);
const NAME_BAD_PARTS = ['一旁的', '旁边的', '身旁的', '面前的', '眼前的', '这位', '那位'];
const NAME_BAD_SUFFIXES = ['微微', '缓缓', '轻轻', '慢慢', '继续', '随后', '接着', '有些', '满意地', '满意的'];
const SPEAKER_RE = /(?:^|[\n。！？；：，、“”「」『』])\s*([\u4e00-\u9fff·]{2,7})(?:说道|问道|答道|笑道|开口|轻声道|低声道|柔声道|冷声道|娇声道|解释道|提醒道|点头|摇头|皱眉|抬头|惊讶道|疑惑道)/g;
const FEMALE_CUE_RE = /(?:她|女士|小姐|夫人|姐姐|妹妹|妈妈|母亲|少女|女人|妻子|女王|女神|天使|女仆|少妇|寡妇|阿姨|姑姑)/;

/** 全书自动提取女主名字（按出现次数 ≥2 且女性语境线索达标过滤）。 */
export function buildAutoFemaleNames(text, config = {}) {
    if (config.auto_extract_female_names === false) return [];
    const source = String(text || '');
    const counts = new Map();
    const cueCounts = new Map();
    let m;
    SPEAKER_RE.lastIndex = 0;
    while ((m = SPEAKER_RE.exec(source)) !== null) {
        let name = m[1].trim();
        for (const prefix of NAME_BAD_PARTS) {
            if (name.startsWith(prefix)) name = name.slice(prefix.length);
        }
        let changed = true;
        while (changed) {
            changed = false;
            for (const suffix of NAME_BAD_SUFFIXES) {
                if (name.endsWith(suffix) && name.length > suffix.length + 1) {
                    name = name.slice(0, -suffix.length);
                    changed = true;
                }
            }
        }
        if (name.length < 2 || name.length > 6) continue;
        if (NAME_BAD_EXACT.has(name)) continue;
        if (/^(她|他|其|这|那|一个|一名)/.test(name)) continue;
        if (/[的地得了着]/.test(name)) continue;
        if (/(?:点|摇|皱|抬|笑|问|说|看|听|想|走|坐|站|转|伸|收|吐|叹)$/.test(name)) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
        const lo = Math.max(0, m.index - 140);
        const hi = Math.min(source.length, m.index + m[0].length + 180);
        if (FEMALE_CUE_RE.test(source.slice(lo, hi))) {
            cueCounts.set(name, (cueCounts.get(name) || 0) + 1);
        }
    }
    const manual = new Set(config.female_names || []);
    const limit = Math.max(0, niNum(config.auto_name_limit, DEFAULT_SCENE_CONFIG.auto_name_limit));
    return [...counts.entries()]
        .filter(([name, count]) => !manual.has(name) && count >= 2 && (cueCounts.get(name) || 0) >= Math.max(1, Math.floor(count / 4)))
        .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length) || (a[0] < b[0] ? -1 : 1))
        .map(([name]) => name)
        .slice(0, limit);
}

/** 窗口内参与名字提取（手填名单 + 自动名单，别名归一；可选人设词兜底）。 */
export function extractNames(text, config = {}, autoNames = []) {
    const source = String(text || '');
    const aliases = config.aliases || {};
    const names = [];
    const allNames = [...(config.female_names || []), ...(Array.isArray(autoNames) ? autoNames : [])];
    for (const raw of [...new Set(allNames)].sort((a, b) => b.length - a.length)) {
        if (raw && source.includes(raw)) {
            const name = aliases[raw] || raw;
            if (!names.includes(name)) names.push(name);
        }
    }
    if (config.enable_role_name_fallback && !names.length) {
        const rolePattern = [...ROLE_TERMS]
            .sort((a, b) => b.length - a.length)
            .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
        const roleRe = new RegExp(`(?:^|[，。！？；：、“”「」『』\\s])([\\u4e00-\\u9fff]{1,4}(?:${rolePattern}))(?=$|[，。！？；：、“”「」『』\\s])`, 'g');
        for (const line of source.split(/\r?\n+/)) {
            const stripped = line.trim().replace(/^[，。！？；：、\t]+|[，。！？；：、\t]+$/g, '');
            let m;
            roleRe.lastIndex = 0;
            while ((m = roleRe.exec(stripped)) !== null) {
                const name = m[1];
                if (!names.includes(name)) names.push(name);
            }
        }
    }
    return names;
}

// ------------------------------------------------------------
// 章节级分析（新引擎总入口）
// ------------------------------------------------------------

export function safetyLabel(reason) {
    const key = String(reason || '').split(':')[0];
    return SAFETY_REASON_LABELS[key] || reason || '';
}

export function sceneDecisionLabel(decision) {
    return DECISION_LABELS[decision] || decision || '';
}

export function completionLabel(mode) {
    return COMPLETION_LABELS[mode] || '';
}

/** 场景窗口 → 可读文本（用于判定证据与加料提示词）。
 *  opts.withAnchor=false 时不输出原文锚点（批量扫描材料用，避免与原文摘录重复）。 */
export function buildScenesText(scenes, { withAnchor = true } = {}) {
    return (Array.isArray(scenes) ? scenes : []).map((w, i) => {
        const paraPart = (w.paragraphIndexes || []).map(p => Number(p) + 1).join('-');
        const seg = `场景${i + 1}：第 ${paraPart} 段附近 → ${sceneDecisionLabel(w.decision)}${w.completionMode ? `（${completionLabel(w.completionMode)}）` : ''}`;
        const stagePart = Object.entries(w.stages || {})
            .filter(([k, v]) => k !== 'weak' && Array.isArray(v) && v.length)
            .map(([k, v]) => `${SCENE_STAGE_LABELS[k] || k}[${v.slice(0, 3).join('/')}]`)
            .join(' ');
        const weakPart = (w.stages?.weak || []).length ? `｜弱信号(歧义词)[${w.stages.weak.slice(0, 4).join('/')}]` : '';
        const modePart = w.mode && w.mode !== '1v1' ? `｜模式 ${w.mode}` : '';
        const safePart = w.safetyReason ? `｜安全否决：${safetyLabel(w.safetyReason)}` : '';
        const anchorPart = (withAnchor && w.anchor) ? `｜原文：“${String(w.anchor).slice(0, 60)}…”` : '';
        return `${seg}${stagePart ? `｜${stagePart}` : ''}${weakPart}${modePart}${safePart}${anchorPart}`;
    }).join('\n');
}

/**
 * 章节场景分析：窗口聚类 → 逐窗（名字/模式/分类/安全）→ 章节级汇总。
 * @param {string} text 章节正文
 * @param {object} opts { chapterNumber, bookProfile, config, autoNames }
 * @returns {object} { windows, actionableCount, vetoCount, score, confidence, hit, vetoed, bookProfile, modes }
 */
export function analyzeChapter(text, { chapterNumber = 0, bookProfile = 'normal', config = {}, autoNames = [] } = {}) {
    const source = String(text || '');
    const clusters = clusterCandidates(source, config);
    const vetoEnabled = config.safetyVetoEnabled !== false; // 安全否决总开关
    const windows = clusters.map((cluster, wi) => {
        const names = extractNames(cluster.scope, config, autoNames);
        const { mode, groupEvidence } = resolveMode(cluster.scope, names);
        const cls = classifyWindow(cluster.scope, bookProfile, config);
        const risk = vetoEnabled ? safetyReason(cluster.scope, chapterNumber, names, config) : null;
        const decision = risk ? 'skip_safety_veto' : cls.decision;
        const completionMode = risk ? null : cls.completionMode;
        return {
            wi,
            paragraphIndexes: cluster.paragraphIndexes,
            start: cluster.start,
            end: cluster.end,
            anchor: cluster.anchor.slice(0, 200),
            names: names.slice(0, 10),
            mode,
            groupEvidence: {
                directHits: groupEvidence.directHits.slice(0, 8),
                roleLexemes: groupEvidence.roleLexemes.slice(0, 8),
                enumeratedRoleCount: groupEvidence.enumeratedRoleCount,
                strongBodyField: groupEvidence.strongBodyField,
                rotational: groupEvidence.rotational,
            },
            stages: cls.stages,
            explicitScore: cls.explicitScore,
            metaphorScore: cls.metaphor.score,
            highConfidenceMetaphor: cls.metaphor.highConfidence,
            decision,
            completionMode,
            safetyReason: risk,
            firstTime: FIRST_TIME_TERMS.some(t => cluster.scope.includes(t)),
        };
    });
    const vetoedWindows = windows.filter(w => w.decision === 'skip_safety_veto');
    const actionable = windows.filter(w => w.completionMode);
    const score = Math.min(30, windows.reduce((s, w) => s + w.explicitScore, 0));
    const modes = [...new Set(windows.map(w => w.mode))];
    return {
        windows,
        actionableCount: actionable.length,
        vetoCount: vetoedWindows.length,
        score,
        confidence: Math.min(0.99, score > 0 ? 0.45 + Math.min(0.54, score / 24) : 0),
        hit: actionable.length > 0 && vetoedWindows.length === 0,
        vetoed: vetoedWindows.length > 0,
        bookProfile,
        modes,
    };
}
