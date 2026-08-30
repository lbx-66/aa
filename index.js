/**
 * Novel Injector - 小说上下文注入插件
 * 功能：上传小说 → 分段清洗压缩 → 提取剧情/角色 → 向量化 → 按阶段开关动态注入酒馆上下文
*/

import {
    renderExtensionTemplateAsync,
    getContext,
    extension_settings,
    saveMetadataDebounced,
} from '/scripts/extensions.js';

import {
    saveSettingsDebounced,
    cleanUpMessage,
    chat_metadata,
    eventSource,
    event_types,
    extractMessageFromData,
    getCurrentChatId,
    getRequestHeaders,
    messageFormatting,
    name1,
    substituteParams,
} from '/script.js';

import {
    promptManager,
    oai_settings,
} from '/scripts/openai.js';

import {
    NI_NOVEL_LIBRARY_PAGE_SIZE_DEFAULT,
    createStorageController,
    niEscAttr,
    niEscHtml,
    niSafeVectorFingerprint,
    niSafeVectorFingerprints,
} from './lib/storage-system.js';
import { createAutosaveController } from './lib/autosave-system.js';

import {
    NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    niBuildStageInjectionPayload,
    niIsVectorInjectionDisabledByUser,
    niNormalizeRawInjectionMaxTokens,
    niNormalizeVectorInjectionPreference,
    niResolveDirectStageInjectionStages,
    niBuildTransbookStageDetailText,
    niResolvePausedTransbookPromptSlots,
    niResolveStageInjectionPlan,
    niSetVectorInjectionDisabledByUser,
} from './lib/injection-system.js';

import {
    bytesToVecs,
    cosineSim,
    createEmbeddingClient,
    createVectorController,
    createVectorRecallService,
    findVectorStageSourceMismatches,
    getVectorCompatibilityHint,
    isVectorRowCompatible,
    niBuildTbLightRecallContext,
    niBuildTbNodeVectorQuery,
    niBuildStageNodeVectorQuery,
    niBuildWeightedVectorQueries,
    niResolveVectorRecallStageScopes,
    niSelectRecentVectorMessageTexts,
    splitText,
    summarizeVectorCompatibility,
    vecToBuffer,
    vecToBytes,
} from './lib/vector-system.js';

import {
    NI_DEV_CURRENT_TEXT_LIMIT,
    NI_DEV_RECALL_TEXT_LIMIT,
    NI_PLOT_PAGE_SIZE_DEFAULT,
    NI_STAGE_SLOT_PAGE_SIZE_DEFAULT,
    NI_STAGE_PAGE_SIZE_DEFAULT,
    NI_UNASSIGNED_PAGE_SIZE_DEFAULT,
    captureCharacterMemory,
    capturePlotCheckpointMemory,
    getAllPlotsInStoryOrder,
    getAssignedStagesForChunk,
    mergeCharacterAliases,
    mergeCharacters,
    niComparePlotOrder,
    niBuildDeviationGuideFromSections,
    niBuildDeviationFactsContext,
    niBuildDeviationFactsText,
    niBuildDeviationSectionsFromAnalysis,
    niBuildStageRuntimeIndex,
    niBuildListPaginationHtml,
    niBuildDevChatEntriesText,
    niDevIsCountableMessage,
    niDevMessageFloor,
    niDevMessageMesId,
    niDevMessageRole,
    niDevMessageText,
    niDevRangeLabel,
    niDevRangeProgressLabel,
    niEnsurePlotNodeId,
    niFiniteNumber,
    niHashShort,
    niMergeDeviationSections,
    niNormalizeDeviationFacts,
    niNormalizeDeviationFactHistory,
    niNormalizeStagePageSize,
    niReconcileDeviationFacts,
    niMergeDevMessagesByFloor,
    niMergeStageNodes,
    niNormalizeDeviationSections,
    niNormalizeDevRange,
    niNormalizeIncomingPlots,
    niParseDeviationGuideSections,
    niPlotChunkIdx,
    niPlotChunkOrder,
    niPlotManualOrder,
    niResolveStagePagination,
    niSortPlotsByStoryOrder,
    niPlotTypeRank,
    normalizePlotCollections,
    rebuildStageMapFromPlotStageIdx,
    restoreCharacterMemory,
    restorePlotCheckpointMemory,
    createStoryController,
} from './lib/story-data.js';

import {
    buildRechunkLayout,
    canUseDerivedModules,
    createCleaningController,
    detectEncoding,
    fingerprintArrayBuffer as niFingerprintArrayBuffer,
} from './lib/cleaning-system.js';

import {
    CHAPTER_STATUS,
    CHAPTER_STATUS_LABELS,
    DEFAULT_CHAPTER_PATTERNS,
    applyChapterFilter,
    buildChapterImportReport,
    deleteChapters,
    mergeChapters,
    niEnrichSupportedExt,
    niExtractEpubText,
    recognizeChapters,
    splitChapter,
    transitionChapter,
} from './lib/chapter-system.js';

import { createBatchQueueController } from './lib/batch-queue.js';

import {
    PersistedRateQueue,
    concurrencyLimit,
    createChatCompletionResponseTools,
    createGlobalPromptTools,
    createNovelApiClient,
    createProfileApiClient,
    createTavernPresetMessageTools,
    DynamicSemaphore,
    niApplyModelListToControls,
    niFetchModelIds,
    niLoadModelList,
    niNormalizeGlobalPromptSource,
    niResolveModelMaxTokens,
    runWithSemaphore,
} from './lib/api-system.js';

import {
    BATCH_JUDGE_PROMPT,
    DEFAULT_JUDGE_PROMPT,
    DEFAULT_JUDGE_RULES,
    LEGACY_JUDGE_PROMPT,
    buildBatchChaptersText,
    buildBatchJudgeMessages,
    buildJudgeMessages,
    buildJudgeRulesSummary,
    classifyKeywordResult,
    isTruncatedError,
    judgeResponseLength,
    judgeResultLabel,
    keywordJudgeToStore,
    parseBatchJudgeResponse,
    parseJudgeResponse,
    scoreIntimacy,
} from './lib/judge-system.js';

import {
    DEFAULT_SCENE_CONFIG,
    buildAutoFemaleNames,
    buildScenesText,
    detectBookProfile,
} from './lib/scene-system.js';

import {
    DEFAULT_ENRICH_TEMPLATES,
    ENRICH_MIN_CHARS,
    buildEnrichKeywordsSummary,
    buildEnrichMessages,
    buildEnrichShortfallInstruction,
    canEnrichChapter,
    checkSensitive,
    detectNoEnrichOutput,
    enrichIntensityGuide,
    enrichIntensityLabel,
    mergeEnrichSegments,
    niFilterEnrichOutput,
    niParseEnrichSegments,
} from './lib/enrich-system.js';

import {
    niBuildExportEpub,
    niBuildExportMarkdown,
    niBuildExportText,
    niCountNotEnriched,
    niSafeFileName,
} from './lib/export-system.js';

import {
    NI_TRANSBOOK_STAGE_PAGE_SIZE,
    createTransbookController,
    niResolveTransbookStagePagination,
} from './lib/transbook-system.js';

import {
    createGenerationController,
    niBuildWorldInjectionText,
} from './lib/world-system.js';

import {
    CLEAN_PROMPT,
    DEV_PROMPT,
    GLOBAL_PROMPT,
    GLOBAL_TAIL_PROMPT,
    ROLEPLAY_PROMPT,
    ROLEPLAY_PROMPT_EVENT_HISTORY_LINE,
    ROLEPLAY_PROMPT_LEGACY_USER_EVENT_RULE,
    ROLEPLAY_PROMPT_USER_ROLE_LINES_TO_REMOVE,
    STYLE_PROMPT,
    TAVERN_TASK_FINAL_OVERRIDE_PROMPT,
    TAVERN_TASK_SWITCH_PROMPT,
    TB_DEFAULT_ADVANCE_PROMPT,
    TB_DEFAULT_IMMERSION_PROMPT,
    TB_DEFAULT_INFER_PROMPT,
    TB_DEFAULT_ONGOING_PROMPT,
    TB_DEFAULT_OPENING_PROMPT,
    TB_LEGACY_ADVANCE_PROMPT,
    TB_LEGACY_ONGOING_PROMPT,
    TB_LEGACY_OPENING_PROMPT,
    USER_SUB_BOUNDARY_PROMPT,
    WORLD_DEFAULT_CATEGORIES,
    WORLD_EXTRACT_PROMPT,
    WORLD_LENGTH_RETRIES,
    WORLD_RESPONSE_LENGTH,
    WORLD_SHRINK_PROMPT,
} from './lib/prompts.js';

import {
    NI_THEME_DEFAULT,
    createThemeEditor,
    niApplyStatusbarTheme,
    niResolveStageInjectionUiState,
} from './lib/ui-system.js';

// ============================================================
// 常量
// ============================================================
const EXT_NAME = 'novel-injector';
const NI_USER_SUB_CHAT_META_KEY = 'novelInjectorUserSub';
const NI_USER_SUB_CHAT_MIGRATION_KEY = '_userSubChatConfigMigrationV1';
const NI_UPLOAD_ACCEPT = '.txt,.mobi';
const NI_UPLOAD_LABEL = '点击上传 .txt / .mobi 文件';
const NI_UPLOAD_HINT = '支持 .txt / .mobi，将按设定大小自动分段';

function niNormalizeRawInjMode(mode) {
    return mode === 'compressed' ? 'compressed' : DEFAULT_SETTINGS.rawInjMode;
}
// 通过 Error stack trace 获取当前模块的实际路径
function _detectExtFolder() {
    try {
        const stack = new Error().stack || '';
        // 匹配形如 extensions/third-party/xxx/index.js 的路径
        const m = stack.match(/extensions\/([^/]+\/[^/]+)\/index\.js/);
        if (m) return m[1];
    } catch (_) {}
    return `third-party/${EXT_NAME}`;
}
const EXT_FOLDER = _detectExtFolder();
const DB_NAME = 'NovelInjectorVectors';
const DB_VERSION = 2;
const DB_STORE = 'chunks';
const DEFAULT_SETTINGS = {
    cleanKey: '',
    cleanUrl: 'https://api.openai.com/v1/chat/completions',
    cleanModel: 'gpt-4o',
    cleanStream: false,
    vecKey: '',
    vecUrl: 'https://api.openai.com/v1',
    vecModel: 'text-embedding-3-large',
    // 向量块注入设置
    injDepth: 4,
    vecInjPos: 1,   // 0=主提示后 1=聊天内 2=主提示前
    vecInjRole: 0,  // 0=system 1=user 2=assistant
    recallTopK: 3,
    recallThresh: 0.5,
    vecMsgTag: '',       // 消息内容标签，留空=完整消息，有值则只提取该标签内文字
    vecMsgCount: 3,      // 召回时取近几条消息
    // 角色人设注入设置
    charInjPos: 2,   // 默认主提示前，人设通常放靠前
    charInjDepth: 4,
    charInjRole: 0,
    charAutoSleepEnabled: true, // 开启阶段时自动休眠本阶段正文未出现的角色人设
    charPageSize: NI_STAGE_PAGE_SIZE_DEFAULT,
    plotPageSize: NI_PLOT_PAGE_SIZE_DEFAULT,
    // 阶段剧情注入设置
    plotInjPos: 1,   // 默认聊天内
    plotInjDepth: 4,
    plotInjRole: 0,
    plotInjMaxTokens: NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    stagePageSize: NI_STAGE_PAGE_SIZE_DEFAULT,
    stageSlotPageSize: NI_STAGE_SLOT_PAGE_SIZE_DEFAULT,
    unassignedPageSize: NI_UNASSIGNED_PAGE_SIZE_DEFAULT,
    novelLibraryPageSize: NI_NOVEL_LIBRARY_PAGE_SIZE_DEFAULT,
    transBookStagePageSize: NI_TRANSBOOK_STAGE_PAGE_SIZE,
    transBookNodePageSize: NI_STAGE_PAGE_SIZE_DEFAULT,
    // 偏差注入设置
    devPrompt: DEV_PROMPT,
    devInjPos: 2,    // 默认主提示前，作为分支现实约束
    devInjDepth: 0,
    devInjRole: 0,
    devAutoUpdateEnabled: false,
    devAutoUpdateEvery: 10,
    devManualMsgCount: 10,
    rawInjMode: "nodes",  // "nodes"=剧情节点 | "compressed"=压缩原文
    globalPromptSource: 'builtin', // builtin=内置提示词 tavern=跟随酒馆主预设 none=不使用
    globalPrompt: GLOBAL_PROMPT,
    globalTailPrompt: GLOBAL_TAIL_PROMPT,
    globalHeadInjPos: 2,
    globalHeadInjDepth: 0,
    globalHeadInjRole: 0,
    globalTailInjPos: 1,
    globalTailInjDepth: 0,
    globalTailInjRole: 0,
    chunkKb: 100,
    apiTimeoutMin: 15,  // 每段 API 请求超时时间
    apiRateLimit: 3,    // 每分钟最多请求次数
    apiConcurrency: 1,  // 清洗、阶段概括和角色 AI 人设共用的最大并发请求数；0按串行兼容
    judgeConcurrency: 1, // 判定（AI/批量）并发请求数；判定与清洗/加料互不影响
    judgeRateLimit: 0,   // 判定每分钟限速，0=不限（仅受并发数约束）
    enrichConcurrency: 1, // AI 加料并发请求数；加料与清洗/判定互不影响
    enrichRateLimit: 0,   // 加料每分钟限速，0=不限
    cleanAutoResume: false, // 一轮清洗后仍有未完成分段时自动续跑，直到全部完成；完成后弹窗提醒
    vecRateLimit: 3,    // 向量化每分钟最多请求次数
    vecConcurrency: 1,  // 1=串行；>1=最大并发请求数；0按串行兼容
    vecBatchSize: 16,   // 每次 Embedding 请求批量提交的文本块数
    pluginEnabled: true,  // 插件总开关
    autoSaveEnabled: false, // 默认关闭，需用户手动开启
    topbarIconVisible: true, // 酒馆顶部栏图标显示开关
    themePreset: 'default',
    themePrimary: NI_THEME_DEFAULT.primary,
    themeSuccess: NI_THEME_DEFAULT.success,
    themePivot: NI_THEME_DEFAULT.pivot,
    themeWarning: NI_THEME_DEFAULT.warning,
    themeSurfaceFollowPreset: true,
    themeBorderless: false,
    themeCardless: false,
    themeStatusbarFollow: false,
    themeIconReplace: false,
    themeBackground: NI_THEME_DEFAULT.background,
    themeText: NI_THEME_DEFAULT.text,
    themeUserPresets: [],
    themePresetOverrides: {},
    themeDeletedPresetIds: [],
    vecInjDisabled: false, // 有向量数据但用户选择不调用向量注入
    vecInjDisabledByUser: false, // 仅用户主动点击关闭时为 true；旧设置残留不能屏蔽向量
    tbRestoreAfterPluginEnable: false,
    novelLibrary: [],     // 小说快照库 [{name, key, snapshot}]
    // 世界设定注入设置
    worldInjPos:   2,   // 默认主提示前
    worldInjDepth: 4,
    worldInjRole:  0,
    // 文风注入设置
    styleInjPos:    2,
    styleInjDepth:  4,
    styleInjRole:   0,
    styleSampleLen: 1000,
    styleChunkIdx:  0,
    styleMode:      'sample', // 'sample' | 'manual'
    userSubEnabled: false,
    userSubMode: 'replace', // 'replace'=替换原角人生 | 'play'=扮演原角本人
    userSubCharIdx: '',
    userSubAliases: [],
    userSubPromptReplace: null,
    userSubPromptPlay: null,
    userSubBoundaryPrompt: USER_SUB_BOUNDARY_PROMPT,
    // 加料管道（P0 章节导入）
    enrichImport: {
        threshold: 200,           // 短章节过滤阈值（字符），默认 200
        customPatterns: [],       // 用户自定义章节识别正则 string[]
        filterEnabled: true,      // 是否启用短章节过滤
    },
    enrichHistory: [],            // 最近导入记录 [{name,size,fingerprint,importedAt,chapterCount}]
    enrichShortcutsEnabled: true, // 加料页快捷键（Space/S/Esc/Ctrl+I）
    // 亲密行为判定（P2）
    judgeRules: DEFAULT_JUDGE_RULES,       // 关键词库/正则/阈值（读取走 niJudgeRules 克隆，勿直接改）
    judgePrompts: { template: DEFAULT_JUDGE_PROMPT, batchTemplate: BATCH_JUDGE_PROMPT },
    judgeApi: { url: '', key: '', model: '', stream: false, timeoutSec: 60, retries: 2, temperature: 0.3 },
    sceneConfig: DEFAULT_SCENE_CONFIG,     // 场景引擎配置（判定逻辑移植自 Auto Scene 3.5 纯加料器.py）
    // AI 加料（P3）
    enrichApi: { url: '', key: '', model: '', stream: true, timeoutSec: 120, retries: 2, temperature: 0.9, topP: 1, dailyQuota: 0, dailyQuotaDate: '', dailyQuotaUsed: 0, useTavernPreset: false, useIndependentApi: true },
    enrichTemplates: DEFAULT_ENRICH_TEMPLATES,  // 模板库（读取走 niEnrichTemplates 克隆）
    enrichParams: { intensity: 'medium', maxTokens: 4000, maxTokensAuto: true, minChars: ENRICH_MIN_CHARS, enforceMinChars: true },
    enrichSafety: { enabled: true, sensitiveWords: [] },
};

// ============================================================
// 运行时状态
// ============================================================
const S = {
    // 文件
    rawText: '',
    rawFileSize: 0,
    chunks: [],           // string[]
    chunkStatus: [],      // 'pending' | 'running' | 'done' | 'error'
    chunkResults: [],     // string[] — 清洗后的压缩文本
    chunkMeta: [],        // object[] — 每段原始 meta，用于续跑重建
    fileLoaded: false,
    fileFingerprint: '',  // 文件内容 SHA-256，避免仅凭文件名复用旧数据
    chunkKbUsed: 0,       // 当前清洗/分段数据对应的 KB 配置

    // 清洗
    cleanRunning: false,
    cleanDone: false,
    kbTimer: null,
    skipCurrentChunk: false,   // 用户点击"跳过本段"时置 true
    stopClean: false,          // 用户点击"暂停"时置 true

    // 结构化数据
    characters: [],       // {name, role, bio}[]
    plots: {              // main/sub/pivot
        main: [],
        sub: [],
        pivot: [],
    },

    // 阶段
    stageStates: {},      // {[stageIdx]: boolean} — 是否参与向量召回
    stageSummaries: {},   // {[stageIdx]: string} — 概括
    stageTitles: {},      // {[stageIdx]: string} — 阶段标题
    stageMap: {},         // {[plotPosition]: stageIdx} 主线+转折运行时位置映射；文件中以稳定 _nodeId 持久化
    stageMapN: 0,         // 用户划分的阶段总数

    // 向量
    vecDone: false,
    stageVecDone: {},     // {[stageIdx]: boolean} — 各阶段是否已向量化
    stageVecExpected: {}, // {[stageIdx]: number} — 各阶段完整向量块数
    stageVecSourceMismatch: {}, // {[stageIdx]: boolean} — 与当前向量配置来源不同，仅供诊断显示
    db: null,
    novelKey: '',         // IndexedDB 隔离 key，基于文件名
    heavyFileKey: '',     // 服务端重数据文件 key，基于用户快照名

    // 世界设定
    worldCategories: null,  // [{id, label, enabled, content}] — null 表示使用默认

    // 文风
    styleGuide: '',         // 生成的文风执行指南文本
    deviationGuide: '',     // 当前偏差注入文本
    devChangedFacts: '',     // 已改变事实：长期分支事实锚点
    devFacts: [],            // 结构化当前分支事实（含已失效历史条目）
    devFactHistory: [],      // 本地事实变更记录，不注入 AI
    devCurrentConstraint: '',// 当前偏差约束：每次偏差更新后替换
    devPreservedFacts: '',   // 仍保留的原著事实：每次偏差更新后替换
    devRunning: false,
    devAutoLastFloor: null,
    devCoveredFloor: 0,     // 当前偏差已顺序总结到第几楼
    devLastRange: null,     // 最近一次偏差分析范围，供重试复用

    // 注入

    // 加料管道（P0 章节导入）
    enrichChapters: [],       // 章节数组（见 chapter-system.js）
    enrichFileMeta: null,     // {name, size, fingerprint, importedAt}
    enrichReport: null,       // 导入报告 {keptCount, filteredCount, filtered, allFiltered}
    enrichSelected: new Set(),// 当前勾选的章节 id
};

let niAutosave = null;

function niResetChunkDerivedState() {
    S.chunkStatus = S.chunks.map(() => 'pending');
    S.chunkResults = S.chunks.map(() => '');
    S.chunkMeta = [];
    S.cleanRunning = false;
    S.cleanDone = false;
    S.stopClean = false;
    S.skipCurrentChunk = false;
    S.characters = [];
    S.plots = { main: [], sub: [], pivot: [] };
    niResetStageVectorState();
}

function niResetStageVectorState() {
    S.stageStates = {};
    S.stageSummaries = {};
    S.stageTitles = {};
    S.stageMap = {};
    S.stageMapN = 0;
    S.chunkStageMap = null;
    S.vecDone = false;
    S.stageVecDone = {};
    S.stageVecExpected = {};
    S.stageVecSourceMismatch = {};
}

function niRechunkPreservingCompleted(kb) {
    const oldChunkStageMap = S.chunkStageMap;
    const layout = buildRechunkLayout({
        chunks: S.chunks,
        status: S.chunkStatus,
        results: S.chunkResults,
        meta: S.chunkMeta,
        kb,
        charsPerByte: S._charsPerByte || 0.5,
    });
    const { chunks, status, results, meta, preserved, pending, oldToNewChunkIdx } = layout;

    S.chunks = chunks;
    S.chunkStatus = status;
    S.chunkResults = results;
    S.chunkMeta = meta;
    S.cleanRunning = false;
    S.cleanDone = status.length > 0 && status.every(value => value === 'done');
    S.stopClean = false;
    S.skipCurrentChunk = false;

    ['main', 'sub', 'pivot'].forEach(type => {
        (S.plots[type] || []).forEach((plot, index) => {
            const oldChunkIdx = niPlotChunkIdx(plot, -1);
            if (!oldToNewChunkIdx.has(oldChunkIdx)) return;
            const oldId = niEnsurePlotNodeId(plot, type, index);
            const newChunkIdx = oldToNewChunkIdx.get(oldChunkIdx);
            const idParts = String(oldId).split(':');
            if (idParts.length >= 4 && Number(idParts[1]) === oldChunkIdx) {
                idParts[1] = String(newChunkIdx);
                plot._nodeId = idParts.join(':');
            }
            plot._chunkIdx = newChunkIdx;
        });
    });
    (S.characters || []).forEach(character => {
        const oldChunkIdx = Number(character?._firstChunkIdx);
        if (Number.isFinite(oldChunkIdx) && oldToNewChunkIdx.has(oldChunkIdx)) {
            character._firstChunkIdx = oldToNewChunkIdx.get(oldChunkIdx);
            delete character._characterId;
        }
        (character?.aliases || []).forEach(alias => {
            const aliasChunkIdx = Number(alias?._chunkIdx);
            if (Number.isFinite(aliasChunkIdx) && oldToNewChunkIdx.has(aliasChunkIdx)) {
                alias._chunkIdx = oldToNewChunkIdx.get(aliasChunkIdx);
            }
        });
    });
    const remappedPlotMemory = capturePlotCheckpointMemory(S);
    const remappedCharacterMemory = captureCharacterMemory(S);

    const remappedChunkStageMap = {};
    if (oldChunkStageMap) {
        Object.entries(oldChunkStageMap).forEach(([oldChunkIdx, stages]) => {
            const oldIdx = Number(oldChunkIdx);
            if (!oldToNewChunkIdx.has(oldIdx)) return;
            const values = stages instanceof Set ? [...stages] : (Array.isArray(stages) ? stages : []);
            remappedChunkStageMap[oldToNewChunkIdx.get(oldIdx)] = new Set(values.map(Number));
        });
    }
    S.chunkStageMap = Object.keys(remappedChunkStageMap).length ? remappedChunkStageMap : null;
    niRebuildStructuredDataFromChunks(remappedPlotMemory, remappedCharacterMemory);
    return {
        preserved,
        pending,
        oldToNewChunkIdx,
    };
}

function niResetNovelWorkspace() {
    S.rawText = '';
    S.rawFileSize = 0;
    S.chunks = [];
    S.fileLoaded = false;
    S.fileFingerprint = '';
    S.chunkKbUsed = 0;
    niResetChunkDerivedState();
    S.novelKey = '';
    S.heavyFileKey = '';
    S.worldCategories = null;
    S.styleGuide = '';
}

// ============================================================
// IndexedDB 封装
// ============================================================

// 兼容旧版本角色扮演提示词。
function niUpgradeRoleplayPrompt(cfg = extension_settings[EXT_NAME] || {}) {
    if (!cfg || typeof cfg.roleplayPrompt !== 'string') return false;
    let nextPrompt = cfg.roleplayPrompt;
    nextPrompt = nextPrompt.replaceAll(
        ROLEPLAY_PROMPT_LEGACY_USER_EVENT_RULE,
        ROLEPLAY_PROMPT_EVENT_HISTORY_LINE,
    );
    ROLEPLAY_PROMPT_USER_ROLE_LINES_TO_REMOVE.forEach(line => {
        nextPrompt = nextPrompt.replaceAll(line, '').replace(/\n{3,}/g, '\n\n');
    });
    if (nextPrompt === cfg.roleplayPrompt) return false;
    cfg.roleplayPrompt = nextPrompt;
    return true;
}

function niLoadSettings() {
    extension_settings[EXT_NAME] = extension_settings[EXT_NAME] || {};
    const saved = extension_settings[EXT_NAME];
    if (Object.prototype.hasOwnProperty.call(saved, 'styleInjEnabled')) {
        delete saved.styleInjEnabled;
        saveSettingsDebounced();
    }
    Object.keys(DEFAULT_SETTINGS).forEach(k => {
        if (saved[k] === undefined) saved[k] = DEFAULT_SETTINGS[k];
    });
    if (saved._paginationDefault20Initialized !== true) {
        if (Number(saved.stagePageSize) === 50) saved.stagePageSize = DEFAULT_SETTINGS.stagePageSize;
        saved.charPageSize = niNormalizeStagePageSize(saved.charPageSize, DEFAULT_SETTINGS.charPageSize);
        saved._paginationDefault20Initialized = true;
        saveSettingsDebounced();
    }
    if (saved._allPaginationDefault20Initialized !== true) {
        if (Number(saved.plotPageSize) === 30) saved.plotPageSize = DEFAULT_SETTINGS.plotPageSize;
        if (Number(saved.unassignedPageSize) === 50) saved.unassignedPageSize = DEFAULT_SETTINGS.unassignedPageSize;
        if (Number(saved.transBookStagePageSize) === 30) saved.transBookStagePageSize = DEFAULT_SETTINGS.transBookStagePageSize;
        if (Number(saved.transBookNodePageSize) === 40) saved.transBookNodePageSize = DEFAULT_SETTINGS.transBookNodePageSize;
        saved._allPaginationDefault20Initialized = true;
        saveSettingsDebounced();
    }
    if (saved._rawInjectionDefault32000Initialized !== true) {
        if (Number(saved.plotInjMaxTokens) === 8000) {
            saved.plotInjMaxTokens = DEFAULT_SETTINGS.plotInjMaxTokens;
        }
        saved._rawInjectionDefault32000Initialized = true;
        saveSettingsDebounced();
    }
    if (niNormalizeVectorInjectionPreference(saved)) saveSettingsDebounced();
    if (saved._charAutoSleepInitialized !== true) {
        saved.charAutoSleepEnabled = true;
        saved._charAutoSleepInitialized = true;
        saveSettingsDebounced();
    }
    niUpgradeLegacyTbDefaultPrompts(saved);
    if (niUpgradeRoleplayPrompt(saved)) saveSettingsDebounced();
    // 判定提示词迁移：旧默认模板（"是否包含亲密描写"语义）→ 场景引擎缺口语义模板；
    // 仅当模板从未被用户自定义（与旧默认逐字相等）时替换，自定义模板不动。
    if (saved.judgePrompts?.template === LEGACY_JUDGE_PROMPT) {
        saved.judgePrompts.template = DEFAULT_JUDGE_PROMPT;
        saveSettingsDebounced();
    }

    // 还原轻量运行状态与当前小说标识；持久化阶段索引由独立 stages 文件加载
    if (saved._stageStates) S.stageStates = saved._stageStates;
    if (saved._stageSummaries) S.stageSummaries = saved._stageSummaries;
    if (saved._stageTitles) S.stageTitles = saved._stageTitles;
    if (saved._novelKey) S.novelKey = saved._novelKey;
    if (saved._heavyFileKey) S.heavyFileKey = saved._heavyFileKey;
    if (saved._fileFingerprint) S.fileFingerprint = saved._fileFingerprint;
    if (saved._chunkKbUsed != null) S.chunkKbUsed = Number(saved._chunkKbUsed) || 0;
    if (saved._vecDone) S.vecDone = saved._vecDone;
    if (saved._stageVecDone) {
        S.stageVecDone = {};
        Object.entries(saved._stageVecDone).forEach(([k, v]) => {
            S.stageVecDone[Number(k)] = v;
        });
    }
    if (saved._stageVecExpected) {
        S.stageVecExpected = {};
        Object.entries(saved._stageVecExpected).forEach(([k, v]) => {
            const count = Math.max(0, parseInt(v, 10) || 0);
            if (count > 0) S.stageVecExpected[Number(k)] = count;
        });
    }
    if (saved._cleanDone != null) S.cleanDone = saved._cleanDone;
    if (saved._worldCategories) {
        S.worldCategories = saved._worldCategories;
    }
    // 同步插件开关 UI
    niSyncPluginToggleUI();

    // 加载后用 stageMap 重新同步所有 plot 的 stageIdx
    // stageMap key = main/pivot 数组下标
    // 同时补全 _chunkIdx 映射，确保角色 _firstChunkIdx 能命中
    if (S.stageMapN > 0 && Object.keys(S.stageMap).length > 0) {
        const mainArr2 = S.plots.main || [];
        const pivotArr2 = S.plots.pivot || [];
        mainArr2.forEach((plot, i) => {
            const mapped = S.stageMap[i] ?? S.stageMap[String(i)];
            if (mapped !== undefined && plot.stageIdx == null) {
                plot.stageIdx = mapped; plot.stageLabel = `第 ${mapped} 阶段`;
            }
        });
        pivotArr2.forEach((plot, i) => {
            const ci = mainArr2.length + i;
            const mapped = S.stageMap[ci] ?? S.stageMap[String(ci)];
            if (mapped !== undefined && plot.stageIdx == null) {
                plot.stageIdx = mapped; plot.stageLabel = `第 ${mapped} 阶段`;
            }
        });
        const subArr2 = S.plots.sub || [];
        subArr2.forEach(plot => {
            const mapped = niResolveSubPlotStageIdx(plot);
            if (mapped !== null && plot.stageIdx == null) { plot.stageIdx = mapped; plot.stageLabel = `第 ${mapped} 阶段`; }
        });
        niSyncSubPlotStageAssignments();
    }

    syncSettingsToUI();
    niLoadPlotPagesFromChat();
    niLoadStagePageFromChat();
    niLoadDeviationStateFromChat({ allowLegacyMigration: true, collapsed: true });

    // 启动时从服务端拉取重数据
    if (S.novelKey) {
        niServerLoadHeavy(S.novelKey, S.heavyFileKey, {
            chunks: false,
            legacyStages: saved,
        }).then(ok => {
            if (!ok) return;
            // 重数据已还原，刷新需要它的 UI
            if (canUseDerivedModules(S)) {
                if (S.chunkStatus.length) {
                    q('#ni-chunk-info') && (q('#ni-chunk-info').style.display = 'block');
                    q('#ni-st-chunks') && (q('#ni-st-chunks').textContent = S.chunkStatus.length);
                    renderChunkList();
                }
                niSyncCleanButtonState();
                niLoadPlotPagesFromChat();
                renderPlots(); renderCharacters(); buildStages(); niRenderWorldSettings();
                const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
                cfg._stageStates = { ...(S.stageStates || {}) };
                saveSettingsDebounced();
            }
            // Bug修复④：启动拉取重数据后刷新文风 UI
            {
                const resEl = q('#ni-style-result');
                if (resEl) resEl.value = S.styleGuide || '';
                const wrap = q('#ni-style-result-wrap');
                if (wrap) wrap.style.display = S.styleGuide ? 'block' : 'none';
                niSyncDeviationResultUI({ collapsed: true });
            }
        }).catch(e => console.warn('[NI] 启动拉取重数据失败:', e));
    }

    // 从 IndexedDB 反查真实向量状态，避免轻量设置里的 vecDone 与本机向量库不一致
    if (S.novelKey) {
        niReconcileVecStateFromDb().then(hasVectors => {
            if (hasVectors || S.stageMapN > 0) {
                buildStages();
            }
        }).catch(() => {});
    }
}


// ============================================================
// 服务端文件存储
// 文件名格式：
// ni_<用户快照名拼音>_<随机key>_core.json
// ni_<用户快照名拼音>_<随机key>_chunks.json
// ni_<用户快照名拼音>_<随机key>_stages.json
// 写：POST /api/files/upload body={name, data}
// 读：GET /user/files/<name>
// 删：POST /api/files/delete body={path:"user/files/<name>"}
// ============================================================

function niSaveSettings({ scheduleAutosave = true } = {}) {
    const cfg = extension_settings[EXT_NAME];
    cfg.cleanKey    = q('#ni-clean-key')?.value || cfg.cleanKey;
    cfg.cleanUrl    = q('#ni-clean-url')?.value || cfg.cleanUrl;
    cfg.cleanModel  = q('#ni-clean-model')?.value || cfg.cleanModel;
    cfg.cleanStream = q('#ni-clean-stream')?.checked ?? cfg.cleanStream;
    cfg.cleanAutoResume = q('#ni-clean-auto-resume')?.checked ?? cfg.cleanAutoResume;
    cfg.vecKey      = q('#ni-vec-key')?.value || cfg.vecKey;
    cfg.vecUrl      = q('#ni-vec-url')?.value || cfg.vecUrl;
    cfg.vecModel    = q('#ni-vec-model')?.value || cfg.vecModel;
    cfg.injDepth    = parseInt(q('#ni-inj-depth')?.value) || DEFAULT_SETTINGS.injDepth;
    cfg.vecInjPos   = parseInt(q('#ni-vec-inj-pos')?.value) ?? DEFAULT_SETTINGS.vecInjPos;
    cfg.vecInjRole  = parseInt(q('#ni-vec-inj-role')?.value) ?? DEFAULT_SETTINGS.vecInjRole;
    cfg.recallTopK  = parseInt(q('#ni-recall-topk')?.value) || DEFAULT_SETTINGS.recallTopK;
    cfg.recallThresh= parseFloat(q('#ni-recall-thresh')?.value) ?? DEFAULT_SETTINGS.recallThresh;
    cfg.vecMsgTag   = (q('#ni-vec-msg-tag')?.value || '').trim();
    cfg.vecMsgCount = parseInt(q('#ni-vec-msg-count')?.value) || DEFAULT_SETTINGS.vecMsgCount;
    cfg.charInjPos  = parseInt(q('#ni-char-inj-pos')?.value) ?? DEFAULT_SETTINGS.charInjPos;
    cfg.charInjDepth= parseInt(q('#ni-char-inj-depth')?.value) ?? DEFAULT_SETTINGS.charInjDepth;
    cfg.charInjRole = parseInt(q('#ni-char-inj-role')?.value) ?? DEFAULT_SETTINGS.charInjRole;
    cfg.charAutoSleepEnabled = q('#ni-char-auto-sleep-btn')
        ? q('#ni-char-auto-sleep-btn').classList.contains('on')
        : (cfg.charAutoSleepEnabled ?? DEFAULT_SETTINGS.charAutoSleepEnabled);
    cfg.charPageSize = Math.max(1, Math.min(200,
        parseInt(q('#ni-char-page-size')?.value ?? cfg.charPageSize, 10) || DEFAULT_SETTINGS.charPageSize
    ));
    cfg.plotInjPos  = parseInt(q('#ni-plot-inj-pos')?.value) ?? DEFAULT_SETTINGS.plotInjPos;
    cfg.plotInjDepth= parseInt(q('#ni-plot-inj-depth')?.value) ?? DEFAULT_SETTINGS.plotInjDepth;
    cfg.plotInjRole = parseInt(q('#ni-plot-inj-role')?.value) ?? DEFAULT_SETTINGS.plotInjRole;
    cfg.plotInjMaxTokens = niNormalizeRawInjectionMaxTokens(
        q('#ni-plot-inj-max-tokens')?.value ?? cfg.plotInjMaxTokens,
        DEFAULT_SETTINGS.plotInjMaxTokens,
    );
    cfg.stagePageSize = Math.max(1, Math.min(200,
        parseInt(q('#ni-stage-page-size')?.value ?? cfg.stagePageSize, 10) || DEFAULT_SETTINGS.stagePageSize
    ));
    cfg.novelLibraryPageSize = Math.max(1, Math.min(200,
        parseInt(q('#ni-lib-page-size')?.value ?? cfg.novelLibraryPageSize, 10) || DEFAULT_SETTINGS.novelLibraryPageSize
    ));
    cfg.devPrompt   = q('#ni-dev-pt-content')?.value || cfg.devPrompt || DEFAULT_SETTINGS.devPrompt;
    cfg.devInjPos   = niCfgInt('#ni-dev-inj-pos', DEFAULT_SETTINGS.devInjPos);
    cfg.devInjDepth = niCfgInt('#ni-dev-inj-depth', DEFAULT_SETTINGS.devInjDepth);
    cfg.devInjRole  = niCfgInt('#ni-dev-inj-role', DEFAULT_SETTINGS.devInjRole);
    cfg.devAutoUpdateEnabled = q('#ni-dev-auto-enabled')?.checked ?? (cfg.devAutoUpdateEnabled ?? DEFAULT_SETTINGS.devAutoUpdateEnabled);
    cfg.devAutoUpdateEvery = niCfgBoundInt('#ni-dev-auto-every', DEFAULT_SETTINGS.devAutoUpdateEvery, 1, 9999);
    cfg.devManualMsgCount = niCfgBoundInt('#ni-dev-manual-msg-count', DEFAULT_SETTINGS.devManualMsgCount, 1, 200);
    cfg.rawInjMode  = niNormalizeRawInjMode(q('#ni-raw-inj-mode')?.value ?? cfg.rawInjMode);
    cfg.chunkKb     = parseInt(q('#ni-chunk-kb')?.value) || DEFAULT_SETTINGS.chunkKb;
    cfg.customPrompt    = q('#ni-pt-content')?.value || CLEAN_PROMPT;
    cfg.roleplayPrompt  = q('#ni-stage-pt-content')?.value || extension_settings[EXT_NAME]?.roleplayPrompt || ROLEPLAY_PROMPT;
    cfg.roleplayEnabled = q('#ni-stage-pt-enabled')?.checked ?? (extension_settings[EXT_NAME]?.roleplayEnabled !== false);
    if (q('#ni-global-source-tavern')?.checked) {
        cfg.globalPromptSource = 'tavern';
    } else if (q('#ni-global-source-builtin')?.checked) {
        cfg.globalPromptSource = 'builtin';
    } else if (q('#ni-global-source-none')?.checked) {
        cfg.globalPromptSource = 'none';
    } else {
        cfg.globalPromptSource = niNormalizeGlobalPromptSource(cfg.globalPromptSource);
    }
    const _gp = q('#ni-global-pt-content')?.value;
    cfg.globalPrompt = (_gp && _gp.trim()) ? _gp : (extension_settings[EXT_NAME]?.globalPrompt ?? GLOBAL_PROMPT);
    cfg.globalTailPrompt = q('#ni-global-tail-pt-content')?.value ?? (extension_settings[EXT_NAME]?.globalTailPrompt ?? GLOBAL_TAIL_PROMPT);
    cfg.globalHeadInjPos = niCfgInt('#ni-global-head-inj-pos', DEFAULT_SETTINGS.globalHeadInjPos);
    cfg.globalHeadInjDepth = niCfgInt('#ni-global-head-inj-depth', DEFAULT_SETTINGS.globalHeadInjDepth);
    cfg.globalHeadInjRole = niCfgInt('#ni-global-head-inj-role', DEFAULT_SETTINGS.globalHeadInjRole);
    cfg.globalTailInjPos = niCfgInt('#ni-global-tail-inj-pos', DEFAULT_SETTINGS.globalTailInjPos);
    cfg.globalTailInjDepth = niCfgInt('#ni-global-tail-inj-depth', DEFAULT_SETTINGS.globalTailInjDepth);
    cfg.globalTailInjRole = niCfgInt('#ni-global-tail-inj-role', DEFAULT_SETTINGS.globalTailInjRole);
    cfg.apiTimeoutMin = Math.max(1, parseInt(q('#ni-api-timeout')?.value) || DEFAULT_SETTINGS.apiTimeoutMin);
    cfg.apiRateLimit  = Math.max(0, parseInt(q('#ni-rate-limit')?.value) ?? DEFAULT_SETTINGS.apiRateLimit);
    cfg.apiConcurrency = niCfgBoundInt('#ni-api-concurrency', DEFAULT_SETTINGS.apiConcurrency, 0, 99);
    cfg.vecRateLimit  = Math.max(0, parseInt(q('#ni-vec-rate-limit')?.value) ?? DEFAULT_SETTINGS.vecRateLimit);
    cfg.vecConcurrency = niCfgBoundInt('#ni-vec-concurrency', DEFAULT_SETTINGS.vecConcurrency, 0, 99);
    cfg.vecBatchSize = niCfgBoundInt('#ni-vec-batch-size', DEFAULT_SETTINGS.vecBatchSize, 1, 100);
    // 持久化运行时数据
    const nextNovelKey = S.novelKey || '';
    if ((cfg._novelKey || '') !== nextNovelKey) {
        delete cfg._stageMap;
        delete cfg._stageMapN;
        delete cfg._chunkStageMap;
    }
    cfg._stageStates   = S.stageStates;
    cfg._stageSummaries= S.stageSummaries;
    cfg._stageTitles   = S.stageTitles;
    cfg._novelKey      = nextNovelKey;
    cfg._heavyFileKey  = S.heavyFileKey;
    cfg._fileFingerprint = S.fileFingerprint;
    cfg._chunkKbUsed   = S.chunkKbUsed;
    cfg._vecDone       = S.vecDone;
    cfg._stageVecDone  = S.stageVecDone;
    cfg._stageVecExpected = S.stageVecExpected;
    cfg._cleanDone     = S.cleanDone;
    cfg._worldCategories = niGetWorldCategories();
    niClearLegacyDeviationSettings();
    cfg.worldInjPos   = parseInt(q('#ni-world-inj-pos')?.value)   ?? DEFAULT_SETTINGS.worldInjPos;
    cfg.worldInjDepth = parseInt(q('#ni-world-inj-depth')?.value)  ?? DEFAULT_SETTINGS.worldInjDepth;
    cfg.worldInjRole  = parseInt(q('#ni-world-inj-role')?.value)   ?? DEFAULT_SETTINGS.worldInjRole;

    // 文风设置
    cfg.styleInjPos   = parseInt(q('#ni-style-inj-pos2')?.value)   ?? DEFAULT_SETTINGS.styleInjPos;
    cfg.styleInjDepth = parseInt(q('#ni-style-inj-depth2')?.value)  ?? DEFAULT_SETTINGS.styleInjDepth;
    cfg.styleInjRole  = parseInt(q('#ni-style-inj-role2')?.value)   ?? DEFAULT_SETTINGS.styleInjRole;
    cfg.styleSampleLen= parseInt(q('#ni-style-sample-len')?.value) || DEFAULT_SETTINGS.styleSampleLen;
    cfg.styleChunkIdx = parseInt(q('#ni-style-chunk-sel')?.value)  || 0;
    cfg.styleMode     = q('#ni-style-mode')?.value                 ?? DEFAULT_SETTINGS.styleMode;
    cfg.autoSaveEnabled = q('#ni-autosave-chk')?.checked ?? (cfg.autoSaveEnabled ?? DEFAULT_SETTINGS.autoSaveEnabled);

    saveSettingsDebounced();
    if (scheduleAutosave) niAutosave?.schedule();
}

async function niSaveStageRuntimeSettings({ saveMapping = false } = {}) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg._stageStates = { ...(S.stageStates || {}) };
    saveSettingsDebounced();
    if (saveMapping && S.novelKey) {
        try {
            await niServerSaveStages(S.novelKey, S.heavyFileKey);
        } catch (e) {
            console.warn('[NI] 阶段划分独立保存失败:', e);
        }
    }
    niAutosave?.schedule();
}

function niResolveStageInjectionExecutionPlan(cfg = extension_settings[EXT_NAME] || {}) {
    const enabledStages = [];
    for (let i = 1; i <= S.stageMapN; i++) {
        if (S.stageStates[i] !== false) enabledStages.push(i);
    }
    const { rawStages, vectorInjectionDisabled } = niResolveStageInjectionPlan({
        enabledStages,
        stageVecDone: S.stageVecDone,
        settings: cfg,
    });

    let curTbNode = null;
    if (cfg.transBookMode) {
        curTbNode = niTbGetInjectionNode(niGetTbNodes());
    }
    const vectorRecallScope = niResolveVectorRecallStageScopes({
        enabledStages,
        stageVecDone: S.stageVecDone,
        currentStageIdx: curTbNode?.stageIdx,
    });
    const directStageCurrentIdx = curTbNode?.stageIdx ?? vectorRecallScope.boundaryStageIdx;
    const directStageInjectionStages = niResolveDirectStageInjectionStages({
        rawStages,
        transBookMode: !!cfg.transBookMode,
        currentStageIdx: directStageCurrentIdx,
        paused: !!S.tbPaused,
    });

    return {
        enabledStages,
        rawStages,
        vectorInjectionDisabled,
        curTbNode,
        vectorRecallScope,
        directStageCurrentIdx,
        directStageInjectionStages,
    };
}

function niBuildStageInjectionPayloadForPlan(plan, cfg = extension_settings[EXT_NAME] || {}) {
    const rawMode = niNormalizeRawInjMode(cfg.rawInjMode);
    const runtimeIndex = niBuildStageRuntimeIndex(S);
    const maxTokens = niNormalizeRawInjectionMaxTokens(
        cfg.plotInjMaxTokens,
        DEFAULT_SETTINGS.plotInjMaxTokens,
    );
    return niBuildStageInjectionPayload({
        stageIndices: plan.directStageInjectionStages,
        currentStageIdx: plan.directStageCurrentIdx,
        maxTokens,
        rawMode,
        getDetailText: si => {
            const getCompressedChunkText = ci => (S.chunkResults[ci] && S.chunkResults[ci].trim())
                ? S.chunkResults[ci]
                : (S.chunks[ci] || '');
            // 穿书模式只发当前正在进行的那个节点；阶段里排在它后面的还没演到。
            const tbDetail = niBuildTransbookStageDetailText(si, plan.curTbNode, {
                rawMode,
                getCompressedChunkText,
            });
            if (tbDetail != null) return tbDetail;

            if (rawMode === 'compressed') {
                const chunkIdxSet = runtimeIndex.chunkIdxsByStage[si] || new Set();
                const texts = [...chunkIdxSet].sort((a, b) => a - b)
                    .map(getCompressedChunkText)
                    .filter(text => String(text || '').trim());
                return texts.length ? `【第 ${si} 阶段压缩原文】\n${texts.join('\n')}` : '';
            }
            const nodes = runtimeIndex.nodesByStage[si] || { main: [], sub: [], pivot: [] };
            const allNodes = niMergeStageNodes(nodes);
            if (!allNodes.length) return '';
            return `【第 ${si} 阶段剧情节点】\n${allNodes
                .map(plot => `· ${plot.title || '未命名节点'}：${plot.body || plot.content || ''}`)
                .join('\n')}`;
        },
        getSummaryText: si => {
            const summary = String(S.stageSummaries?.[si] || '').trim();
            return summary ? `【第 ${si} 阶段概括】\n${summary}` : '';
        },
    });
}

function niBuildStageInjectionBudgetPreview() {
    const cfg = extension_settings[EXT_NAME] || {};
    const plan = niResolveStageInjectionExecutionPlan(cfg);
    if (!plan.directStageInjectionStages.length) return null;
    return niBuildStageInjectionPayloadForPlan(plan, cfg);
}

function niUpdateStageInjectionBudgetNote(result = null, {
    visible,
} = {}) {
    const note = q('#ni-stage-inj-budget-note');
    if (!note) return;
    let displayResult = result;
    let shouldDisplay = visible;
    if (displayResult == null && shouldDisplay !== false) {
        displayResult = niBuildStageInjectionBudgetPreview();
        if (shouldDisplay == null) shouldDisplay = !!displayResult;
    }
    if (shouldDisplay == null) shouldDisplay = !!displayResult;
    note.style.display = shouldDisplay ? '' : 'none';
    if (!shouldDisplay) {
        note.classList.remove('ni-stage-budget-warning');
        return;
    }
    const cfg = extension_settings[EXT_NAME] || {};
    const maxTokens = niNormalizeRawInjectionMaxTokens(
        cfg.plotInjMaxTokens,
        DEFAULT_SETTINGS.plotInjMaxTokens,
    );
    if (!displayResult) {
        if (cfg.transBookMode) {
            note.style.display = 'none';
            note.classList.remove('ni-stage-budget-warning');
            return;
        }
        note.textContent = `未向量阶段单轮注入上限：${maxTokens.toLocaleString()} Token`;
        note.classList.remove('ni-stage-budget-warning');
        return;
    }
    const summaryCount = displayResult.summaryStages?.length || 0;
    const omittedCount = displayResult.omittedStages?.length || 0;
    const emptyCount = displayResult.emptyStages?.length || 0;
    const parts = [`本轮约 ${Number(displayResult.estimatedTokens || 0).toLocaleString()} Token`];
    if (summaryCount) parts.push(`${summaryCount} 个阶段使用概括`);
    if (omittedCount) parts.push(`${omittedCount} 个阶段因超出上限未注入`);
    if (emptyCount) parts.push(`${emptyCount} 个阶段无可用内容`);
    if (displayResult.truncated === true) parts.push('当前阶段内容已按上限截断');
    const limitSuffix = cfg.transBookMode
        ? ''
        : `（上限 ${maxTokens.toLocaleString()}）`;
    note.textContent = `${parts.join('，')}${limitSuffix}`;
    note.classList.toggle('ni-stage-budget-warning', omittedCount > 0 || displayResult.truncated === true);
}

function syncSettingsToUI() {
    const cfg = extension_settings[EXT_NAME] || {};
    sv('#ni-clean-key',    cfg.cleanKey    || '');
    sv('#ni-clean-url',    cfg.cleanUrl    || DEFAULT_SETTINGS.cleanUrl);
    sv('#ni-clean-model',  cfg.cleanModel  || DEFAULT_SETTINGS.cleanModel);
    const streamEl = q('#ni-clean-stream');
    if (streamEl) {
        streamEl.checked = cfg.cleanStream ?? DEFAULT_SETTINGS.cleanStream;
        const pill = q('#ni-stream-pill');
        if (pill) pill.textContent = streamEl.checked ? '开' : '关';
    }
    const autoResumeEl = q('#ni-clean-auto-resume');
    if (autoResumeEl) {
        autoResumeEl.checked = !!(cfg.cleanAutoResume ?? DEFAULT_SETTINGS.cleanAutoResume);
        const autoResumePill = q('#ni-clean-auto-resume-pill');
        if (autoResumePill) autoResumePill.textContent = autoResumeEl.checked ? '开' : '关';
    }
    sv('#ni-vec-key',      cfg.vecKey      || '');
    sv('#ni-vec-url',      cfg.vecUrl      || DEFAULT_SETTINGS.vecUrl);
    sv('#ni-vec-model',    cfg.vecModel    || DEFAULT_SETTINGS.vecModel);
    sv('#ni-inj-depth',    cfg.injDepth    ?? DEFAULT_SETTINGS.injDepth);
    sv('#ni-vec-inj-pos',  cfg.vecInjPos   ?? DEFAULT_SETTINGS.vecInjPos);
    sv('#ni-vec-inj-role', cfg.vecInjRole  ?? DEFAULT_SETTINGS.vecInjRole);
    sv('#ni-recall-topk',  cfg.recallTopK  ?? DEFAULT_SETTINGS.recallTopK);
    sv('#ni-recall-thresh',cfg.recallThresh?? DEFAULT_SETTINGS.recallThresh);
    sv('#ni-vec-msg-tag',  cfg.vecMsgTag   ?? DEFAULT_SETTINGS.vecMsgTag);
    sv('#ni-vec-msg-count', cfg.vecMsgCount ?? DEFAULT_SETTINGS.vecMsgCount);
    sv('#ni-char-inj-pos', cfg.charInjPos  ?? DEFAULT_SETTINGS.charInjPos);
    sv('#ni-char-inj-depth',cfg.charInjDepth?? DEFAULT_SETTINGS.charInjDepth);
    sv('#ni-char-inj-role',cfg.charInjRole ?? DEFAULT_SETTINGS.charInjRole);
    sv('#ni-char-page-size', cfg.charPageSize ?? DEFAULT_SETTINGS.charPageSize);
    niSyncCharAutoSleepUI();
    sv('#ni-plot-inj-pos', cfg.plotInjPos  ?? DEFAULT_SETTINGS.plotInjPos);
    sv('#ni-plot-inj-depth',cfg.plotInjDepth?? DEFAULT_SETTINGS.plotInjDepth);
    sv('#ni-plot-inj-role',cfg.plotInjRole ?? DEFAULT_SETTINGS.plotInjRole);
    sv('#ni-plot-inj-max-tokens', cfg.plotInjMaxTokens ?? DEFAULT_SETTINGS.plotInjMaxTokens);
    sv('#ni-stage-page-size', cfg.stagePageSize ?? DEFAULT_SETTINGS.stagePageSize);
    sv('#ni-lib-page-size', cfg.novelLibraryPageSize ?? DEFAULT_SETTINGS.novelLibraryPageSize);
    niUpdateStageInjectionBudgetNote();
    sv('#ni-dev-inj-pos', cfg.devInjPos  ?? DEFAULT_SETTINGS.devInjPos);
    sv('#ni-dev-inj-depth',cfg.devInjDepth?? DEFAULT_SETTINGS.devInjDepth);
    sv('#ni-dev-inj-role',cfg.devInjRole ?? DEFAULT_SETTINGS.devInjRole);
    sv('#ni-dev-auto-every', niBoundIntValue(cfg.devAutoUpdateEvery, DEFAULT_SETTINGS.devAutoUpdateEvery, 1, 9999));
    sv('#ni-dev-manual-msg-count', cfg.devManualMsgCount ?? DEFAULT_SETTINGS.devManualMsgCount);
    const devAutoEl = q('#ni-dev-auto-enabled');
    if (devAutoEl) devAutoEl.checked = !!(cfg.devAutoUpdateEnabled ?? DEFAULT_SETTINGS.devAutoUpdateEnabled);
    niSyncDevAutoUI();
    sv('#ni-raw-inj-mode', cfg.rawInjMode  ?? DEFAULT_SETTINGS.rawInjMode);
    sv('#ni-global-head-inj-pos', cfg.globalHeadInjPos ?? DEFAULT_SETTINGS.globalHeadInjPos);
    sv('#ni-global-head-inj-depth', cfg.globalHeadInjDepth ?? DEFAULT_SETTINGS.globalHeadInjDepth);
    sv('#ni-global-head-inj-role', cfg.globalHeadInjRole ?? DEFAULT_SETTINGS.globalHeadInjRole);
    sv('#ni-global-tail-inj-pos', cfg.globalTailInjPos ?? DEFAULT_SETTINGS.globalTailInjPos);
    sv('#ni-global-tail-inj-depth', cfg.globalTailInjDepth ?? DEFAULT_SETTINGS.globalTailInjDepth);
    sv('#ni-global-tail-inj-role', cfg.globalTailInjRole ?? DEFAULT_SETTINGS.globalTailInjRole);
    sv('#ni-world-inj-pos',  cfg.worldInjPos   ?? DEFAULT_SETTINGS.worldInjPos);
    sv('#ni-world-inj-depth',cfg.worldInjDepth ?? DEFAULT_SETTINGS.worldInjDepth);
    sv('#ni-world-inj-role', cfg.worldInjRole  ?? DEFAULT_SETTINGS.worldInjRole);
    // 文风设置
    sv('#ni-style-inj-pos2',  cfg.styleInjPos   ?? DEFAULT_SETTINGS.styleInjPos);
    sv('#ni-style-inj-depth2',cfg.styleInjDepth ?? DEFAULT_SETTINGS.styleInjDepth);
    sv('#ni-style-inj-role2', cfg.styleInjRole  ?? DEFAULT_SETTINGS.styleInjRole);
    sv('#ni-style-sample-len',cfg.styleSampleLen ?? DEFAULT_SETTINGS.styleSampleLen);
    sv('#ni-style-mode',      cfg.styleMode      ?? DEFAULT_SETTINGS.styleMode);
    const stylePtEl = q('#ni-style-pt-content');
    if (stylePtEl) stylePtEl.value = cfg.stylePrompt || STYLE_PROMPT;
    const devPtEl = q('#ni-dev-pt-content');
    if (devPtEl) devPtEl.value = cfg.devPrompt || DEFAULT_SETTINGS.devPrompt;
    niSyncDeviationResultUI({ collapsed: true });
    // Bug修复②③：始终刷新文风结果 UI，有内容则显示，无内容则隐藏
    {
        const resEl = q('#ni-style-result');
        if (resEl) resEl.value = S.styleGuide || '';
        const wrap = q('#ni-style-result-wrap');
        if (wrap) wrap.style.display = S.styleGuide ? 'block' : 'none';
    }
    niStyleSyncMode();
    niRenderUserSubUI();
    sv('#ni-chunk-kb',     cfg.chunkKb     ?? DEFAULT_SETTINGS.chunkKb);
    sv('#ni-api-timeout',  cfg.apiTimeoutMin ?? DEFAULT_SETTINGS.apiTimeoutMin);
    sv('#ni-rate-limit',   cfg.apiRateLimit  ?? DEFAULT_SETTINGS.apiRateLimit);
    sv('#ni-api-concurrency', cfg.apiConcurrency ?? DEFAULT_SETTINGS.apiConcurrency);
    sv('#ni-vec-rate-limit', cfg.vecRateLimit ?? DEFAULT_SETTINGS.vecRateLimit);
    sv('#ni-vec-concurrency', cfg.vecConcurrency ?? DEFAULT_SETTINGS.vecConcurrency);
    sv('#ni-vec-batch-size', cfg.vecBatchSize ?? DEFAULT_SETTINGS.vecBatchSize);
    niSyncThemeUI();
    niApplyCurrentTheme();
    const ptEl = q('#ni-pt-content');
    if (ptEl) ptEl.value = extension_settings[EXT_NAME]?.customPrompt || CLEAN_PROMPT;
    const globalPtEl = q('#ni-global-pt-content');
    if (globalPtEl) globalPtEl.value = cfg.globalPrompt ?? GLOBAL_PROMPT;
    const globalTailPtEl = q('#ni-global-tail-pt-content');
    if (globalTailPtEl) globalTailPtEl.value = cfg.globalTailPrompt ?? GLOBAL_TAIL_PROMPT;
    niSyncGlobalPromptSourceUI(cfg);
    // 修复：初始化时同步渲染小说库，不依赖导航按钮点击
    niRenderNovelLibrary();
    // 同步穿书模式状态文字
    const _tbChk = q('#ni-tb-chk');
    const _tbStateTxt = q('#ni-tb-state');
    if (_tbChk && _tbStateTxt) {
        _tbChk.checked = !!cfg.transBookMode;
        _tbStateTxt.textContent = _tbChk.checked ? '开' : '关';
    }
}

// ============================================================
// DOM 工具
// ============================================================
const q  = sel => document.querySelector(sel);
const qa = sel => document.querySelectorAll(sel);
const sv = (sel, val) => { const el = q(sel); if (el) el.value = val; };
let _niTopbarIconToggleBound = false;
const niCfgInt = (sel, fallback) => {
    const n = parseInt(q(sel)?.value, 10);
    return Number.isFinite(n) ? n : fallback;
};
const niBoundIntValue = (value, fallback, min = 0, max = 9999) => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return fallback;
    return Math.min(max, n);
};
const niCfgBoundInt = (sel, fallback, min = 0, max = 9999) => {
    return niBoundIntValue(q(sel)?.value, fallback, min, max);
};

function niTopbarIconVisible() {
    const cfg = extension_settings[EXT_NAME] || {};
    return (cfg.topbarIconVisible ?? DEFAULT_SETTINGS.topbarIconVisible) !== false;
}

function niCloseTopbarDrawer() {
    const icon = $('#ni_drawer_icon');
    const content = $('#ni_drawer_content');
    if (icon.length) icon.removeClass('openIcon').addClass('closedIcon');
    if (content.length) {
        content.removeClass('openDrawer').addClass('closedDrawer')
            .attr('data-slide-toggle', 'hidden')
            .css('display', 'none');
    }
}

function niSyncExtensionsMenuTopbarToggle() {
    const enabled = niTopbarIconVisible();
    const item = q('#ni-toggle-topbar-icon');
    const icon = q('#ni-toggle-topbar-icon .extensionsMenuExtensionButton');
    const state = q('#ni-toggle-topbar-icon-state');
    if (item) {
        item.classList.toggle('ni-topbar-icon-off', !enabled);
        item.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        item.title = enabled ? '隐藏顶栏图标' : '显示顶栏图标';
    }
    if (icon) icon.className = `fa-fw fa-solid ${enabled ? 'fa-book-open' : 'fa-book'} extensionsMenuExtensionButton`;
    if (state) state.textContent = enabled ? '开' : '关';
}

function niSyncTopbarIconVisibility() {
    const enabled = niTopbarIconVisible();
    const drawer = q('#ni_drawer');
    if (drawer) {
        if (!enabled) {
            niCloseTopbarDrawer();
        } else {
            q('#ni_drawer_content')?.style.removeProperty('display');
        }
        drawer.style.display = enabled ? '' : 'none';
    }
    niSyncExtensionsMenuTopbarToggle();
}

function niEnsureExtensionsMenuTopbarToggle() {
    const menu = q('#extensionsMenu');
    if (!menu) return false;
    let container = q('#ni_topbar_icon_wand_container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'ni_topbar_icon_wand_container';
        container.className = 'extension_container interactable';
        container.tabIndex = 0;
        container.innerHTML = `
<div id="ni-toggle-topbar-icon" class="list-group-item flex-container flexGap5 interactable" title="隐藏顶栏图标" tabindex="0" role="button" aria-pressed="true">
    <div class="fa-fw fa-solid fa-book-open extensionsMenuExtensionButton" aria-hidden="true"></div>
    <span>顶栏图标</span>
    <span id="ni-toggle-topbar-icon-state" class="ni-ext-menu-state">开</span>
</div>`;
        const quickCss = q('#quick-css-ext-button');
        if (quickCss?.parentElement === menu) {
            menu.insertBefore(container, quickCss);
        } else {
            menu.appendChild(container);
        }
    }
    niSyncExtensionsMenuTopbarToggle();
    return true;
}

function niSetTopbarIconVisible(visible) {
    const cfg = extension_settings[EXT_NAME] || {};
    extension_settings[EXT_NAME] = cfg;
    cfg.topbarIconVisible = visible !== false;
    niSyncTopbarIconVisibility();
    saveSettingsDebounced();
}

function niBindTopbarIconToggleHandlers() {
    if (_niTopbarIconToggleBound) return;
    _niTopbarIconToggleBound = true;
    $(document)
        .on('click.niTopbarIconToggle', '#ni-toggle-topbar-icon', function(e) {
            e.preventDefault();
            e.stopPropagation();
            niSetTopbarIconVisible(!niTopbarIconVisible());
        })
        .on('keydown.niTopbarIconToggle', '#ni-toggle-topbar-icon', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            niSetTopbarIconVisible(!niTopbarIconVisible());
        })
        .on('click.niTopbarIconToggle', '#extensionsMenuButton', function() {
            setTimeout(niEnsureExtensionsMenuTopbarToggle, 0);
            setTimeout(niEnsureExtensionsMenuTopbarToggle, 120);
        });
}

function niSyncDevAutoUI({ syncNote = false } = {}) {
    const input = q('#ni-dev-auto-every');
    const row = input?.closest('.ni-dev-auto-row');
    const enabled = !!q('#ni-dev-auto-enabled')?.checked;
    if (input) input.disabled = false;
    if (row) row.hidden = false;
    const noteEl = q('#ni-dev-note');
    if (!noteEl) return;
    if (syncNote) {
        noteEl.textContent = enabled
            ? '自动更新已开启，达到间隔层数后会自动运行。'
            : '自动更新已关闭，间隔层数可调整但不会自动运行。';
        return;
    }
    if (!enabled && /自动更新已开启|正在检查是否需要补跑偏差分析/.test(noteEl.textContent || '')) {
        noteEl.textContent = '自动更新已关闭，间隔层数可调整但不会自动运行。';
    }
}

// ============================================================
// 页面切换
// ============================================================
function niSwitchPage(name, btn) {
    qa('.ni-page').forEach(p => p.classList.remove('on'));
    q(`#ni-pg-${name}`)?.classList.add('on');
    qa('.ni-nav-btn').forEach(b => b.classList.remove('on'));
    btn?.classList.add('on');
    q('#ni-scroll')?.scrollTo(0, 0);
}
window.niSwitchPage = niSwitchPage;
window.niSaveSettings = niSaveSettings;

/**
 * 底栏导航切换（含页面附加刷新；独立于巨型初始化，任何一步失败都不影响切页）。
 */
function niNavSwitchPage(page, btn) {
    niSwitchPage(page, btn);
    try {
        if (page === 'plot') renderPlots({ force: true });
        if (page === 'char') renderCharacters({ force: true });
        if (page === 'stage') niBuildStagesWithChunksIfNeeded();
        if (page === 'enrich') niEnrichRenderList();
    } catch (err) {
        console.warn('[NI] 导航切换附加刷新失败:', err?.message || err);
    }
}

/**
 * 底栏导航全局兜底绑定（不依赖巨型初始化完成）：
 * - document 捕获阶段 + composedPath：兼容 shadow DOM / 任何 stopPropagation / WebView 吞事件；
 * - click + pointerup + touchend 三重触发，450ms 时间去重；
 * - 指针/触摸位移 >12px 视为滑动，不算点击。
 */
function niBindNavbarGlobal() {
    if (typeof window !== 'undefined' && window._niNavbarGlobalBound) return;
    if (typeof window !== 'undefined') window._niNavbarGlobalBound = true;
    let lastFire = 0;
    let ptrStart = null;
    let touchStart = null;

    function hit(e) {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        for (const el of path) {
            if (!el || typeof el.classList === 'undefined') continue;
            if (typeof el.classList.contains === 'function' && el.classList.contains('ni-nav-btn')) {
                const page = el.dataset && el.dataset.page;
                if (page) return { btn: el, page };
            }
        }
        const t = e.target;
        if (t && typeof t.closest === 'function') {
            const btn = t.closest('.ni-nav-btn');
            if (btn && btn.dataset && btn.dataset.page) return { btn, page: btn.dataset.page };
        }
        return null;
    }
    function fire(e) {
        const h = hit(e);
        if (!h) return;
        const now = Date.now();
        if (now - lastFire < 450) return;
        lastFire = now;
        niNavSwitchPage(h.page, h.btn);
        console.log(`[NI] 导航切换 → ${h.page}`);
    }

    document.addEventListener('click', fire, true);
    document.addEventListener('pointerdown', (e) => { ptrStart = { x: e.clientX, y: e.clientY }; }, true);
    document.addEventListener('pointerup', (e) => {
        if (ptrStart && Math.hypot(e.clientX - ptrStart.x, e.clientY - ptrStart.y) > 12) {
            ptrStart = null;
            return;
        }
        ptrStart = null;
        fire(e);
    }, true);
    document.addEventListener('touchstart', (e) => {
        const t = e.touches && e.touches[0];
        touchStart = t ? { x: t.clientX, y: t.clientY } : null;
    }, true);
    document.addEventListener('touchend', (e) => {
        const h = hit(e);
        if (!h) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (touchStart && t && Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y) > 12) {
            touchStart = null;
            return;
        }
        touchStart = null;
        fire(e);
    }, true);
}

/**
 * 弹窗/关键操作按钮的全局动作分发（document 捕获阶段 + composedPath）。
 * 与导航兜底同理：不依赖 $app 委托（TauriTavern 安卓上 $app 委托不可靠）。
 * 这些按钮的 $app 绑定已移除，本分发是唯一来源，不会重复触发。
 */
function niBindGlobalActions() {
    if (typeof window !== 'undefined' && window._niGlobalActionsBound) return;
    if (typeof window !== 'undefined') window._niGlobalActionsBound = true;

    const ACTIONS = {
        'ni-e-detail-cancel': () => niEnrichCloseDetail(),
        'ni-e-detail-save': () => niEnrichSaveDetail(),
        'ni-e-detail-split': () => niEnrichSplitDetail(),
        'ni-e-detail-enrich-btn': () => { const btn = document.getElementById('ni-e-detail-enrich-btn'); if (btn) void niEnrichDetailGenerate(btn); },
        'ni-e-detail-enrich-stop': () => _niEnrichDetailController?.abort?.(),
        'ni-e-report-close': () => { const el = document.getElementById('ni-e-report-modal'); if (el) el.style.display = 'none'; },
        'ni-e-report-restore': () => niEnrichRestoreFiltered(),
        'ni-vec-debug-close': () => { const el = document.getElementById('ni-vec-debug-modal'); if (el) el.style.display = 'none'; },
        // 判定工具栏（原 $app 委托在安卓 WebView 不可靠，统一走全局分发）
        'ni-btn-judge': () => { void niJudgeStartQueue(); },
        'ni-btn-judge-pause': () => niJudgeActiveQueue()?.pause(),
        'ni-btn-judge-skip': () => niJudgeActiveQueue()?.skipCurrent(),
        'ni-btn-judge-cancel': () => niJudgeActiveQueue()?.cancelAll(),
        'ni-btn-judge-retry': () => niJudgeRejudgeFailed(),
        'ni-btn-judge-reall': () => niJudgeRejudgeAll(),
        'ni-btn-judge-scan': () => niJudgeKeywordScan(),
        'ni-btn-judge-refine': () => niJudgeAiRefine(),
        'ni-btn-judge-csv': () => niJudgeExportCsv(),
        // 加料工具栏
        'ni-btn-enrich': () => { void niEnrichStartQueue(); },
        'ni-btn-enrich-pause': () => niEnrichQueue?.pause(),
        'ni-btn-enrich-skip': () => niEnrichQueue?.skipCurrent(),
        'ni-btn-enrich-cancel': () => niEnrichQueue?.cancelAll(),
        'ni-btn-enrich-retry': () => niEnrichQueue?.run(),
    };

    document.addEventListener('click', (e) => {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        let target = null;
        for (const el of path) {
            if (!el || typeof el.id !== 'string' || !el.id) continue;
            if (Object.prototype.hasOwnProperty.call(ACTIONS, el.id)) { target = el; break; }
        }
        if (!target && e.target && e.target.id && Object.prototype.hasOwnProperty.call(ACTIONS, e.target.id)) {
            target = e.target;
        }
        if (!target) return;
        const id = target.id;
        if (target.disabled === true) return;
        console.log(`[NI] 全局动作分发 → #${id}`);
        try {
            ACTIONS[id]();
        } catch (err) {
            console.error(`[NI] 动作执行失败 #${id}:`, err);
            toastr?.error?.('[NI] ' + (err?.message || err));
        }
    }, true);
}

// ============================================================
// Tab 切换
// ============================================================
function niSwitchTab(name, btn) {
    const tab = ['timeline', 'main', 'sub', 'pivot'].includes(name) ? name : 'timeline';
    niSetCurrentPlotTab(tab);
    // Only switch tabs within the plot tab row
    const plotTabRow = q('#ni-pg-plot .ni-plot-tab-row');
    if (plotTabRow) {
        plotTabRow.querySelectorAll('.ni-tab[data-tab]').forEach(b => b.classList.remove('on'));
        (btn || plotTabRow.querySelector(`.ni-tab[data-tab="${tab}"]`))?.classList.add('on');
    }
    q('#ni-pg-plot')?.querySelectorAll('.ni-tp').forEach(p => p.classList.remove('on'));
    q(`#ni-tp-${tab}`)?.classList.add('on');
    niSyncPlotActionButtons(true);
}
window.niSwitchTab = niSwitchTab;

// ============================================================
// Panel & Prompt 展开
// ============================================================
function niTogglePanel(id, btnId) {
    const p = q(`#${id}`);
    const b = q(`#${btnId}`);
    b?.classList.toggle('active', p?.classList.toggle('on'));
}
window.niTogglePanel = niTogglePanel;

function niToggleDevCfgPanel() {
    const panel = q('#ni-dev-cfg-panel');
    const btn = q('#ni-dev-cfg-btn');
    if (!panel) return;
    const open = panel.hidden || !panel.classList.contains('on');
    panel.hidden = !open;
    panel.style.display = open ? 'grid' : 'none';
    panel.classList.toggle('on', open);
    btn?.classList.toggle('active', open);
}

function niTogglePrompt() {
    const pb = q('#ni-pb');
    const btn = q('#ni-prompt-btn');
    btn?.classList.toggle('active', pb?.classList.toggle('on'));
}
window.niTogglePrompt = niTogglePrompt;


// ============================================================
// 全局提示词面板
// ============================================================
function niToggleGlobalPrompt() {
    const pb  = q('#ni-global-pb');
    const btn = q('#ni-global-prompt-btn');
    const isOn = pb?.classList.toggle('on');
    btn?.classList.toggle('active', isOn);
    if (isOn) {
        const el = q('#ni-global-pt-content');
        if (el) el.value = extension_settings[EXT_NAME]?.globalPrompt ?? GLOBAL_PROMPT;
        const tailEl = q('#ni-global-tail-pt-content');
        if (tailEl) tailEl.value = extension_settings[EXT_NAME]?.globalTailPrompt ?? GLOBAL_TAIL_PROMPT;
        niSyncGlobalPromptSourceUI(extension_settings[EXT_NAME] || {});
    }
}
window.niToggleGlobalPrompt = niToggleGlobalPrompt;

// ============================================================
// 演绎提示词面板
// ============================================================

// 将当前启用状态同步到 #depth_prompt_prompt
function niSyncRoleplayToDepth() {
    const ta = document.querySelector('#depth_prompt_prompt');
    if (!ta) return;
    const cfg = extension_settings[EXT_NAME] || {};
    const enabled = cfg.pluginEnabled !== false && cfg.roleplayEnabled !== false;
    const promptText = cfg.roleplayPrompt || ROLEPLAY_PROMPT;
    ta.value = enabled ? niApplyUserSubstitution(promptText) : '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function niToggleStagePrompt() {
    const pb  = q('#ni-stage-pb');
    const btn = q('#ni-stage-prompt-btn');
    const isOn = pb?.classList.toggle('on');
    btn?.classList.toggle('active', isOn);
    if (isOn) {
        const cfg = extension_settings[EXT_NAME] || {};
        // 填入已保存的提示词
        const el = q('#ni-stage-pt-content');
        if (el) el.value = cfg.roleplayPrompt || ROLEPLAY_PROMPT;
        // 恢复开关状态
        const cb = q('#ni-stage-pt-enabled');
        if (cb) cb.checked = cfg.roleplayEnabled !== false;
    }
}
window.niToggleStagePrompt = niToggleStagePrompt;


// 并发信号量 — 限制同时进行的 API 请求数，防止触发并发限制
// ============================================================
const ApiSemaphore = new DynamicSemaphore(() =>
    concurrencyLimit(extension_settings[EXT_NAME]?.apiConcurrency, DEFAULT_SETTINGS.apiConcurrency)
);

// 判定/加料各自独立的并发信号量（与清洗互不影响；容量动态读取设置，改后即时生效）
const JudgeSemaphore = new DynamicSemaphore(() =>
    Math.max(1, parseInt(extension_settings[EXT_NAME]?.judgeConcurrency, 10) || DEFAULT_SETTINGS.judgeConcurrency)
);
const EnrichSemaphore = new DynamicSemaphore(() =>
    Math.max(1, parseInt(extension_settings[EXT_NAME]?.enrichConcurrency, 10) || DEFAULT_SETTINGS.enrichConcurrency)
);

const VecSemaphore = new DynamicSemaphore(() =>
    concurrencyLimit(extension_settings[EXT_NAME]?.vecConcurrency, DEFAULT_SETTINGS.vecConcurrency)
);

function niUseTavernGlobalPreset(cfg = extension_settings[EXT_NAME] || {}) {
    return niNormalizeGlobalPromptSource(cfg.globalPromptSource) === 'tavern';
}

function niSyncGlobalPromptSourceUI(cfg = extension_settings[EXT_NAME] || {}) {
    const source = niNormalizeGlobalPromptSource(cfg.globalPromptSource);
    const tavernEl = q('#ni-global-source-tavern');
    const builtinEl = q('#ni-global-source-builtin');
    const noneEl = q('#ni-global-source-none');
    if (tavernEl) tavernEl.checked = source === 'tavern';
    if (builtinEl) builtinEl.checked = source === 'builtin';
    if (noneEl) noneEl.checked = source === 'none';
    const builtinBox = q('#ni-global-builtin-box');
    if (builtinBox) builtinBox.style.display = source === 'builtin' ? 'block' : 'none';
}

const {
    niBuildTavernPresetMessages,
    niBuildTavernPresetPromptMessages,
} = createTavernPresetMessageTools({
    getPromptManager: () => promptManager,
    getGlobalVariables: () => extension_settings?.variables?.global || {},
    substituteParams,
    taskSwitchPrompt: TAVERN_TASK_SWITCH_PROMPT,
    finalOverridePrompt: TAVERN_TASK_FINAL_OVERRIDE_PROMPT,
});
const {
    niExtractChatCompletionText,
    niHasLengthFinishReason,
    niReadChatCompletionStream,
} = createChatCompletionResponseTools({ extractMessageFromData });
const {
    niApplyGlobalPromptsToMessages,
    niInsertIntoEventChat,
} = createGlobalPromptTools({
    getSettings: () => extension_settings[EXT_NAME] || {},
    defaultSettings: DEFAULT_SETTINGS,
    globalPrompt: GLOBAL_PROMPT,
    globalTailPrompt: GLOBAL_TAIL_PROMPT,
});

// ============================================================
// API 调用 — 清洗
// ============================================================
const {
    callApiSeq,
    callCleanApi,
    niGenerateWithTavernMainPreset,
} = createNovelApiClient({
    getSettings: () => extension_settings[EXT_NAME],
    acquireApiRateSlot: niAcquireApiRateSlot,
    useTavernGlobalPreset: niUseTavernGlobalPreset,
    runWithSemaphore,
    apiSemaphore: ApiSemaphore,
    buildTavernPresetMessages: niBuildTavernPresetMessages,
    applyGlobalPromptsToMessages: niApplyGlobalPromptsToMessages,
    readChatCompletionStream: niReadChatCompletionStream,
    hasLengthFinishReason: niHasLengthFinishReason,
    extractChatCompletionText: niExtractChatCompletionText,
    cleanUpMessage,
    getRequestHeaders,
    getCurrentAbortController: () => S._currentAbortController,
    setCurrentAbortController: controller => { S._currentAbortController = controller; },
    fetch,
});

const { niRequestEmbeddings, embedText } = createEmbeddingClient({
    getSettings: () => extension_settings[EXT_NAME],
    acquireRateSlot: () => _vecQueue.acquire(),
    runWithSemaphore,
    semaphore: VecSemaphore,
    defaultSettings: DEFAULT_SETTINGS,
});

let niVectorDiagnosticNovelKey = '';
let niStoredVectorDiagnosticRows = [];
let niStoredVectorCompatibility = null;
let niQueryVectorCompatibility = null;

function niRenderVectorCompatibilityHint() {
    const hintEl = q('#ni-vec-hint-inline');
    if (!hintEl) return;
    const presentation = getVectorCompatibilityHint({
        stored: niStoredVectorCompatibility,
        query: niQueryVectorCompatibility,
    });
    const iconEl = q('#ni-vec-hint-icon');
    const textEl = q('#ni-vec-hint-text');
    if (iconEl) iconEl.className = `ti ${presentation.icon}`;
    if (textEl) textEl.textContent = presentation.text;
    hintEl.title = presentation.title || presentation.text;
    hintEl.classList.toggle('ni-vec-hint-warning', presentation.level === 'warning');

    // 异常提示优先于已结束的进度文字；正在向量化时仍保留实时进度。
    if (presentation.level === 'warning' && !S._vecRunning) {
        const titleProgress = q('#ni-vp-title-prog');
        const vectorCard = q('#ni-vp-card');
        if (titleProgress) titleProgress.style.display = 'none';
        if (vectorCard) vectorCard.classList.remove('ni-has-prog');
    }
}

let niInvalidateVectorRecallCache = () => {};

async function niHandleVectorRowsChanged(rows = [], { novelKey = S.novelKey } = {}) {
    const activeNovelKey = String(S.novelKey || '');
    const inspectedNovelKey = String(novelKey || '');
    if (inspectedNovelKey !== activeNovelKey) return;
    niInvalidateVectorRecallCache();

    const rowList = (rows || []).filter(Boolean);
    const fingerprints = await niSafeVectorFingerprints(rowList.map(row => row.fingerprint || ''));
    if (String(S.novelKey || '') !== activeNovelKey) return;

    niVectorDiagnosticNovelKey = activeNovelKey;
    niStoredVectorDiagnosticRows = rowList.map((row, index) => ({
        stageIdx: Number(row?.stageIdx) || 0,
        dimension: Number(row?.vector?.length) || 0,
        fingerprint: fingerprints[index] || '',
    }));
    niQueryVectorCompatibility = null;

    const currentFingerprint = activeNovelKey
        ? await niSafeVectorFingerprint(getVectorFingerprint())
        : '';
    if (String(S.novelKey || '') !== activeNovelKey) return;
    niStoredVectorCompatibility = summarizeVectorCompatibility(niStoredVectorDiagnosticRows, {
        currentFingerprint,
    });
    S.stageVecSourceMismatch = findVectorStageSourceMismatches(
        niStoredVectorDiagnosticRows,
        currentFingerprint,
    );
    niRenderVectorCompatibilityHint();
    niRenderVecStageSelector();
}

async function niRefreshCurrentVectorSourceHint() {
    const activeNovelKey = String(S.novelKey || '');
    if (niVectorDiagnosticNovelKey !== activeNovelKey) {
        const rows = activeNovelKey ? await dbLoadByNovel() : [];
        await niHandleVectorRowsChanged(rows, { novelKey: activeNovelKey });
        return;
    }

    niQueryVectorCompatibility = null;
    const currentFingerprint = activeNovelKey
        ? await niSafeVectorFingerprint(getVectorFingerprint())
        : '';
    if (String(S.novelKey || '') !== activeNovelKey) return;
    niStoredVectorCompatibility = summarizeVectorCompatibility(niStoredVectorDiagnosticRows, {
        currentFingerprint,
    });
    S.stageVecSourceMismatch = findVectorStageSourceMismatches(
        niStoredVectorDiagnosticRows,
        currentFingerprint,
    );
    niRenderVectorCompatibilityHint();
    niRenderVecStageSelector();
}

function niHandleVectorQueryCompared(rows = [], queryDimensions = 0, { novelKey = S.novelKey } = {}) {
    if (String(novelKey || '') !== String(S.novelKey || '')) return;
    niQueryVectorCompatibility = summarizeVectorCompatibility(
        (rows || []).map(row => ({ dimension: Number(row?.vector?.length) || 0 })),
        { queryDimensions },
    );
    niRenderVectorCompatibilityHint();
}

const {
    getVectorFingerprint,
    dbOpen,
    dbSaveChunk,
    dbLoadByNovel,
    dbClearNovel,
    dbCloneNovelKey,
    persistVecState,
    niReconcileVecStateFromDb,
    niVectorConcurrencyLimit,
    niRunVectorItems,
    niStartVec,
    niVecFillMissing,
    niRenderVecStageSelector,
    niToggleStagePanel,
} = createVectorController({
    state: S,
    getSettings: () => extension_settings[EXT_NAME] || {},
    defaultSettings: DEFAULT_SETTINGS,
    indexedDB,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    dbStore: DB_STORE,
    persistSettingsDebounced: saveSettingsDebounced,
    q,
    qa,
    alert,
    confirm,
    canUseDerivedModules,
    hasLoadedChunks: (...args) => niHasLoadedChunks(...args),
    ensureChunksLoaded: (...args) => niEnsureChunksLoaded(...args),
    serverLoadHeavy: (...args) => niServerLoadHeavy(...args),
    concurrencyLimit,
    setBtn: (...args) => setBtn(...args),
    niRequestEmbeddings: (...args) => niRequestEmbeddings(...args),
    buildStages: (...args) => buildStages(...args),
    saveSettings: niSaveSettings,
    escapeHtml: niEscHtml,
    togglePanel: niTogglePanel,
    onVectorRowsChanged: niHandleVectorRowsChanged,
});

const {
    niApplyManualPlotOrderForType,
    niMovePlotByDisplayPosition,
    niSyncPlotActionButtons,
    renderPlots,
    renderTimeline,
    renderPlotList,
    niTogglePlot,
    niBindPlotDrag,
    niJumpToStage,
    niRepairBranchLinks,
    niPlotStageNumber,
    niGetPrimaryPlotEntries,
    niGetSubParentPlotEntries,
    niPickNearestStageFromPlots,
    niGetSingleChunkStage,
    niResolveSubPlotStageIdx,
    niSyncSubPlotStageAssignments,
    niFindMainParentForSubTitle,
    niRefreshPlotParentField,
    niSetSubParentLink,
    niRefreshPivotAfterMainField,
    niTogglePivotMainPicker,
    niClosePivotMainPicker,
    niFilterPivotMainPicker,
    niSelectPivotMain,
    niRefreshPlotInsertField,
    niOpenPlotModal,
    niClosePlotModal,
    niSavePlotModal,
    niTogglePlotDel,
    niTogglePlotEdit,
    niConfirmPlotDel,
    niRenderAiFields,
    niCharRawEyeButton,
    renderCharacters,
    niEditChar,
    niRenderRawDetail,
    niSaveChar,
    niSwitchCharTab,
    niSetCharPageSize,
    niSetCharPage,
    niChangeCharPage,
    niRefreshCharStageSel,
    niCalcStageOnCount,
    niRenderStageDrawer,
    niUpdateStageDrawerNote,
    niSyncEmptyToggleBtn,
    getCharFirstStage,
    niStageListFromValue,
    niGetFirstStageForChunkIdx,
    niCharAutoSleepEnabled,
    niSyncCharAutoSleepUI,
    niClearCharAutoSleep,
    niIsUserSubProtectedChar,
    niCanUseAliasTextForPresence,
    niCharPresenceTerms,
    niNormalizePresenceText,
    niPresenceHasTerm,
    niCharNameMatchesTerm,
    niGetStageChunkIdxSet,
    niStageMetaMentionsChar,
    niBuildStageTextForCharAutoSleep,
    niRunCharAutoSleepForStage,
    niCharAiProfileKey,
    niGetCharAiChatState,
    niSaveCharAiChatState,
    niGetCharAiProfile,
    niSetCharAiProfile,
    niGetCharAiShowEnabled,
    niSetCharAiShowEnabled,
    niToggleCharsByStage,
    niToggleAllStageChars,
    niToggleCharDel,
    niConfirmCharDel,
    buildStages,
    niCharAiSkipError,
    niIsCharAiSkipError,
    niIsAbortError,
    niAbortableDelay,
    niCharAiTextHasTarget,
    niCanUseCharAiEvidenceTerm,
    niBuildCharAiBaseProfile,
    niBuildCharAiProfileContext,
    niBuildCharAiProfilePrompt,
    niParseCharAiProfile,
    niGenerateCharAiProfileWithRetry,
    niApplyCharAiProfile,
    niGenCharsManual,
    niGenOneCharManual,
    niGenStagesManual,
    getNodesForStage,
    buildNodePills,
    niSetAllStagesEnabled,
    niToggleStage,
    niSetStagePageSize,
    niSetStagePage,
    niChangeStagePage,
    niLoadStagePageFromChat,
    niToggleStageBody,
    niCancelStageEdit,
    niSaveStage,
    updateStageLbl,
    niGoPlot,
    niOpenStagePanel,
    niCloseStagePanel,
    niAddStageSlot,
    niRemoveStageSlot,
    niToggleChunkInSlot,
    niRenderStageSlots,
    niRenderUnassigned,
    niSlotRename,
    niSlotColor,
    niUpdateSpHint,
    niAutoStageByPivot,
    niConfirmStageMap,
    niSetCurrentPlotTab,
    niGetCurrentPlotTab,
    niSetPlotPageForPosition,
    niGetPlotPage,
    niLoadPlotPagesFromChat,
    niIsPlotInteractionModeActive,
    niTogglePlotDeleteSelection,
    niGetCurrentCharTab,
    niToggleCharDeleteSelection,
    niToggleShowEmptyStages,
    niGetShowEmptyStages,
} = createStoryController({
    state: S,
    query: q,
    queryAll: qa,
    document,
    globalWindow: window,
    logger: console,
    alert: message => alert(message),
    confirm: message => confirm(message),
    prompt: (...args) => prompt(...args),
    toastr: globalThis.toastr,
    extensionSettings: extension_settings,
    extensionName: EXT_NAME,
    defaultSettings: DEFAULT_SETTINGS,
    escapeHtml: niEscHtml,
    escapeAttr: niEscAttr,
    saveSettings: niSaveSettings,
    saveStageSettings: niSaveStageRuntimeSettings,
    saveSettingsDebounced,
    canUseDerived: canUseDerivedModules,
    callCleanApi,
    callApiSeq,
    getContext,
    getChatMetadata: () => chat_metadata,
    persistChatMetadata: saveMetadataDebounced,
    hasCurrentChat: () => !!getCurrentChatId?.(),
    switchPage: niSwitchPage,
    renderVectorStageSelector: niRenderVecStageSelector,
    updateVectorOffButton: niUpdateVecOffBtn,
    ensureChunksLoaded: (...args) => niEnsureChunksLoaded(...args),
    buildStagesWithChunksIfNeeded: (...args) => niBuildStagesWithChunksIfNeeded(...args),
    hasLoadedChunks: (...args) => niHasLoadedChunks(...args),
    renderUserSubUI: niRenderUserSubUI,
    syncRoleplayToDepth: niSyncRoleplayToDepth,
    getUserSubConfig: niGetUserSubConfig,
    isUserSubPlayMode: niIsUserSubPlayMode,
    isUserSubSelectedChar: niIsUserSubSelectedChar,
    isUserSubReplaceSelectedChar: niIsUserSubReplaceSelectedChar,
    getActiveUserSubNames: niGetActiveUserSubNames,
    getSelectedUserSubCharName: niGetSelectedUserSubCharName,
    getUserSubAliasOverride: niGetUserSubAliasOverride,
    userSubAliasKind: niUserSubAliasKind,
    userSubAliasIsActive: niUserSubAliasIsActive,
    userSubStageReached: niUserSubStageReached,
    userSubAliasKey: niUserSubAliasKey,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    AbortController,
});

const {
    niHeavyPartFileName,
    niHeavyPartFileNames,
    niStripCharAiRuntime,
    niServerUploadJson,
    niServerLoadJsonByNames,
    niApplyHeavyCore,
    niApplyHeavyChunks,
    niApplyStages,
    niHasLoadedChunks,
    niServerSaveHeavy,
    niServerSaveStages,
    niServerLoadHeavy,
    niServerLoadStages,
    niEnsureChunksLoaded,
    niBuildStagesWithChunksIfNeeded,
    niServerDeleteHeavy,
    _niStripHeavy,
    niRenderNovelLibrary,
    niSetNovelLibraryPageSize,
    niSetNovelLibraryPage,
    niChangeNovelLibraryPage,
    niSaveNovelSnapshot,
    niUpdateNovelSnapshot,
    niRenameNovelSnapshot,
    niLoadNovelSnapshot,
    niDeleteNovelSnapshot,
    niExportData,
    niImportData,
    niClearVecCache,
    niClearAllData,
} = createStorageController({
    S,
    extension_settings,
    EXT_NAME,
    DEFAULT_SETTINGS,
    DB_STORE,
    NI_UPLOAD_LABEL,
    NI_UPLOAD_HINT,
    q,
    getRequestHeaders,
    normalizePlotCollections,
    niSyncSubPlotStageAssignments,
    niEnsurePlotNodeId,
    niMaybeMigrateLegacyDeviationToChat: (...args) => niMaybeMigrateLegacyDeviationToChat(...args),
    buildStages,
    canUseDerivedModules,
    dbCloneNovelKey,
    niReconcileVecStateFromDb,
    niGetWorldCategories: (...args) => niGetWorldCategories(...args),
    niSaveSettings,
    saveSettingsDebounced,
    niResetNovelWorkspace,
    niLoadDeviationStateFromChat: (...args) => niLoadDeviationStateFromChat(...args),
    niClearLegacyDeviationSettings: (...args) => niClearLegacyDeviationSettings(...args),
    niSyncDeviationResultUI: (...args) => niSyncDeviationResultUI(...args),
    niSaveDeviationChatState: (...args) => niSaveDeviationChatState(...args),
    renderPlots,
    renderCharacters,
    renderChunkList: (...args) => renderChunkList(...args),
    niRenderWorldSettings: (...args) => niRenderWorldSettings(...args),
    niSyncCleanButtonState: (...args) => niSyncCleanButtonState(...args),
    dbLoadByNovel,
    getVectorFingerprint,
    vecToBytes,
    bytesToVecs,
    vecToBuffer,
    dbOpen,
    dbClearNovel,
    setBtn: (...args) => setBtn(...args),
    fetch,
    document,
    Blob,
    URL,
    FileReader,
    alert,
    confirm,
    prompt,
    toastr: globalThis.toastr,
});

niAutosave = createAutosaveController({
    state: S,
    getSettings: () => extension_settings[EXT_NAME] || {},
    saveSettingsDebounced,
    saveNovelSnapshot: (...args) => niSaveNovelSnapshot(...args),
    updateNovelSnapshot: (...args) => niUpdateNovelSnapshot(...args),
    renderNovelLibrary: () => niRenderNovelLibrary(),
});

const {
    niOnDrop,
    niOnFile,
    niApplyFile,
    getCfgKb,
    niOnKbChange,
    renderChunkList,
    chunkStatStyle,
    setChunkStat,
    niCleanConcurrencyLimit,
    niBuildCleanMessages,
    niRebuildStructuredDataFromChunks,
    niProcessCleanChunk,
    niStartClean,
    niRetryFailed,
    niSkipChunk,
    niRunSingleChunk,
    niPauseClean,
    setBtn,
    niSyncCleanProgressHint,
    niSyncCleanButtonState,
    niResetCleanRuntimeForRestart,
    niHandleCleanButtonClick,
} = createCleaningController({
    state: S,
    getSettings: () => extension_settings[EXT_NAME] || {},
    defaultSettings: DEFAULT_SETTINGS,
    cleanPrompt: CLEAN_PROMPT,
    q,
    sv,
    alert,
    toastr: globalThis.toastr,
    fingerprintArrayBuffer: niFingerprintArrayBuffer,
    resetNovelWorkspace: niResetNovelWorkspace,
    serverLoadHeavy: niServerLoadHeavy,
    rechunkPreservingCompleted: niRechunkPreservingCompleted,
    remapVectorSourceChunkIndices: dbRemapSourceChunkIndices,
    resetChunkDerivedState: niResetChunkDerivedState,
    populateStyleChunkSelector: (...args) => niStylePopulateChunkSel(...args),
    saveSettings: niSaveSettings,
    ensureChunksLoaded: niEnsureChunksLoaded,
    hasLoadedChunks: niHasLoadedChunks,
    concurrencyLimit,
    mergeCharacters,
    mergeCharacterAliases,
    mergePlots,
    restorePlotCheckpointMemory,
    restoreCharacterMemory,
    sortPlotsByStoryOrder: niSortPlotsByStoryOrder,
    rebuildStageMapFromPlotStageIdx,
    syncSubPlotStageAssignments: niSyncSubPlotStageAssignments,
    callCleanApi,
    capturePlotCheckpointMemory,
    captureCharacterMemory,
    renderPlots,
    renderCharacters,
    buildStages,
    clearNovelVectors: dbClearNovel,
    onNovelFileLoaded: fileName => {
        niAutosave.setSourceFileName(fileName);
        niAutosave.schedule({ immediate: true });
    },
});

Object.assign(window, {
    niOnDrop,
    niOnFile,
    niOnKbChange,
    niStartClean,
    niRetryFailed,
    niSkipChunk,
    niRunSingleChunk,
    niPauseClean,
    niUpdateNovelSnapshot,
    niRenameNovelSnapshot,
    niExportData,
    niImportData,
    niClearVecCache,
    niClearAllData,
    niStartVec,
    niVecFillMissing,
    niToggleStagePanel,
    niRenderVecStageSelector,
});

function niResolveTransbookPlotStageIdx(plot) {
    const normalize = value => {
        const stageIdx = parseInt(value, 10);
        return Number.isFinite(stageIdx) && stageIdx > 0 ? stageIdx : null;
    };
    const direct = normalize(plot?.stageIdx) ?? normalize(plot?._plotRef?.stageIdx);
    if (direct != null) return direct;

    const type = plot?._type || plot?.type || plot?._plotRef?.type || 'main';
    const rawPlot = plot?._plotRef || plot;
    if (type === 'sub') return normalize(niResolveSubPlotStageIdx(rawPlot));
    if (type !== 'main' && type !== 'pivot') return null;

    const sourceIdx = parseInt(plot?._sourceIdx ?? plot?._originalIdx, 10);
    if (!Number.isFinite(sourceIdx) || sourceIdx < 0) return null;
    const combinedIdx = type === 'pivot' ? (S.plots?.main?.length || 0) + sourceIdx : sourceIdx;
    return normalize(S.stageMap?.[combinedIdx] ?? S.stageMap?.[String(combinedIdx)]);
}

const {
    niTbSyncPauseUI,
    niTbSetPaused,
    niTbTogglePaused,
    niUpgradeLegacyTbDefaultPrompts,
    niTbGetImmersionAppend,
    niTbFrontierStage,
    niTbAdvanceFrontier,
    niGetTbNodes,
    niGetTbStages,
    niTbReconcileCurrentNode,
    niTbGetInjectionNode,
    niTbSetCurrentIdx,
    niTbStageView,
    niTbUnpinView,
    niTbSaveState,
    niTbLoadState,
    niGetTbStoryBarHtml,
    niEsc,
    niTbBuildStageListHtml,
    niTbBuildNodePanelHtml,
    niTbGetSlots,
    niTbCalcPos,
    niTbCardHTML,
    niTbBuildTrack,
    niTbAnimateTo,
    niTbCardClick,
    niTbSyncMeta,
    niTbRefreshNodePanel,
    niTbToggleCheck,
    niTbUnarchive,
    niTbShowStageDone,
    niTbWriteAdvancePrompt,
    niTbWriteOpeningPrompt,
    niTbGenerateInfer,
    niTbInjectCSS,
    niTbRenderStoryBar,
    niRefreshStorybarTheme,
    niTbBindEvents,
    niTbBindBarEvents,
    niTbBindNodePanelEvents,
    niTbToggleDropPanel,
    niTbRebuildStageList,
    niTbInitSettingsUI,
    niTbPeekPendingAdvancePrompt,
    niTbConsumePendingAdvancePrompt,
    niTbResetPromptRuntimeState,
} = createTransbookController({
    state: S,
    defaultSettings: DEFAULT_SETTINGS,
    extensionSettings: extension_settings,
    extensionName: EXT_NAME,
    document,
    globalWindow: window,
    logger: console,
    dollar: $,
    getContext,
    getAllPlotsInStoryOrder,
    ensurePlotNodeId: niEnsurePlotNodeId,
    resolveStageIdx: niResolveTransbookPlotStageIdx,
    comparePlotOrder: niComparePlotOrder,
    saveSettingsDebounced,
    normalizePageSize: niNormalizeStagePageSize,
    buildListPaginationHtml: niBuildListPaginationHtml,
    callCleanApi,
    applyStatusbarTheme: niApplyStatusbarTheme,
    applyUserSubstitution: niApplyUserSubstitution,
    getUserSubConfig: niGetUserSubConfig,
    isUserSubReplaceSelectedChar: niIsUserSubReplaceSelectedChar,
    isUserSubSelectedChar: niIsUserSubSelectedChar,
    isUserSubPlayMode: niIsUserSubPlayMode,
    getCharAiShowEnabled: niGetCharAiShowEnabled,
    getCharAiProfile: niGetCharAiProfile,
    togglePanel: niTogglePanel,
    popSetVisible: (...args) => window.niPopSetVisible?.(...args),
    popSyncVisibility: (...args) => window.niPopSyncVisibility?.(...args),
    setTransBookMode: niSetTransBookMode,
    syncTransBookToggleUI: niSyncTransBookToggleUI,
    setTimeout: (...args) => setTimeout(...args),
    requestAnimationFrame: (...args) => requestAnimationFrame(...args),
    Event,
    defaultAdvancePrompt: TB_DEFAULT_ADVANCE_PROMPT,
    defaultInferPrompt: TB_DEFAULT_INFER_PROMPT,
    defaultOpeningPrompt: TB_DEFAULT_OPENING_PROMPT,
    defaultOngoingPrompt: TB_DEFAULT_ONGOING_PROMPT,
    defaultImmersionPrompt: TB_DEFAULT_IMMERSION_PROMPT,
    legacyAdvancePrompt: TB_LEGACY_ADVANCE_PROMPT,
    legacyOpeningPrompt: TB_LEGACY_OPENING_PROMPT,
    legacyOngoingPrompt: TB_LEGACY_ONGOING_PROMPT,
});
// 合并角色数据
// ============================================================

// ============================================================
// 合并剧情数据，计算所属阶段
// ============================================================
async function dbRemapSourceChunkIndices(indexMap) {
    if (!(indexMap instanceof Map) || !indexMap.size || !S.novelKey) return 0;
    await dbOpen();
    return new Promise((resolve, reject) => {
        const tx = S.db.transaction(DB_STORE, 'readwrite');
        const idx = tx.objectStore(DB_STORE).index('novelKey');
        const req = idx.openCursor(S.novelKey);
        let updated = 0;
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            const row = cursor.value || {};
            const oldSource = Number(row.sourceChunkIdx);
            if (indexMap.has(oldSource)) {
                row.sourceChunkIdx = indexMap.get(oldSource);
                cursor.update(row);
                updated++;
            }
            cursor.continue();
        };
        tx.oncomplete = () => resolve(updated);
        tx.onerror = () => reject(tx.error);
    });
}

function mergePlots(incoming, chunkIndex) {
    // stageMap key = main数组下标，不能用 chunkIndex 直接查。
    // 这里只记录 _chunkIdx，stageIdx 由 niConfirmStageMap 事后统一回填。
    // 若阶段已划分且当前节点是续跑补充的，通过已有节点的 _chunkIdx 反查阶段号。
    let stageIdx = null;
    if (S.stageMapN > 0) {
        // 在已有节点中找同 chunkIndex 的节点，借用其 stageIdx
        const ref = [...(S.plots.main || []), ...(S.plots.sub || []), ...(S.plots.pivot || [])]
            .find(p => p._chunkIdx === chunkIndex && p.stageIdx != null);
        if (ref) {
            stageIdx = ref.stageIdx;
        }
    }

    const plots = niNormalizeIncomingPlots(incoming)
        .map((plot, index) => ({ ...(plot || {}), _sourceIdx: index }))
        .sort((a, b) => {
            const ai = niFiniteNumber(a._sourceIdx, 0);
            const bi = niFiniteNumber(b._sourceIdx, 0);
            return niPlotChunkOrder(a, ai) - niPlotChunkOrder(b, bi) ||
                niPlotTypeRank(a) - niPlotTypeRank(b) ||
                ai - bi;
        });
    plots.forEach((p, localIndex) => {
        const bucket = ['main', 'sub', 'pivot'].includes(p.type) ? p.type : 'main';
        const chunkOrder = niPlotChunkOrder(p, p._sourceIdx ?? localIndex);
        const newPlot = {
            _nodeId: p._nodeId || p.node_id || p.nodeId || p.id || `${bucket}:${chunkIndex}:${chunkOrder}:${niHashShort(`${p.title || ''}\n${p.body || ''}`)}`,
            type: bucket,
            title: p.title || '（无标题）',
            body: p.body || '',
            sub_notes: p.sub_notes || [],
            branch_links: p.branch_links || [],
            time: p.time || '',
            location: p.location || '',
            stageIdx,
            stageLabel: stageIdx != null ? `第 ${stageIdx} 阶段` : null,
            _chunkIdx: chunkIndex,
            _chunkOrder: chunkOrder,
        };
        const manualOrder = niPlotManualOrder(p);
        if (manualOrder != null) newPlot._manualOrder = manualOrder;
        niEnsurePlotNodeId(newPlot, bucket, localIndex);
        S.plots[bucket].push({
            ...newPlot,
        });
    });
}

// ============================================================
// 剧情渲染
// ============================================================
function niNormalizeUserSubMode(mode) {
    return mode === 'play' ? 'play' : DEFAULT_SETTINGS.userSubMode;
}

function niCloneUserSubAliases(aliases) {
    return Array.isArray(aliases)
        ? aliases.filter(alias => alias && typeof alias === 'object').map(alias => ({ ...alias }))
        : [];
}

function niCreateUserSubConfig(source = null, legacyAliasStates = null) {
    const src = source && typeof source === 'object' ? source : {};
    const sourceStates = src.aliasStates && typeof src.aliasStates === 'object'
        ? src.aliasStates
        : legacyAliasStates;
    return {
        version: 1,
        userSubEnabled: !!(src.userSubEnabled ?? DEFAULT_SETTINGS.userSubEnabled),
        userSubMode: niNormalizeUserSubMode(src.userSubMode),
        userSubCharIdx: src.userSubCharIdx == null ? DEFAULT_SETTINGS.userSubCharIdx : String(src.userSubCharIdx),
        userSubAliases: niCloneUserSubAliases(src.userSubAliases),
        aliasStates: sourceStates && typeof sourceStates === 'object' ? { ...sourceStates } : {},
    };
}

function niGetLegacyUserSubChatStates() {
    try {
        const states = getContext()?.chat?.[0]?.ni_user_sub?.aliasStates;
        return states && typeof states === 'object' ? states : {};
    } catch (_) {
        return {};
    }
}

function niResizeDeviationFactInlineInput(input) {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.max(24, input.scrollHeight)}px`;
}

function niAppendDeviationFactInlineDraft() {
    const list = q('#ni-dev-facts-list');
    const addButton = q('#ni-dev-fact-add');
    if (!list || !addButton) return null;
    const index = list.querySelectorAll('.ni-dev-fact-inline-input').length;
    const row = document.createElement('div');
    row.className = 'ni-dev-fact-row ni-dev-fact-row-editing';
    row.innerHTML = `<div class="ni-dev-fact-main"><span class="ni-dev-fact-status">事实</span><textarea class="ni-dev-fact-inline-input" data-fact-id="" data-fact-kind="fact" rows="1" spellcheck="false" aria-label="编辑当前分支事实第 ${index + 1} 条" placeholder="输入新的当前分支事实…"></textarea><button type="button" class="ni-dev-fact-remove" aria-label="去除当前分支事实第 ${index + 1} 条" title="去除">去除</button></div>`;
    addButton.before(row);
    const input = row.querySelector('.ni-dev-fact-inline-input');
    niResizeDeviationFactInlineInput(input);
    input?.focus();
    return input;
}

let _niDetachedUserSubConfig = null;

function niGetUserSubConfig() {
    const hasChat = !!getCurrentChatId?.();
    if (!hasChat || !chat_metadata || typeof chat_metadata !== 'object') {
        _niDetachedUserSubConfig = _niDetachedUserSubConfig || niCreateUserSubConfig();
        return _niDetachedUserSubConfig;
    }

    const globalCfg = extension_settings[EXT_NAME] || {};
    let cfg = chat_metadata[NI_USER_SUB_CHAT_META_KEY];
    if (!cfg || typeof cfg !== 'object') {
        const shouldMigrateGlobal = globalCfg[NI_USER_SUB_CHAT_MIGRATION_KEY] !== true;
        cfg = niCreateUserSubConfig(
            shouldMigrateGlobal ? globalCfg : null,
            niGetLegacyUserSubChatStates(),
        );
        chat_metadata[NI_USER_SUB_CHAT_META_KEY] = cfg;
        saveMetadataDebounced();
    } else {
        const normalized = niCreateUserSubConfig(cfg, niGetLegacyUserSubChatStates());
        Object.keys(cfg).forEach(key => delete cfg[key]);
        Object.assign(cfg, normalized);
    }

    if (globalCfg[NI_USER_SUB_CHAT_MIGRATION_KEY] !== true) {
        globalCfg[NI_USER_SUB_CHAT_MIGRATION_KEY] = true;
        saveSettingsDebounced();
    }
    return cfg;
}

async function niPersistUserSubConfig({ immediate = false } = {}) {
    if (!getCurrentChatId?.()) return;
    try {
        if (immediate) {
            const ctx = getContext();
            if (typeof ctx?.saveMetadata === 'function') {
                await ctx.saveMetadata();
                return;
            }
        }
        saveMetadataDebounced();
    } catch (e) {
        console.warn('[NI] 用户代入聊天配置保存失败:', e);
    }
}

function niIsUserSubPlayMode(cfg = niGetUserSubConfig()) {
    return niNormalizeUserSubMode(cfg.userSubMode) === 'play';
}

function niIsUserSubSelectedChar(idx, cfg = niGetUserSubConfig()) {
    if (!cfg.userSubEnabled) return false;
    return parseInt(cfg.userSubCharIdx, 10) === idx;
}

function niIsUserSubReplaceSelectedChar(idx, cfg = niGetUserSubConfig()) {
    return niIsUserSubSelectedChar(idx, cfg) && !niIsUserSubPlayMode(cfg);
}

function niUserSubDefaultAliasesForChar(charIdx) {
    const idx = parseInt(charIdx, 10);
    const c = S.characters[idx];
    if (!c?.name) return [];
    const firstStage = getCharFirstStage(c) || '';
    const out = [{
        text: c.name,
        firstStage,
        kind: 'primary',
    }];
    (Array.isArray(c.aliases) ? c.aliases : []).forEach(alias => {
        const text = (alias?.text || '').trim();
        if (!text || text === c.name) return;
        const kind = String(alias.kind || 'alias').trim() || 'alias';
        const aliasStage = getCharFirstStage({ _firstChunkIdx: alias._chunkIdx }) || firstStage;
        out.push({
            text,
            firstStage: aliasStage,
            kind,
        });
    });
    const seen = new Set();
    return out.filter(alias => {
        const key = `${alias.text}@@${alias.firstStage}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function niUserSubAliasLookupKey(text, kind = '') {
    return `${String(text || '').trim()}@@${String(kind || '').trim().toLowerCase()}`;
}

function niNormalizeUserSubAliasesForSelectedChar(cfg) {
    const idx = parseInt(cfg.userSubCharIdx, 10);
    const c = S.characters[idx];
    if (!c?.name || !Array.isArray(cfg.userSubAliases)) return false;

    const firstStage = getCharFirstStage(c) || '';
    const byTextKind = new Map();
    const byText = new Map();
    const addStage = (text, kind, stage) => {
        const t = String(text || '').trim();
        if (!t) return;
        const k = String(kind || '').trim().toLowerCase();
        const s = String(stage || '');
        if (!s) return;
        byTextKind.set(niUserSubAliasLookupKey(t, k), s);
        if (!byText.has(t)) byText.set(t, s);
    };

    addStage(c.name, 'primary', firstStage);
    (Array.isArray(c.aliases) ? c.aliases : []).forEach(alias => {
        const text = String(alias?.text || '').trim();
        if (!text) return;
        const kind = String(alias?.kind || 'alias').trim() || 'alias';
        const stage = getCharFirstStage({ _firstChunkIdx: alias._chunkIdx }) || firstStage;
        addStage(text, kind, stage);
    });

    let changed = false;
    let states = null;
    let statesChanged = false;
    cfg.userSubAliases.forEach(alias => {
        if (!alias?.text || niUserSubAliasKind(alias) === 'custom') return;
        const stage = byTextKind.get(niUserSubAliasLookupKey(alias.text, alias.kind)) ||
            byText.get(String(alias.text || '').trim());
        if (!stage || String(alias.firstStage || '') === String(stage)) return;

        const oldKey = niUserSubAliasKey(alias);
        alias.firstStage = String(stage);
        changed = true;
        const newKey = niUserSubAliasKey(alias);
        if (oldKey && oldKey !== newKey) {
            states = states || { ...niGetUserSubChatStates() };
            if (Object.prototype.hasOwnProperty.call(states, oldKey)) {
                states[newKey] = states[oldKey];
                delete states[oldKey];
                statesChanged = true;
            }
        }
    });

    if (statesChanged) niSaveUserSubChatStates(states).catch(e => console.warn('[NI] 用户代入称呼阶段迁移失败:', e));
    if (changed) niPersistUserSubConfig();
    return changed;
}

function niUserSubStageReached(firstStage) {
    const si = parseInt(firstStage, 10);
    if (!si || si <= 0 || S.stageMapN <= 0) return true;
    for (let i = si; i <= S.stageMapN; i++) {
        if (S.stageStates[i] !== false) return true;
    }
    return false;
}

function niUserSubAliasKey(alias) {
    return `${alias?.text || ''}@@${alias?.firstStage || ''}`;
}

function niGetUserSubChatStates() {
    const states = niGetUserSubConfig()?.aliasStates;
    return states && typeof states === 'object' ? states : {};
}

async function niSaveUserSubChatStates(states) {
    try {
        niGetUserSubConfig().aliasStates = { ...states };
        await niPersistUserSubConfig({ immediate: true });
    } catch (e) {
        console.warn('[NI] 用户代入称呼状态保存失败:', e);
    }
}

function niGetUserSubAliasOverride(alias) {
    const states = niGetUserSubChatStates();
    const key = niUserSubAliasKey(alias);
    if (Object.prototype.hasOwnProperty.call(states, key)) return !!states[key];
    if (alias?.state === 'manual_on') return true;
    if (alias?.state === 'manual_off') return false;
    return null;
}

function niUserSubAliasKind(alias) {
    return String(alias?.kind || 'custom').trim().toLowerCase();
}

function niUserSubAliasIsActive(alias) {
    if (!alias?.text) return false;
    const override = niGetUserSubAliasOverride(alias);
    if (override !== null) return override;
    return niUserSubStageReached(alias.firstStage);
}

function niReadUserSubAliasesFromUI() {
    const rows = [...qa('#ni-user-sub-list .ni-user-sub-row')];
    return rows.map(row => {
        const text = row.querySelector('.ni-user-sub-name')?.value?.trim() || '';
        const firstStage = row.dataset.firstStage || '';
        const kind = row.dataset.aliasKind || 'custom';
        return { text, firstStage, kind };
    }).filter(a => a.text);
}

function niReadUserSubAliasFromRow(row) {
    return {
        text: row?.querySelector('.ni-user-sub-name')?.value?.trim() || '',
        firstStage: row?.dataset.firstStage || '',
    };
}

async function niSaveUserSubRowState(row) {
    const alias = niReadUserSubAliasFromRow(row);
    if (!alias.text) return;
    const states = { ...niGetUserSubChatStates() };
    states[niUserSubAliasKey(alias)] = !!row.querySelector('.ni-user-sub-enabled')?.checked;
    await niSaveUserSubChatStates(states);
}

async function niMigrateUserSubRowState(row) {
    const oldKey = row?.dataset.aliasKey || '';
    const alias = niReadUserSubAliasFromRow(row);
    const newKey = niUserSubAliasKey(alias);
    if (!alias.text || !oldKey || oldKey === newKey) return;
    const states = { ...niGetUserSubChatStates() };
    if (Object.prototype.hasOwnProperty.call(states, oldKey)) {
        states[newKey] = states[oldKey];
        delete states[oldKey];
        await niSaveUserSubChatStates(states);
    }
    row.dataset.aliasKey = newKey;
}

async function niDeleteUserSubRowState(row) {
    const oldKey = row?.dataset.aliasKey || '';
    if (!oldKey) return;
    const states = { ...niGetUserSubChatStates() };
    if (Object.prototype.hasOwnProperty.call(states, oldKey)) {
        delete states[oldKey];
        await niSaveUserSubChatStates(states);
    }
}

function niUserSubStageLabel(firstStage) {
    const si = parseInt(firstStage, 10);
    const cnNums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const n = si > 0 && si <= 10 ? cnNums[si] : String(si || '');
    return si > 0 ? `${n}阶段` : '全程';
}

function niRenderUserSubUI() {
    const cfg = niGetUserSubConfig();
    const chk = q('#ni-user-sub-chk');
    const state = q('#ni-user-sub-state');
    const row = q('#ni-user-sub-switch-row');
    const sel = q('#ni-user-sub-char');
    const list = q('#ni-user-sub-list');
    if (!chk || !state || !sel || !list) return;

    const enabled = !!cfg.userSubEnabled;
    chk.checked = enabled;
    state.textContent = enabled ? '开' : '关';
    row?.classList.toggle('ni-switch-off', !enabled);

    const mode = niNormalizeUserSubMode(cfg.userSubMode);
    q('#ni-user-sub-mode')?.querySelectorAll('.ni-user-sub-mode-btn').forEach(btn => {
        const isOn = btn.dataset.userSubMode === mode;
        btn.classList.toggle('on', isOn);
        btn.setAttribute('aria-pressed', String(isOn));
    });

    // 从配置同步当前选择，保证切换聊天/页面后选中状态不丢失
    sel.value = cfg.userSubCharIdx ?? '';
    niRenderUserSubCharPicker('');
    niUpdateUserSubCharLabel();

    niNormalizeUserSubAliasesForSelectedChar(cfg);
    const aliases = (cfg.userSubAliases || []).slice()
        .sort((a, b) => (parseInt(a.firstStage || 0, 10) || 0) - (parseInt(b.firstStage || 0, 10) || 0));
    list.innerHTML = aliases.length
        ? aliases.map((a, i) => {
            const active = niUserSubAliasIsActive(a);
            const aliasKey = niUserSubAliasKey(a);
            const aliasKind = a.kind || 'custom';
            const stageLabel = niUserSubStageLabel(a.firstStage);
            return `<div class="ni-user-sub-row" data-row-idx="${i}" data-alias-key="${niEscAttr(aliasKey)}" data-alias-kind="${niEscAttr(aliasKind)}" data-first-stage="${niEscAttr(a.firstStage || '')}">
              <label class="ni-user-sub-check" title="是否替换为 <user>">
                <input class="ni-user-sub-enabled" type="checkbox"${active ? ' checked' : ''}>
                <span class="ni-user-sub-box"><i class="ti ti-check"></i></span>
              </label>
              <input class="ni-cef-input ni-user-sub-name" value="${niEscAttr(a.text || '')}" placeholder="称呼">
              <span class="ni-user-sub-stage-tag">${niEscHtml(stageLabel)}</span>
              <button class="ni-user-sub-del" title="删除称呼"><i class="ti ti-x"></i></button>
            </div>`;
        }).join('')
        : '<div class="ni-empty" style="padding:8px 0">请选择角色或添加称呼</div>';
    niSyncUserSubPromptPreview();
}

// ── 用户代入「代入角色」可搜索选择器（复用剧情 picker 的交互模式，独立 class 命名） ──

function niRenderUserSubCharPicker(query = '') {
    const list = q('#ni-user-sub-char-list');
    const hidden = q('#ni-user-sub-char');
    if (!list || !hidden) return;
    const keyword = String(query || '').trim().toLocaleLowerCase();
    const visible = (S.characters || []).map((c, i) => ({ c, i }))
        .filter(({ c }) => !keyword || String(c.name || '').toLocaleLowerCase().includes(keyword));
    const selectedIdx = hidden.value;
    const html = [];
    visible.forEach(({ c, i }) => {
        const fs = getCharFirstStage(c);
        const stage = fs != null ? `初次登场：${niUserSubStageLabel(fs)}` : '';
        const selected = String(i) === selectedIdx;
        html.push(`<button type="button" class="ni-char-picker-option${selected ? ' on' : ''}" data-char-idx="${i}" role="option" aria-selected="${selected ? 'true' : 'false'}">
      <span class="ni-char-picker-option-title">${niEscHtml(c.name || `角色${i + 1}`)}</span>
      ${stage ? `<span class="ni-char-picker-option-stage">${niEscHtml(stage)}</span>` : ''}
    </button>`);
    });
    if (!visible.length) {
        html.push(`<div class="ni-char-picker-empty">没有匹配的角色</div>`);
    }
    list.innerHTML = html.join('');
}

function niUpdateUserSubCharLabel() {
    const hidden = q('#ni-user-sub-char');
    const label = q('#ni-user-sub-char-label');
    if (!hidden || !label) return;
    const idx = parseInt(hidden.value, 10);
    const c = Number.isFinite(idx) ? (S.characters || [])[idx] : null;
    label.textContent = c?.name ? c.name : '选择角色';
}

function niToggleUserSubCharPicker(force = null) {
    const panel = q('#ni-user-sub-char-panel');
    const toggle = q('#ni-user-sub-char-toggle');
    const search = q('#ni-user-sub-char-search');
    if (!panel || !toggle) return;
    const shouldOpen = force == null ? panel.style.display === 'none' : !!force;
    if (!shouldOpen) {
        niCloseUserSubCharPicker();
        return;
    }
    niRenderUserSubCharPicker(search?.value || '');
    niUpdateUserSubCharLabel();
    panel.style.display = '';
    toggle.setAttribute('aria-expanded', 'true');
    setTimeout(() => search?.focus(), 0);
}

function niCloseUserSubCharPicker() {
    const panel = q('#ni-user-sub-char-panel');
    const toggle = q('#ni-user-sub-char-toggle');
    if (panel) panel.style.display = 'none';
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function niSelectUserSubChar(idx) {
    const hidden = q('#ni-user-sub-char');
    if (!hidden) return;
    hidden.value = String(idx == null ? '' : idx);
    niUpdateUserSubCharLabel();
    niCloseUserSubCharPicker();
}

async function niSaveUserSubFromUI({ rerender = false } = {}) {
    const cfg = niGetUserSubConfig();
    const chk = q('#ni-user-sub-chk');
    const sel = q('#ni-user-sub-char');
    const aliasRows = qa('#ni-user-sub-list .ni-user-sub-row');
    const hasLoadedCharacterOptions = !!sel && (S.characters?.length || 0) > 0;
    if (chk) cfg.userSubEnabled = chk.checked;
    cfg.userSubMode = niNormalizeUserSubMode(q('#ni-user-sub-mode .ni-user-sub-mode-btn.on')?.dataset.userSubMode ?? cfg.userSubMode);
    // 小说重数据尚未载入时，角色下拉只有占位项。此时切换总开关不能把聊天里已保存的角色和称呼清空。
    if (hasLoadedCharacterOptions) cfg.userSubCharIdx = sel.value;
    if (hasLoadedCharacterOptions || aliasRows.length > 0) cfg.userSubAliases = niReadUserSubAliasesFromUI();
    await niPersistUserSubConfig();
    niRefreshUserSubDependents({ rerenderUserSub: rerender });
}

function niRefreshUserSubDependents({ rerenderUserSub = false } = {}) {
    if (rerenderUserSub) niRenderUserSubUI();
    else niSyncUserSubPromptPreview();
    niSyncRoleplayToDepth();
    renderCharacters();
}

function niEscapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function niGetActiveUserSubNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    return (cfg.userSubAliases || [])
        .filter(niUserSubAliasIsActive)
        .map(a => (a.text || '').trim())
        .filter(name => name && name !== '<user>' && !/^user$/i.test(name))
        .sort((a, b) => b.length - a.length)
        .filter(name => {
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
        });
}

function niUserSubAliasText(alias) {
    return String(alias?.text || alias?.name || alias?.alias || alias?.title || '').trim();
}

function niUserSubAliasIsTitle(alias) {
    return String(alias?.kind || alias?.type || '').trim().toLowerCase() === 'title';
}

function niGetActiveUserSubIdentityNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    return (cfg.userSubAliases || [])
        .filter(niUserSubAliasIsActive)
        .filter(alias => !niUserSubAliasIsTitle(alias))
        .map(niUserSubAliasText)
        .filter(name => name && name !== '<user>' && !/^user$/i.test(name))
        .sort((a, b) => b.length - a.length)
        .filter(name => {
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
        });
}

function niGetUserSubTitleNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    const titles = [];
    const add = (name) => {
        const n = String(name || '').trim();
        if (!n || n === '<user>' || /^user$/i.test(n) || seen.has(n)) return;
        seen.add(n);
        titles.push(n);
    };
    (cfg.userSubAliases || [])
        .filter(niUserSubAliasIsActive)
        .filter(niUserSubAliasIsTitle)
        .forEach(alias => add(niUserSubAliasText(alias)));
    return titles.sort((a, b) => b.length - a.length);
}

function niGetUserSubstitutionNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    const names = [];
    const add = (name) => {
        const n = String(name || '').trim();
        if (!n || n === '<user>' || /^user$/i.test(n) || seen.has(n)) return;
        seen.add(n);
        names.push(n);
    };
    const addWithShortNames = (name) => {
        const n = String(name || '').trim();
        if (!n) return;
        add(n);
        niCharPresenceTerms({ name: n, aliases: [] }).forEach(add);
    };
    const primaryName = niGetSelectedUserSubCharName();
    addWithShortNames(primaryName);
    niGetActiveUserSubIdentityNames().forEach(addWithShortNames);
    return names.sort((a, b) => b.length - a.length);
}

function niGetUserSubOutputName() {
    const candidates = [];
    try {
        const ctx = getContext?.();
        candidates.push(ctx?.name1);
    } catch (_) {}
    candidates.push(name1);
    try {
        candidates.push(substituteParams('{{user}}'));
    } catch (_) {}
    const name = candidates
        .map(v => String(v || '').trim())
        .find(v => v && v !== '{{user}}');
    return name || '<user>';
}

function niGetSelectedUserSubCharName() {
    const cfg = niGetUserSubConfig();
    const idx = parseInt(cfg.userSubCharIdx, 10);
    return (S.characters?.[idx]?.name || '').trim();
}

function niGetUserSubPromptState(cfg = niGetUserSubConfig()) {
    if (!cfg.userSubEnabled) return 'boundary';
    return niIsUserSubPlayMode(cfg) ? 'play' : 'replace';
}

function niGetUserSubPromptField(state = niGetUserSubPromptState()) {
    if (state === 'boundary') return 'userSubBoundaryPrompt';
    if (state === 'play') return 'userSubPromptPlay';
    return 'userSubPromptReplace';
}

function niIsLegacyDefaultUserSubPrompt(state, text) {
    if (state !== 'replace') return false;
    const t = String(text || '').trim();
    return /^\[用户代入角色\]\n<user>代表原著角色「[^」]+」。以下称呼只作为同一角色的映射：[\s\S]*。后续正文使用<user>，不要把原名或称呼写成另一个角色。\n\[\/用户代入角色\]$/.test(t);
}

function niGetUserSubCustomPrompt(state = niGetUserSubPromptState(), cfg = extension_settings[EXT_NAME] || {}) {
    const field = niGetUserSubPromptField(state);
    if (typeof cfg[field] !== 'string') return null;
    if (niIsLegacyDefaultUserSubPrompt(state, cfg[field])) return null;
    return cfg[field];
}

function niSaveUserSubPromptFromUI() {
    const ta = q('#ni-user-sub-prompt-preview');
    if (!ta) return;
    const cfg = extension_settings[EXT_NAME] || {};
    cfg[niGetUserSubPromptField(niGetUserSubPromptState())] = ta.value ?? '';
    saveSettingsDebounced();
}

function niBuildDefaultUserSubIdentityPrompt() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return '';

    const primaryName = niGetSelectedUserSubCharName();
    const outputName = niGetUserSubOutputName();
    const outputLine = outputName && outputName !== '<user>'
        ? `当前用户显示名是「${outputName}」；<user>与「${outputName}」是同一人。正文中提到该代入角色时优先写「${outputName}」。`
        : `<user>就是当前用户。正文中提到该代入角色时使用 <user>。`;
    const names = [];
    [primaryName, ...niGetActiveUserSubIdentityNames()].forEach(name => {
        const n = (name || '').trim();
        if (n && !names.includes(n)) names.push(n);
    });
    const titleNames = niGetUserSubTitleNames();
    const titleLine = titleNames.length
        ? `以下称谓是他人对 <user> 的身份/礼貌称呼，可在对话和叙述中保留：${titleNames.join('、')}；但它们不得指向另一个独立角色。`
        : '';
    if (!names.length) return '';

    const displayName = primaryName || names[0];
    if (niIsUserSubPlayMode(cfg)) {
        const namesLine = names.length > 1
            ? `「${displayName}」及其别称/称呼（${names.join('、')}）均指向 <user>，不得再把「${displayName}」作为独立NPC演绎。`
            : `「${displayName}」指向 <user>，不得再把「${displayName}」作为独立NPC演绎。`;
        return `[用户代入角色]\n<user>正在扮演原著角色「${displayName}」本人。\n${outputLine}\n${namesLine}\n${titleLine ? `${titleLine}\n` : ''}可将当前剧情时间点以前已经成立的身份、关系与经历作为 <user> 的既有事实。\n当前剧情时间点之后的原著选择、行动和结局只作为参考惯性，不得因为原著中「${displayName}」这样做过，就强制让 <user> 复刻。\n[/用户代入角色]`;
    }
    return `[用户代入角色]\n<user>替换原著角色「${displayName}」在原著中的人生位置。\n${outputLine}\n以下身份名称只指向 <user>：${names.join('、')}。\n${titleLine ? `${titleLine}\n` : ''}在当前分支中，不存在一个与 <user> 同时独立行动的「${displayName}」NPC；看到小说原著片段、剧情节点、角色人设里的身份名称时，都按 <user> 的身份、关系、过往和处境理解。\n输出正文时，身份名使用用户显示名或 <user>；身份/礼貌称谓可以保留为称呼。不要让该原角作为独立NPC出场、说话、行动或承接关系。\n当前剧情时间点之后的原著选择、行动和结局只作为参考惯性，不得强迫 <user> 复刻。\n[/用户代入角色]`;
}

function niBuildUserSubRuntimeGuard() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return '';
    const primaryName = niGetSelectedUserSubCharName();
    const names = niGetUserSubstitutionNames();
    if (!primaryName && !names.length) return '';
    const outputName = niGetUserSubOutputName();
    const outputLabel = outputName && outputName !== '<user>' ? `「${outputName}」` : '<user>';
    const sourceNames = names.length ? names.join('、') : primaryName;
    const titleNames = niGetUserSubTitleNames();
    const titleLine = titleNames.length
        ? `以下称谓可作为他人对 ${outputLabel} 的身份/礼貌称呼保留，不需要替换成姓名，但不得指向另一个独立角色：${titleNames.join('、')}。\n`
        : '';
    return `[用户代入强制映射]\n本轮请求中，以下原著身份名称都不是独立角色，而是当前用户 ${outputLabel}：${sourceNames}。\n${titleLine}在阅读聊天历史、角色卡、世界书、小说片段、剧情节点、角色人设和偏差档案时，凡出现这些身份名称，都按 ${outputLabel} 理解。\n输出正文时不得继续使用这些身份名称来指代该用户代入角色；应写 ${outputLabel}。身份/礼貌称谓可按场景保留。除非剧情明确讨论“原著文本中的名字”这个概念，否则不要把这些名称作为可出场 NPC 写出。\n[/用户代入强制映射]`;
}

function niBuildUserSubIdentityPrompt() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return '';
    const customPrompt = niGetUserSubCustomPrompt(niGetUserSubPromptState(cfg));
    if (customPrompt !== null) {
        const guard = niBuildUserSubRuntimeGuard();
        return guard ? `${customPrompt.trim()}\n\n${guard}` : customPrompt;
    }
    return niBuildDefaultUserSubIdentityPrompt();
}

function niGetUserSubPromptPreview() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) {
        return {
            state: '关闭边界',
            text: niBuildUserRoleBoundaryPrompt(),
        };
    }
    const state = niGetUserSubPromptState(cfg);
    const customPrompt = niGetUserSubCustomPrompt(state);
    if (customPrompt !== null) {
        return {
            state: niIsUserSubPlayMode(cfg) ? '扮演模式' : '替换模式',
            text: customPrompt,
        };
    }
    const prompt = niBuildUserSubIdentityPrompt();
    if (!prompt) {
        return {
            state: '尚未生效',
            text: '当前已开启“用户代入角色”，但还没有可注入的代入提示词。\n请先选择代入角色，并至少保留一个有效称呼。有效后会在每次请求前作为隐藏系统提示注入。',
        };
    }
    return {
        state: niIsUserSubPlayMode(cfg) ? '扮演模式' : '替换模式',
        text: prompt,
    };
}

function niSyncUserSubPromptPreview() {
    const ta = q('#ni-user-sub-prompt-preview');
    const state = q('#ni-user-sub-prompt-state');
    if (!ta && !state) return;
    const preview = niGetUserSubPromptPreview();
    if (ta) ta.value = preview.text || '';
    if (state) state.textContent = preview.state || '';
}

function niBuildUserRoleBoundaryPrompt() {
    const cfg = niGetUserSubConfig();
    if (cfg.userSubEnabled) return '';
    const customPrompt = niGetUserSubCustomPrompt('boundary');
    return customPrompt !== null ? customPrompt : USER_SUB_BOUNDARY_PROMPT;
}

function niReplaceOutsideAngleTags(text, pattern, replacement) {
    return String(text).split(/(<[^>\n]*>)/g).map(part => {
        if (part.startsWith('<') && part.endsWith('>')) return part;
        return part.replace(pattern, replacement);
    }).join('');
}

// 替换目标自身包含的名字不能再替换。niGetUserSubstitutionNames 会带上 niCharPresenceTerms
// 派生的去姓短名（「凌小东」→「小东」），当用户 persona 名就是角色本人时，把「小东」换成
// 「凌小东」等于在原名前插一个姓，得到「凌凌小东」；结果又被写回聊天记录，下一轮再叠一次。
function niFilterUserSubNamesForReplacement(names, replacement) {
    const target = String(replacement || '');
    return names.filter(name => name && !target.includes(name));
}

// 收敛历史污染：修复前每轮都会多插一个姓前缀，存档里留下「凌凌小东」「凌凌凌凌小东」。
// 只折叠「替换目标的前缀连续重复 ≥2 次 + 该短名」这一种形态，正常叠词不会命中。
function niBuildUserSubRepeatFixes(names, replacement) {
    const target = String(replacement || '');
    const fixes = [];
    if (!target) return fixes;
    names.forEach(name => {
        if (!name || name === target || !target.endsWith(name)) return;
        const prefix = target.slice(0, target.length - name.length);
        if (!prefix) return;
        fixes.push(new RegExp(`(?:${niEscapeRegExp(prefix)}){2,}${niEscapeRegExp(name)}`, 'g'));
    });
    return fixes;
}

function niApplyUserSubstitution(text, replacement = niGetUserSubOutputName()) {
    if (typeof text !== 'string' || !text) return text;
    const allNames = niGetUserSubstitutionNames();
    if (!allNames.length) return text;
    const target = replacement || '<user>';
    let out = text;
    niBuildUserSubRepeatFixes(allNames, target).forEach(re => {
        out = niReplaceOutsideAngleTags(out, re, target);
    });
    const names = niFilterUserSubNamesForReplacement(allNames, target);
    if (!names.length) return out;
    // 单趟扫描。逐个名字多趟 replace 会让前一趟的产物被后一趟再次匹配，
    // 长名先替换也救不回来——短名仍会命中刚写进去的替换目标。
    const pattern = new RegExp(names.map(niEscapeRegExp).join('|'), 'g');
    return niReplaceOutsideAngleTags(out, pattern, target);
}

function niApplyUserSubstitutionToContent(content) {
    if (typeof content === 'string') return niApplyUserSubstitution(content);
    if (Array.isArray(content)) {
        content.forEach(part => {
            if (!part || typeof part !== 'object') return;
            if (typeof part.text === 'string') part.text = niApplyUserSubstitution(part.text);
            if (typeof part.content === 'string') part.content = niApplyUserSubstitution(part.content);
        });
    }
    return content;
}

function niShouldSkipUserSubRewriteContent(content) {
    const text = typeof content === 'string'
        ? content
        : (Array.isArray(content)
            ? content.map(part => typeof part?.text === 'string' ? part.text : (typeof part?.content === 'string' ? part.content : '')).join('\n')
            : '');
    return /\[(用户代入角色|用户代入强制映射|关于用户角色)\]/.test(text);
}

function niApplyUserSubstitutionToPromptMessages(messages) {
    if (!Array.isArray(messages) || !niGetUserSubstitutionNames().length) return;
    messages.forEach(msg => {
        if (!msg || typeof msg !== 'object') return;
        if (niShouldSkipUserSubRewriteContent(msg.content)) return;
        if (Object.prototype.hasOwnProperty.call(msg, 'content')) {
            msg.content = niApplyUserSubstitutionToContent(msg.content);
        }
        if (typeof msg.mes === 'string') msg.mes = niApplyUserSubstitution(msg.mes);
    });
}

function niFinalUserSubPromptRewrite(eventData) {
    if (eventData?.dryRun) return;
    if (extension_settings[EXT_NAME]?.pluginEnabled === false) return;
    niApplyUserSubstitutionToPromptMessages(eventData?.chat);
}

function niPostprocessUserSubMessage(messageId) {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled || !niGetUserSubstitutionNames().length) return;
    const id = Number(messageId);
    if (!Number.isFinite(id) || id < 0) return;
    try {
        const ctx = getContext?.();
        const msg = ctx?.chat?.[id];
        if (!msg || msg.is_user || typeof msg.mes !== 'string') return;
        const before = msg.mes;
        const after = niApplyUserSubstitution(before);
        if (after === before) return;
        msg.mes = after;
        const swipeId = Number.isFinite(Number(msg.swipe_id)) ? Number(msg.swipe_id) : 0;
        if (Array.isArray(msg.swipes) && msg.swipes[swipeId] === before) msg.swipes[swipeId] = after;
        const el = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
        if (el && typeof messageFormatting === 'function') {
            el.innerHTML = messageFormatting(after, msg.name, msg.is_system, msg.is_user, id, {}, false);
        }
        if (typeof ctx?.saveChat === 'function') ctx.saveChat();
    } catch (e) {
        console.warn('[NI] 用户代入回复替换失败:', e);
    }
}

function niUpdateVecOffBtn() {
    const btn = q('#ni-vec-off-btn');
    const modeWrap = q('.ni-stage-inj-mode-wrap');
    const cfg = extension_settings[EXT_NAME] || {};
    const vectorInjectionDisabled = niIsVectorInjectionDisabledByUser(cfg);
    const uiState = niResolveStageInjectionUiState({
        stageCount: S.stageMapN,
        stageStates: S.stageStates,
        stageVecDone: S.stageVecDone,
        vecDone: S.vecDone,
        vecInjDisabled: vectorInjectionDisabled,
    });
    niUpdateStageInjectionBudgetNote();
    // 无向量数据时隐藏按钮，始终显示未向量注入模式选择器
    if (!uiState.hasAnyVector) {
        if (btn) btn.style.display = 'none';
        if (modeWrap) modeWrap.style.display = '';
        // 也隐藏补全按钮
        const fb = q('#ni-btn-vec-fill');
        if (fb && !S._vecFillVisible) fb.style.display = 'none';
        return;
    }
    if (!btn) {
        if (modeWrap) modeWrap.style.display = '';
        return;
    }
    // 顶部模式只跟随当前启用阶段，已关闭阶段残留的向量数据不应影响显示。
    btn.style.display = uiState.showVectorToggle ? '' : 'none';
    const disabled = vectorInjectionDisabled;
    btn.classList.toggle('active', disabled);
    btn.title = disabled ? '向量化注入已关闭（点击重新启用）' : '关闭向量化注入（有向量数据但暂不调用）';
    // 只要当前有未向量阶段参与注入，就保留其模式选择器；混合阶段可同时显示两种控制。
    if (modeWrap) modeWrap.style.display = uiState.showRawMode ? '' : 'none';
    // 有向量数据时，异步检查是否有缺失块，有才显示补全按钮
    if (!S._vecRunning) niCheckFillBtnVisibility();
}

// 异步对比 IndexedDB 与应有块数，决定是否显示补全按钮
async function niCheckFillBtnVisibility() {
    const fillBtn = q('#ni-btn-vec-fill');
    if (!fillBtn || S._vecRunning) return;
    if (!canUseDerivedModules(S)) {
        fillBtn.style.display = 'none';
        return;
    }
    // 避免并发重复检查
    if (S._vecCheckPending) return;
    S._vecCheckPending = true;
    try {
        if (!niHasLoadedChunks()) {
            await niEnsureChunksLoaded();
        }
        // 读 IndexedDB 已有 key 集合
        const existing = await dbLoadByNovel();
        const existingKeys = new Set(existing.map(c => `s${c.stageIdx}_c${c.chunkIdx}`));

        // 重建完整 chunk 列表
        const stageBuckets = {};
        for (let i = 0; i < S.chunkStatus.length; i++) {
            if (S.chunkStatus[i] !== 'done') continue;
            const vecText = (S.chunkResults[i] && S.chunkResults[i].trim())
                ? S.chunkResults[i] : (S.chunks[i] || '');
            if (!vecText.trim()) continue;
            const assignedStages = getAssignedStagesForChunk(S, i);
            if (!assignedStages.length) continue;
            for (const si of assignedStages) {
                if (!stageBuckets[si]) stageBuckets[si] = [];
                const subChunks = splitText(vecText, 500);
                stageBuckets[si].push(...subChunks);
            }
        }

        // 有任何缺失就显示按钮，否则隐藏
        let hasMissing = false;
        outer: for (const [siStr, texts] of Object.entries(stageBuckets)) {
            const si = Number(siStr);
            for (let ci = 0; ci < texts.length; ci++) {
                if (!existingKeys.has(`s${si}_c${ci}`)) { hasMissing = true; break outer; }
            }
        }
        const fb = q('#ni-btn-vec-fill');
        S._vecFillVisible = hasMissing;
        if (fb && !S._vecRunning) fb.style.display = hasMissing ? 'flex' : 'none';
    } catch(e) {
        console.warn('[NI] niCheckFillBtnVisibility 失败:', e);
    } finally {
        S._vecCheckPending = false;
    }
}

const _apiQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:api-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.apiRateLimit,
});

// 判定/加料独立的限速队列（与清洗限速互不影响；limit<=0 表示不限速）
const _judgeQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:judge-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.judgeRateLimit,
});
const _enrichQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:enrich-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.enrichRateLimit,
});

// 向量化 API 限速队列
const _vecQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:vec-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.vecRateLimit,
});

// ============================================================
// 自动生成阶段标题和概括
// ============================================================
// 限速队列获取（支持中止）：清洗/判定/加料各用各的队列，互不阻塞
async function niAcquireFromQueue(queue, signal = null) {
    if (!signal) {
        await queue.acquire();
        return;
    }
    if (signal.aborted) throw new Error('请求已中止（超时或用户操作）');
    let onAbort = null;
    const abortPromise = new Promise((_, reject) => {
        onAbort = () => reject(new Error('请求已中止（超时或用户操作）'));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        await Promise.race([queue.acquire(), abortPromise]);
    } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new Error('请求已中止（超时或用户操作）');
}

// 角色/阶段概括与清洗共用每分钟限速；实际并发由 apiConcurrency 和 ApiSemaphore 共同限制
async function niAcquireApiRateSlot(signal = null) {
    return niAcquireFromQueue(_apiQueue, signal);
}

// 判定（AI 精判/批量扫描）独立限速；并发由 judgeConcurrency 和 JudgeSemaphore 限制
async function niAcquireJudgeRateSlot(signal = null) {
    return niAcquireFromQueue(_judgeQueue, signal);
}

// AI 加料独立限速；并发由 enrichConcurrency 和 EnrichSemaphore 限制
async function niAcquireEnrichRateSlot(signal = null) {
    return niAcquireFromQueue(_enrichQueue, signal);
}

// 手动触发：角色概括
// ============================================================
// Embedding API 调用
// ============================================================
const niVectorRecallService = createVectorRecallService({
    getSettings: () => extension_settings[EXT_NAME],
    getState: () => S,
    defaultSettings: DEFAULT_SETTINGS,
    dbLoadByNovel,
    cosineSim,
    isVectorRowCompatible,
    embeddingClient: { niRequestEmbeddings, embedText },
    onVectorQueryCompared: niHandleVectorQueryCompared,
});
const { recallRelevantWeighted, recallRelevant } = niVectorRecallService;
niInvalidateVectorRecallCache = niVectorRecallService.invalidateCache;

// ============================================================
// 向量召回
// ============================================================

// ============================================================
// 偏差分析
// ============================================================
// 世界设定模块
// ============================================================
const {
    niGetWorldCategories,
    niSaveWorldCategories,
    niRenderWorldSettings,
    niWorldToggleCat,
    niWorldToggleEdit,
    niWorldCallApi,
    niWorldGenOne,
    niWorldGenAll,
    niWorldAddCat,
    niWorldDeleteCat,
    niWorldSavePrompt,
    niGetDeviationChatRoot,
    niReadDeviationChatState,
    niSetDeviationSections,
    niGetDeviationSections,
    niGetDeviationGuideText,
    niSyncDeviationSectionInputs,
    niUpdateDeviationSectionsFromUI,
    niApplyDeviationState,
    niSaveDeviationChatState,
    niClearLegacyDeviationSettings,
    niReadLegacyDeviationState,
    niLoadDeviationStateFromChat,
    niMaybeMigrateLegacyDeviationToChat,
    niSaveDeviationGuideNow,
    niQueueDeviationGuideSave,
    niSyncDeviationResultUI,
    niDevButtonLabel,
    niDevAutoEvery,
    niDevRecentMessageLimit,
    niGetRenderedChatMessages,
    niGetCurrentChatMessages,
    niBuildChatRangeContext,
    niGetDevRetryRange,
    niSetDevProgress,
    niSetDevButtonState,
    niSetDevRetryButtonState,
    niSyncDevButtonLabel,
    niBuildDeviationPrompt,
    niGetEnabledDevStages,
    niBuildDevStageReference,
    niRunDev,
    niCurrentChatFloorCount,
    niNormalizeDevCoveredFloorToTotal,
    niResetDevAutoCounter,
    niNotifyDevAutoComplete,
    niDevAutoSkipMessage,
    niStyleSyncMode,
    niStylePopulateChunkSel,
    niGenerateStyle,
    niDevCoveredFloorFor,
    niMaybeAutoRunDev,
    niStartDevAutoCatchup,
    niBindDeviationAutoUpdateEvents,
    animateBar,
} = createGenerationController({
    S,
    extension_settings,
    EXT_NAME,
    DEFAULT_SETTINGS,
    q,
    getContext,
    niNormalizeDeviationSections,
    niBuildDeviationFactsContext,
    niBuildDeviationFactsText,
    niBuildDeviationGuideFromSections,
    niParseDeviationGuideSections,
    niBuildDeviationSectionsFromAnalysis,
    niMergeDeviationSections,
    niNormalizeDeviationFacts,
    niNormalizeDeviationFactHistory,
    niReconcileDeviationFacts,
    niNormalizeDevRange,
    niDevRangeLabel,
    niDevRangeProgressLabel,
    niBuildDevChatEntriesText,
    niDevIsCountableMessage,
    niDevMessageFloor,
    niDevMessageMesId,
    niDevMessageRole,
    niDevMessageText,
    niMergeDevMessagesByFloor,
    niBoundIntValue,
    getNodesForStage,
    niMergeStageNodes,
    recallRelevant,
    niResolveVectorRecallStageScopes,
    niGetTbNodes,
    niTbGetInjectionNode,
    callCleanApi,
    niSaveSettings,
    saveSettingsDebounced,
    niServerSaveHeavy,
    eventSource,
    event_types,
    DEV_PROMPT,
    STYLE_PROMPT,
    NI_DEV_CURRENT_TEXT_LIMIT,
    NI_DEV_RECALL_TEXT_LIMIT,
    document,
    alert,
    toastr: globalThis.toastr,
    worldSettings: {
        state: S,
        query: q,
        escapeHtml: niEscHtml,
        saveSettings: niSaveSettings,
        canUseDerived: canUseDerivedModules,
        getAllPlots: getAllPlotsInStoryOrder,
        callApiSeq,
        alert: message => alert(message),
        prompt: (...args) => prompt(...args),
        confirm: message => confirm(message),
        logger: console,
        defaultCategories: WORLD_DEFAULT_CATEGORIES,
        extractPrompt: WORLD_EXTRACT_PROMPT,
        shrinkPrompt: WORLD_SHRINK_PROMPT,
        responseLength: WORLD_RESPONSE_LENGTH,
        lengthRetries: WORLD_LENGTH_RETRIES,
    },
});

Object.assign(window, {
    niRunDev,
    niWorldToggleCat,
    niWorldToggleEdit,
    niWorldGenOne,
    niWorldGenAll,
    niWorldAddCat,
    niWorldDeleteCat,
    niWorldSavePrompt,
});

// ============================================================
// 注入酒馆上下文
// ============================================================
function niRecallTextHasTerm(text, term) {
    const source = String(text || '').toLowerCase().replace(/\s+/g, '');
    const needle = String(term || '').trim().toLowerCase().replace(/\s+/g, '');
    return !!needle && source.includes(needle);
}

function niBuildVectorRecallKeywordTerms(texts, nodes = []) {
    const queryText = (Array.isArray(texts) ? texts : [])
        .map(text => String(text || ''))
        .join('\n');
    const terms = [];
    const add = term => {
        const value = String(term || '').trim();
        if (value.length < 2 || value.length > 32) return;
        if (niRecallTextHasTerm(queryText, value)) terms.push(value);
    };

    (S.characters || []).forEach(character => {
        add(character?.name);
        try {
            niCharPresenceTerms(character).forEach(add);
        } catch (_) {
            // 角色资料不完整时忽略关键词辅助，不影响语义召回。
        }
    });
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
        add(node?.title);
        (Array.isArray(node?.branch_links) ? node.branch_links : []).forEach(add);
    });
    return [...new Set(terms)].sort((a, b) => b.length - a.length);
}

function niGetCurrentStageRecallNodes(scope) {
    const nodes = [];
    if (scope?.currentWindowStart == null || scope?.boundaryStageIdx == null) return nodes;
    for (let stageIdx = scope.currentWindowStart; stageIdx <= scope.boundaryStageIdx; stageIdx++) {
        nodes.push(...niMergeStageNodes(getNodesForStage(stageIdx)));
    }
    return nodes;
}

function niBuildCurrentStageNodeRecallQuery(scope, curTbNode) {
    if (curTbNode) {
        // 穿书模式只使用当前节点，不把当前节点之后的节点带入查询。
        return niBuildTbNodeVectorQuery(curTbNode);
    }
    const nodes = niGetCurrentStageRecallNodes(scope);
    return niBuildStageNodeVectorQuery(nodes, { maxNodes: 8, maxTextLength: 2600 });
}

async function onPromptReady(eventData) {
    if (eventData?.dryRun) return;
    // 插件总开关
    if (extension_settings[EXT_NAME]?.pluginEnabled === false) return;

    const cfg = extension_settings[EXT_NAME];

    // 获取 setExtensionPrompt 一次供后续使用
    let setExtensionPrompt;
    try {
        ({ setExtensionPrompt } = await import('/script.js'));
    } catch (e) {
        console.warn('[NI] 无法导入 setExtensionPrompt:', e);
    }

    // 辅助：执行注入，失败则降级到追加 system 消息
    function doInject(key, content, pos, depth, role, opts = {}) {
        if (opts.applyUserSub !== false) content = niApplyUserSubstitution(content);
        if (!content.trim()) return;
        if (eventData?.chat && Array.isArray(eventData.chat)) {
            niInsertIntoEventChat(eventData.chat, content, pos, depth, role);
        } else if (setExtensionPrompt) {
            setExtensionPrompt(key, content, pos, depth, true, role);
        }
    }

    const userSubIdentityPrompt = niBuildUserSubIdentityPrompt();
    if (userSubIdentityPrompt) {
        doInject(`${EXT_NAME}_user_sub`, userSubIdentityPrompt, 0, 0, 0, { applyUserSub: false });
    }
    const userRoleBoundaryPrompt = niBuildUserRoleBoundaryPrompt();
    if (userRoleBoundaryPrompt) {
        doInject(`${EXT_NAME}_user_role_boundary`, userRoleBoundaryPrompt, 0, 0, 0, { applyUserSub: false });
    }

    const ctx = getContext();
    const chat = ctx?.chat || [];
    if (!chat.length) return;
    niLoadDeviationStateFromChat({ allowLegacyMigration: false, collapsed: true, syncUI: false });

    // 读取各自的注入配置
    const vecPos   = cfg.vecInjPos   ?? DEFAULT_SETTINGS.vecInjPos;
    const vecDepth = cfg.injDepth    ?? DEFAULT_SETTINGS.injDepth;
    const vecRole  = cfg.vecInjRole  ?? DEFAULT_SETTINGS.vecInjRole;
    const charPos  = cfg.charInjPos  ?? DEFAULT_SETTINGS.charInjPos;
    const charDepth= cfg.charInjDepth?? DEFAULT_SETTINGS.charInjDepth;
    const charRole = cfg.charInjRole ?? DEFAULT_SETTINGS.charInjRole;
    const plotPos  = cfg.plotInjPos  ?? DEFAULT_SETTINGS.plotInjPos;
    const plotDepth= cfg.plotInjDepth?? DEFAULT_SETTINGS.plotInjDepth;
    const plotRole = cfg.plotInjRole ?? DEFAULT_SETTINGS.plotInjRole;

    // 分离向量召回与普通直注，并统一解析穿书模式下真正会参与本轮的阶段。
    const stageInjectionPlan = niResolveStageInjectionExecutionPlan(cfg);
    const {
        enabledStages,
        vectorInjectionDisabled,
        curTbNode,
        vectorRecallScope,
        directStageInjectionStages,
    } = stageInjectionPlan;

    // ① 向量块注入
    if (!vectorInjectionDisabled && (
        vectorRecallScope.currentStages.length || vectorRecallScope.historicalStages.length
    )) {
        const nodeRecallContext = curTbNode
            ? niBuildTbLightRecallContext(curTbNode, { nodes: getAllPlotsInStoryOrder(S) })
            : null;
        const lightRecallContext = extension_settings[EXT_NAME]?.tbLightRecallMode
            ? nodeRecallContext
            : null;
        const nodeContext = niBuildCurrentStageNodeRecallQuery(vectorRecallScope, curTbNode);

        // 按用户设置取消息条数；各条消息单独提取后加权召回
        const msgTag    = (extension_settings[EXT_NAME]?.vecMsgTag || '').trim();
        const msgCount  = extension_settings[EXT_NAME]?.vecMsgCount ?? DEFAULT_SETTINGS.vecMsgCount;
        const recentMsgs = niSelectRecentVectorMessageTexts(chat, msgCount, msgTag);

        // 构造加权 queries：最新条权重1.0，每往前一条×0.5
        // nodeContext 拼入最新一条
        const weightedQueries = niBuildWeightedVectorQueries(recentMsgs, { nodeContext });
        const keywordTerms = niBuildVectorRecallKeywordTerms(
            weightedQueries.map(query => query.text),
            niGetCurrentStageRecallNodes(vectorRecallScope),
        );

        if (weightedQueries.length) {
            try {
                const recallText = await recallRelevantWeighted(weightedQueries, vectorRecallScope.currentStages, {
                    lightRecallContext,
                    nodeRecallContext,
                    historicalStages: vectorRecallScope.historicalStages,
                    historyTopK: 2,
                    splitSections: true,
                    keywordTerms,
                    // 非穿书模式没有当前节点可锚定，让召回自己从得分分布反推当前阶段。
                    inferAnchorStage: !curTbNode,
                });
                if (recallText.trim()) {
                    const vecContent = `[小说原著相关片段·向量召回]\n${recallText}\n[/小说原著相关片段·向量召回]`;
                    doInject(`${EXT_NAME}_vec`, vecContent, vecPos, vecDepth, vecRole);
                }
            } catch (e) { console.warn('[NI] 向量召回失败:', e); }
        }
    }

    // ② 阶段剧情注入
    if (directStageInjectionStages.length) {
        const rawMode = niNormalizeRawInjMode(cfg.rawInjMode);
        if (rawMode === 'compressed') {
            await niEnsureChunksLoaded();
        }
        const maxTokens = niNormalizeRawInjectionMaxTokens(
            cfg.plotInjMaxTokens,
            DEFAULT_SETTINGS.plotInjMaxTokens,
        );
        const result = niBuildStageInjectionPayloadForPlan(stageInjectionPlan, cfg);

        if (result.content) {
            doInject(`${EXT_NAME}_plot`, result.content, plotPos, plotDepth, plotRole);
        }
        niUpdateStageInjectionBudgetNote(result, { visible: true });
        if (result.omittedStages.length || result.truncated) {
            console.info('[NI] 未向量阶段注入已按 Token 上限裁剪:', {
                maxTokens,
                injectedDetailStages: result.detailStages,
                injectedSummaryStages: result.summaryStages,
                omittedStages: result.omittedStages.length,
                truncated: result.truncated,
            });
        }
    } else {
        niUpdateStageInjectionBudgetNote(null, { visible: false });
    }

    // ③ 角色人设注入
    const charLines = [];
    if (S.characters.length) {
        const userSubCfg = niGetUserSubConfig();
        S.characters.forEach((c, idx) => {
            if (!c.name) return;
            if (c.enabled === false) return;
            if (niIsUserSubReplaceSelectedChar(idx, userSubCfg)) return;
            const isUserSubPlayChar = niIsUserSubSelectedChar(idx, userSubCfg) && niIsUserSubPlayMode(userSubCfg);
            const lines = isUserSubPlayChar
                ? [`[用户扮演原著角色资料：<user>（原著角色：${c.name}；${c.role || '其他'}）]`]
                : [`[原著角色NPC：${c.name}（${c.role || '其他'}）]`];
            const showRaw = c.showRaw !== false;
            const showAi  = niGetCharAiShowEnabled(idx);
            const aiProfile = niGetCharAiProfile(idx);
            if (showAi && aiProfile) {
                if (typeof aiProfile === 'object') {
                    const p = aiProfile;
                    if (p.identity)    lines.push(`身份：${p.identity}`);
                    if (p.appearance)  lines.push(`外貌：${p.appearance}`);
                    if (p.personality) lines.push(`性格：${p.personality}`);
                    if (p.relations)   lines.push(`关系：${p.relations}`);
                } else {
                    lines.push(aiProfile);
                }
            } else if (showRaw) {
                if (c.identity)    lines.push(`身份：${c.identity}`);
                if (c.appearance)  lines.push(`外貌：${c.appearance}`);
                if (c.personality) lines.push(`性格：${c.personality}`);
                if (c.relations)   lines.push(`关系：${c.relations}`);
            }
            if (lines.length > 1) charLines.push(lines.join('\n'));
        });
    }
    if (charLines.length) {
        const userSubCfg = niGetUserSubConfig();
        const charIntro = userSubCfg.userSubEnabled
            ? (niIsUserSubPlayMode(userSubCfg)
                ? '说明：以下为原著角色资料。标记为“用户扮演原著角色资料：<user>”的条目属于 <user> 的既有身份与人物基础，不是独立NPC；其他角色仍作为NPC演绎。'
                : '说明：以下为原著角色NPC资料。已由“用户代入角色”映射到 <user> 的原著角色不会在此处作为独立NPC发送；其他角色仍作为NPC演绎。')
            : '说明：以下原著角色默认作为故事中的独立NPC处理，不默认等同于 <user>；不要把原著角色经历、剧情事件、身份关系或原著角色曾经做出的选择自动映射到 <user>。';
        const charContent = `[原著角色人设]\n${charIntro}\n\n${charLines.join('\n\n')}\n[/原著角色人设]`;
        doInject(`${EXT_NAME}_char`, charContent, charPos, charDepth, charRole);
    }

    // ④ 世界设定注入
    const worldPos   = cfg.worldInjPos   ?? DEFAULT_SETTINGS.worldInjPos;
    const worldDepth = cfg.worldInjDepth ?? DEFAULT_SETTINGS.worldInjDepth;
    const worldRole  = cfg.worldInjRole  ?? DEFAULT_SETTINGS.worldInjRole;
    const worldContent = niBuildWorldInjectionText(niGetWorldCategories());
    if (worldContent) {
        doInject(`${EXT_NAME}_world`, worldContent, worldPos, worldDepth, worldRole);
    }

    // ── 偏差注入 ──
    const deviationGuide = niGetDeviationGuideText({ preferUI: true }).trim();
    if (deviationGuide) {
        S.deviationGuide = deviationGuide;
        const devPos   = cfg.devInjPos   ?? DEFAULT_SETTINGS.devInjPos;
        const devDepth = cfg.devInjDepth ?? DEFAULT_SETTINGS.devInjDepth;
        const devRole  = cfg.devInjRole  ?? DEFAULT_SETTINGS.devInjRole;
        doInject(`${EXT_NAME}_dev`, `[当前剧情偏差约束]\n${deviationGuide}\n[/当前剧情偏差约束]`, devPos, devDepth, devRole);
    }

    // ── 文风注入 ──
    const styleGuide   = (q('#ni-style-result')?.value || S.styleGuide || '').trim();
    if (styleGuide) {
        const stylePos   = cfg.styleInjPos   ?? DEFAULT_SETTINGS.styleInjPos;
        const styleDepth = cfg.styleInjDepth ?? DEFAULT_SETTINGS.styleInjDepth;
        const styleRole  = cfg.styleInjRole  ?? DEFAULT_SETTINGS.styleInjRole;
        doInject(`${EXT_NAME}_style`, `[文风执行指南]\n${styleGuide}\n[/文风执行指南]`, stylePos, styleDepth, styleRole);
    }

}

// 拉取模型列表
// ============================================================
async function fetchModels(urlInputId, keyInputId, selectId, textInputId) {
    const url = q(`#${urlInputId}`)?.value?.trim();
    const key = q(`#${keyInputId}`)?.value?.trim();
    const btn = q(`#${textInputId === 'ni-clean-model' ? 'ni-clean-fetch-models' : 'ni-vec-fetch-models'}`);
    await niLoadModelList({
        url,
        key,
        showAlert: alert,
        setBusy: busy => {
            if (!btn) return;
            btn.disabled = busy;
            btn.querySelector('i').className = busy ? 'ti ti-loader' : 'ti ti-refresh';
        },
        onModels: models => {
            niApplyModelListToControls({
                models,
                selectElement: q(`#${selectId}`),
                textInputElement: q(`#${textInputId}`),
                escapeAttribute: niEscAttr,
                escapeHtml: niEscHtml,
                onSelected: value => {
                    const cfg = extension_settings[EXT_NAME];
                    if (textInputId === 'ni-clean-model') cfg.cleanModel = value;
                    else if (textInputId === 'ni-vec-model') {
                        cfg.vecModel = value;
                        niRefreshCurrentVectorSourceHint().catch(e => console.warn('[NI] 刷新向量来源提示失败:', e));
                    }
                    niSaveSettings();
                },
            });
        },
    });
}

// ============================================================
// 处理 Tab — 文风模块
// ============================================================

/** 根据模式切换 UI 显隐*/
const niThemeEditor = createThemeEditor({
    EXT_NAME,
    DEFAULT_SETTINGS,
    extension_settings,
    q,
    sv,
    niEscAttr,
    niEscHtml,
    saveSettingsDebounced,
    refreshStatusbar: draft => {
        if (typeof niRefreshStorybarTheme === 'function') niRefreshStorybarTheme(draft);
    },
});

function niApplyCurrentTheme() {
    niThemeEditor.applyCurrentTheme();
}

function niSyncThemeUI() {
    niThemeEditor.syncUI();
}

// ============================================================
// 设置 Tab — 插件总开关
// ============================================================
function niSyncPluginToggleUI() {
    const cfg = extension_settings[EXT_NAME] || {};
    const enabled = cfg.pluginEnabled !== false;
    const chk = q('#ni-plugin-chk');
    const stateLabel = q('#ni-plugin-state');
    const hint = q('#ni-plugin-disabled-hint');
    const row = q('#ni-plugin-switch-row');
    if (chk) chk.checked = enabled;
    if (stateLabel) stateLabel.textContent = enabled ? '开' : '关';
    if (hint) hint.style.display = enabled ? 'none' : 'inline-flex';
    if (row) row.classList.toggle('ni-switch-off', !enabled);
    const autoSaveChk = q('#ni-autosave-chk');
    if (autoSaveChk) autoSaveChk.checked = cfg.autoSaveEnabled === true;
}

function niSyncTransBookToggleUI() {
    const cfg = extension_settings[EXT_NAME] || {};
    const enabled = !!cfg.transBookMode;
    const chk = q('#ni-tb-chk');
    const stateTxt = q('#ni-tb-state');
    if (chk) chk.checked = enabled;
    if (stateTxt) stateTxt.textContent = enabled ? '开' : '关';
}

function niSetTransBookMode(enabled) {
    const cfg = extension_settings[EXT_NAME];
    cfg.transBookMode = !!enabled;
    niSyncTransBookToggleUI();
    niUpdateStageInjectionBudgetNote();
    if (enabled) {
        setTimeout(() => { niTbLoadState(); niTbRenderStoryBar(); }, 0);
    } else {
        document.getElementById('ni-storybar')?.remove();
    }
    if (typeof window.niPopSyncVisibility === 'function') window.niPopSyncVisibility();
}

function niTogglePlugin() {
    const cfg = extension_settings[EXT_NAME];
    const chk = q('#ni-plugin-chk');
    const enabled = chk ? chk.checked : cfg.pluginEnabled === false;
    cfg.pluginEnabled = enabled;
    if (!enabled) {
        cfg.tbRestoreAfterPluginEnable = !!cfg.transBookMode;
        niSetTransBookMode(false);
    } else if (cfg.tbRestoreAfterPluginEnable) {
        niSetTransBookMode(true);
        cfg.tbRestoreAfterPluginEnable = false;
    }
    niSyncPluginToggleUI();
    niSaveSettings();
    niSyncRoleplayToDepth();
}
window.niTogglePlugin = niTogglePlugin;

// ============================================================
// 加料管道 P0 — 章节导入与管理
// ============================================================

function niEnrichCfg() {
    const base = { ...DEFAULT_SETTINGS.enrichImport };
    const saved = extension_settings[EXT_NAME]?.enrichImport;
    return saved && typeof saved === 'object' ? { ...base, ...saved } : base;
}

function niEnrichSaveCfg(patch) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg.enrichImport = { ...niEnrichCfg(), ...(patch || {}) };
    saveSettingsDebounced?.();
}

function niEnrichStatusBadge(ch) {
    const st = ch?.status || CHAPTER_STATUS.UNDETECTED;
    const label = CHAPTER_STATUS_LABELS[st] || st;
    // AI 判定原文无可加料内容 →「无加料」徽章
    if (ch?.enrich?.noContent) {
        return `<span class="ni-e-stat ni-es-s" title="AI 判定本章原文无可加料的亲密内容，未生成加料版；可点「重判」或手动标记后重新生成">无加料</span>`;
    }
    // 混合模式：关键词初筛标记的可疑章节（等待 AI 精判）
    if (st === CHAPTER_STATUS.JUDGED && ch?.judge?.hybridPending) {
        return `<span class="ni-e-stat ni-es-q" title="关键词部分命中，待 AI 精判">可疑</span>`;
    }
    // 场景引擎：安全否决（未成年/非自愿/多人男/排除名单等），不可自动加料
    if (st === CHAPTER_STATUS.JUDGED && ch?.judge?.result === 'vetoed') {
        const reasons = (ch.judge.safety?.vetoReasons || []).join('；');
        return `<span class="ni-e-stat ni-es-e" title="安全否决：${niEscAttr(reasons || ch.judge.evidence || '')}。不可自动加料，可在详情中人工标记后处理">安全否决</span>`;
    }
    let cls = 'ni-es-w';
    if (st === CHAPTER_STATUS.DETECTING || st === CHAPTER_STATUS.ENRICHING) cls = 'ni-es-r';
    else if (st === CHAPTER_STATUS.JUDGED || st === CHAPTER_STATUS.ENRICHED) cls = 'ni-es-d';
    else if (st === CHAPTER_STATUS.FAILED) cls = 'ni-es-e';
    else if (st === CHAPTER_STATUS.SKIPPED) cls = 'ni-es-s';
    else if (st === CHAPTER_STATUS.MODIFIED) cls = 'ni-es-m';
    const flagText = ch?.flag === 'pass' ? ' · 通过'
        : ch?.flag === 'fail' ? ' · 不通过'
        : ch?.flag === 'doubt' ? ' · 存疑' : '';
    return `<span class="ni-e-stat ${cls}">${label}${flagText}</span>`;
}

function niEnrichRenderList() {
    const list = q('#ni-e-list');
    if (!list) return;
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const kept = chapters.filter(ch => !ch.filtered);
    const totalEl = q('#ni-est-total');
    if (totalEl) totalEl.textContent = String(chapters.length);
    const keptEl = q('#ni-est-kept');
    if (keptEl) keptEl.textContent = String(kept.length);
    const note = q('#ni-e-filter-note');
    if (note) {
        note.textContent = S.enrichReport?.filteredCount
            ? `已导入 ${S.enrichReport.keptCount} / 过滤 ${S.enrichReport.filteredCount} 个短章节`
            : chapters.length ? `全部 ${chapters.length} 章通过长度检查` : '';
    }
    if (!chapters.length) {
        list.innerHTML = '<div class="ni-empty"><i class="ti ti-book-off"></i>请先导入小说</div>';
        return;
    }
    if (!kept.length) {
        list.innerHTML = '<div class="ni-empty"><i class="ti ti-book-off"></i>所有章节均短于阈值，可在「导入报告」恢复，或调低阈值后「重新过滤」</div>';
        return;
    }
    list.innerHTML = kept.map(ch => {
        const checked = S.enrichSelected?.has(ch.id) ? ' checked' : '';
        return `<div class="ni-e-row${checked ? ' sel' : ''}" data-id="${niEscAttr(ch.id)}">
            <input type="checkbox" class="ni-e-chk" data-id="${niEscAttr(ch.id)}"${checked}>
            <span class="ni-e-title" data-id="${niEscAttr(ch.id)}" title="点击查看/编辑">${niEscHtml(ch.title)}</span>
            <span class="ni-e-meta">${ch.charCount} 字</span>
            ${niEnrichStatusBadge(ch)}
            <span class="ni-e-acts">
              <button class="ni-e-act" data-act="view" data-id="${niEscAttr(ch.id)}" title="查看/编辑">✎</button>
              ${niEnrichJudgeAction(ch)}
              ${niEnrichRowAction(ch)}
              <button class="ni-e-act danger" data-act="del" data-id="${niEscAttr(ch.id)}" title="删除本章">✕</button>
            </span>
        </div>`;
    }).join('');
}

function niEnrichCanJudge(ch) {
    return !!ch && !ch.filtered && [
        CHAPTER_STATUS.UNDETECTED, CHAPTER_STATUS.FAILED, CHAPTER_STATUS.SKIPPED,
    ].includes(ch.status);
}

/** 行内判定/重判按钮：未判定 →「判」；已判定/失败/跳过/已修改 →「重判」（覆盖原结果）。 */
function niEnrichJudgeAction(ch) {
    if (!ch || ch.filtered) return '';
    if ([CHAPTER_STATUS.DETECTING, CHAPTER_STATUS.ENRICHING].includes(ch.status)) return '';
    if (ch.status === CHAPTER_STATUS.UNDETECTED) {
        return `<button class="ni-e-act" data-act="judge" data-id="${niEscAttr(ch.id)}" title="判定本章">判</button>`;
    }
    return `<button class="ni-e-act" data-act="rejudge" data-id="${niEscAttr(ch.id)}" title="重新判定本章（覆盖原结果）">重判</button>`;
}

/** 重置章节到未判定（供重新判定使用）。 */
function niEnrichResetForRejudge(ch) {
    if (!ch) return;
    ch.judge = null;
    ch.enrich = null;
    ch.error = '';
    ch.status = CHAPTER_STATUS.UNDETECTED;
}

/** 行内加料按钮：有资格且未加料的章节显示「加」。 */
function niEnrichRowAction(ch) {
    if (!ch || ch.filtered) return '';
    if (ch.status === CHAPTER_STATUS.ENRICHING) return '';
    if (canEnrichChapter(ch) && !ch.enrich) {
        return `<button class="ni-e-act" data-act="enrich" data-id="${niEscAttr(ch.id)}" title="AI 加料本章">加</button>`;
    }
    return '';
}

function niEnrichToggleSelect(id, on) {
    if (!S.enrichSelected) S.enrichSelected = new Set();
    if (on) S.enrichSelected.add(id); else S.enrichSelected.delete(id);
    const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
    const row = q(`.ni-e-row[data-id="${safe}"]`);
    if (row) row.classList.toggle('sel', on);
}

function niEnrichSelectAll() {
    if (!Array.isArray(S.enrichChapters)) return;
    S.enrichSelected = new Set(S.enrichChapters.filter(ch => !ch.filtered).map(ch => ch.id));
    niEnrichRenderList();
}

function niEnrichSelectInvert() {
    if (!Array.isArray(S.enrichChapters)) return;
    const keptIds = S.enrichChapters.filter(ch => !ch.filtered).map(ch => ch.id);
    const cur = S.enrichSelected || new Set();
    S.enrichSelected = new Set(keptIds.filter(id => !cur.has(id)));
    niEnrichRenderList();
}

function niEnrichMergeSelected() {
    if (!S.enrichSelected?.size) { toastr?.warning('请先勾选要合并的章节'); return; }
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const indices = [...S.enrichSelected]
        .map(id => chapters.findIndex(ch => ch.id === id))
        .filter(i => i >= 0);
    if (indices.length < 2) { toastr?.warning('至少勾选 2 个章节才能合并'); return; }
    if (mergeChapters(chapters, indices)) {
        S.enrichSelected = new Set();
        S.enrichReport = buildChapterImportReport(chapters, niEnrichCfg().threshold);
        niEnrichRenderList();
        toastr?.success('章节已合并');
        niEnrichScheduleSave();
    }
}

function niEnrichDeleteSelected() {
    if (!S.enrichSelected?.size) { toastr?.warning('请先勾选要删除的章节'); return; }
    if (!confirm(`确定删除选中的 ${S.enrichSelected.size} 个章节？此操作不可撤销。`)) return;
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const indices = [...S.enrichSelected]
        .map(id => chapters.findIndex(ch => ch.id === id))
        .filter(i => i >= 0);
    deleteChapters(chapters, indices);
    S.enrichSelected = new Set();
    S.enrichReport = buildChapterImportReport(chapters, niEnrichCfg().threshold);
    niEnrichRenderList();
    toastr?.success('已删除选中章节');
    niEnrichScheduleSave();
}

// —— 章节详情/编辑弹窗 ——
let _niEnrichDetailId = null;

/** 详情弹窗加料状态文案（无加料/已生成+字数+回填段数+合并状态）。 */
function niEnrichStateText(ch) {
    if (ch?.enrich?.noContent) return '无加料（AI 判定原文无可加料内容，已保留原文）';
    if (!ch?.enrich) return '未加料';
    const minChars = Math.max(0, Number(niEnrichParams().minChars) || ENRICH_MIN_CHARS);
    const base = ch.enrich.reviewed === false ? '需人工审核' : `已生成（${enrichIntensityLabel(ch.enrich.intensity)}）`;
    const lenPart = typeof ch.enrich.charCount === 'number' ? ` · ${ch.enrich.charCount} 字` : '';
    const shortPart = ch.enrich.short ? ` · 不足最低 ${minChars} 字` : '';
    const segPart = Array.isArray(ch.enrich.segments) && ch.enrich.segments.length ? ` · 已回填 ${ch.enrich.segments.length} 段` : '';
    const mergePart = ch.enrich.merge === 'ok' ? ''
        : ch.enrich.merge === 'partial' ? ' · 部分段落需人工调整'
        : ch.enrich.merge === 'manual' ? ' · 未定位锚点已兜底插入，需人工检查'
        : '';
    return base + lenPart + shortPart + segPart + mergePart;
}

/** 详情弹窗：AI 生成加料（流式实时追加；由全局动作分发调用，避免依赖 $app 委托）。 */
async function niEnrichDetailGenerate(btn) {
    if (!_niEnrichDetailId) return;
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const ch = chapters.find(c => c.id === _niEnrichDetailId);
    if (!ch || !canEnrichChapter(ch)) { toastr?.warning('本章无加料资格（需判定为「是/存疑」或标记「通过」）'); return; }
    const stopBtn = q('#ni-e-detail-enrich-stop');
    const ta = q('#ni-e-detail-enrich');
    const stateEl = q('#ni-e-detail-enrich-state');
    const controller = new AbortController();
    _niEnrichDetailController = controller;
    if (btn) btn.disabled = true;
    if (stopBtn) stopBtn.style.display = '';
    if (ta) ta.value = '';
    if (stateEl) stateEl.textContent = '生成中…';
    try {
        const result = await enrichChapter(ch, chapters.indexOf(ch), {
            signal: controller.signal,
            onDelta: delta => {
                if (ta) {
                    ta.value += delta;
                    ta.scrollTop = ta.scrollHeight;
                }
            },
        });
        if (result?.noContent) toastr?.info('本章无可加料内容，已跳过（保留原文）');
        else if (result?.underMin) toastr?.warning(`加料字数不足 ${Math.max(0, Number(niEnrichParams().minChars) || ENRICH_MIN_CHARS)} 字（实际 ${result.charCount} 字），已按强制字数要求标记失败；可点「重试失败」重新生成或在详情中手动补写`);
        else if (result?.short) toastr?.warning(`加料完成，但仅 ${result.charCount} 字（要求 ≥${Math.max(0, Number(niEnrichParams().minChars) || ENRICH_MIN_CHARS)} 字），建议重新生成`);
        else toastr?.success(result.reviewed ? '加料完成' : '加料完成，但内容含敏感词，请人工审核');
    } catch (err) {
        if (err?.message !== 'AbortError') toastr?.error(`加料失败：${err?.message || err}`);
    } finally {
        if (btn) btn.disabled = false;
        if (stopBtn) stopBtn.style.display = 'none';
        _niEnrichDetailController = null;
        if (stateEl && ch.enrich) {
            if (ch.enrich.noContent) {
                stateEl.textContent = '无加料（AI 判定原文无可加料内容，已保留原文）';
                if (ta) ta.value = '';
            } else {
                if (ta) ta.value = ch.enrich.text || '';
                stateEl.textContent = niEnrichStateText(ch);
            }
        }
        niEnrichRenderList();
        niEnrichRenderStats();
        niEnrichSyncButtons(false);
    }
}

function niEnrichOpenDetail(id) {
    const ch = (Array.isArray(S.enrichChapters) ? S.enrichChapters : []).find(c => c.id === id);
    if (!ch) return;
    _niEnrichDetailId = id;
    const titleEl = q('#ni-e-detail-title');
    if (titleEl) titleEl.textContent = `章节 ${ch.index}：${ch.title}`;
    sv('#ni-e-detail-title-inp', ch.title);
    const textEl = q('#ni-e-detail-text');
    if (textEl) textEl.value = ch.text;
    const countEl = q('#ni-e-detail-count');
    if (countEl) countEl.textContent = String(ch.charCount);
    // 判定结果单选（默认「保持」）
    const judgeRow = q('#ni-e-detail-judge-row');
    if (judgeRow) {
        judgeRow.querySelectorAll('input').forEach(inp => { inp.checked = false; });
        const cur = ch.judge?.result;
        const target = cur && judgeRow.querySelector(`input[value="${cur}"]`);
        (target || judgeRow.querySelector('input[value=""]'))?.setAttribute('checked', '');
    }
    // 人工标记单选
    const flagRow = q('#ni-e-detail-flag-row');
    if (flagRow) {
        flagRow.querySelectorAll('input').forEach(inp => { inp.checked = false; });
        const target = flagRow.querySelector(`input[value="${ch.flag || ''}"]`);
        if (target) target.setAttribute('checked', '');
    }
    // 判定信息展示（含失败原因）
    const evEl = q('#ni-e-detail-evidence');
    if (evEl) {
        if (ch.judge) {
            evEl.style.display = '';
            const modeText = ch.judge.mode === 'ai' ? 'AI 分析'
                : ch.judge.mode === 'batch' ? '批量场景扫描'
                : ch.judge.mode === 'manual' ? '手动标记'
                : '场景引擎';
            const vetoHint = ch.judge.result === 'vetoed'
                ? '\n安全否决：该章不可自动加料。可在下方人工标记后手动处理。'
                : '';
            evEl.textContent = `当前判定：${judgeResultLabel(ch.judge.result)} · 置信度 ${ch.judge.confidence ?? '-'}（${modeText}）\n依据：${ch.judge.evidence || '—'}${vetoHint}`;
        } else if (ch.error) {
            evEl.style.display = '';
            evEl.textContent = `上次处理失败：${ch.error}\n可在列表中点「重判」或工具栏「重判失败」重试（AI 返回被截断时会自动放大输出上限重试）。`;
        } else {
            evEl.style.display = 'none';
        }
    }
    // 加料结果区
    const enrichTa = q('#ni-e-detail-enrich');
    if (enrichTa) enrichTa.value = ch.enrich?.text || '';
    const enrichState = q('#ni-e-detail-enrich-state');
    if (enrichState) enrichState.textContent = niEnrichStateText(ch);
    const genBtn = q('#ni-e-detail-enrich-btn');
    if (genBtn) {
        genBtn.textContent = ch.enrich ? '重新生成' : '生成加料';
        genBtn.disabled = false;
    }
    const stopBtn = q('#ni-e-detail-enrich-stop');
    if (stopBtn) stopBtn.style.display = 'none';
    q('#ni-e-detail-modal').style.display = 'flex';
}

function niEnrichCloseDetail() {
    q('#ni-e-detail-modal').style.display = 'none';
    _niEnrichDetailId = null;
}

/** 手动保存加料结果时把章节状态推进到 ENRICHED / MODIFIED（走合法转移链）。 */
function niEnrichMarkManual(ch) {
    if (!ch) return;
    if (ch.status === CHAPTER_STATUS.ENRICHED) {
        transitionChapter(ch, CHAPTER_STATUS.MODIFIED);
    } else {
        if (ch.status !== CHAPTER_STATUS.ENRICHING && !transitionChapter(ch, CHAPTER_STATUS.ENRICHING)) {
            ch.status = CHAPTER_STATUS.ENRICHING;
        }
        transitionChapter(ch, CHAPTER_STATUS.ENRICHED);
    }
}

function niEnrichSaveDetail() {
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const idx = chapters.findIndex(c => c.id === _niEnrichDetailId);
    const ch = chapters[idx];
    if (!ch) { niEnrichCloseDetail(); return; }
    const title = String(q('#ni-e-detail-title-inp')?.value || '').trim();
    const text = String(q('#ni-e-detail-text')?.value || '');
    if (title && title !== ch.title) ch.title = title;
    if (text !== ch.text) {
        ch.text = text;
        ch.charCount = text.length;
        // 手动改过正文 → 原判定/加料结果作废，需要重新处理
        ch.status = CHAPTER_STATUS.UNDETECTED;
        ch.judge = null;
        ch.enrich = null;
        ch.flag = '';
    }
    // 判定结果（手动修改，选中「保持」则不动）
    const judgeChecked = q('#ni-e-detail-judge-row input:checked')?.value;
    if (judgeChecked !== undefined && judgeChecked !== '') {
        const cur = ch.judge?.result;
        if (cur !== judgeChecked) {
            ch.judge = {
                ...(ch.judge || {}),
                result: judgeChecked,
                confidence: ch.judge?.confidence ?? 0,
                evidence: ch.judge?.evidence || '手动标记',
                mode: 'manual',
                at: Date.now(),
            };
            if ([CHAPTER_STATUS.UNDETECTED, CHAPTER_STATUS.FAILED, CHAPTER_STATUS.SKIPPED].includes(ch.status)) {
                transitionChapter(ch, CHAPTER_STATUS.JUDGED);
            }
        }
    }
    // 人工标记（影响加料资格）
    const flagChecked = q('#ni-e-detail-flag-row input:checked')?.value ?? '';
    if (flagChecked !== ch.flag) ch.flag = flagChecked;
    // 加料结果（手动编辑或粘贴）
    const enrichTa = q('#ni-e-detail-enrich');
    if (enrichTa) {
        const enrichText = enrichTa.value;
        if (enrichText && enrichText !== (ch.enrich?.text || '')) {
            ch.enrich = {
                ...(ch.enrich || {}),
                text: enrichText,
                at: Date.now(),
                reviewed: ch.enrich?.reviewed !== false,
                manual: true,
            };
            niEnrichMarkManual(ch);
        }
    }
    niEnrichCloseDetail();
    niEnrichRenderList();
    toastr?.success('章节已保存');
    niEnrichScheduleSave();
}

function niEnrichSplitDetail() {
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const idx = chapters.findIndex(c => c.id === _niEnrichDetailId);
    const ch = chapters[idx];
    if (!ch) return;
    const ta = q('#ni-e-detail-text');
    const at = ta && ta.selectionStart != null ? ta.selectionStart : Math.floor(ch.text.length / 2);
    if (splitChapter(chapters, idx, at)) {
        niEnrichCloseDetail();
        niEnrichRenderList();
        toastr?.success('章节已拆分');
        niEnrichScheduleSave();
    } else {
        toastr?.warning('拆分位置无效：需把光标放在正文中间（不能在开头或结尾）');
    }
}

// —— 短章节过滤与导入报告 ——
function niEnrichRefilter() {
    if (!Array.isArray(S.enrichChapters) || !S.enrichChapters.length) return;
    const cfg = niEnrichCfg();
    S.enrichReport = applyChapterFilter(S.enrichChapters, cfg.threshold, cfg.filterEnabled !== false);
    niEnrichRenderList();
    if (S.enrichReport.allFiltered) toastr?.warning('没有符合长度阈值的章节，请调低阈值或关闭过滤');
    else if (S.enrichReport.filteredCount) toastr?.info(`已过滤 ${S.enrichReport.filteredCount} 个短章节`);
    niEnrichScheduleSave();
}

function niEnrichRenderReport() {
    const body = q('#ni-e-report-body');
    if (!body) return;
    const restoreBtn = q('#ni-e-report-restore');
    const report = S.enrichReport;
    if (!report || !report.filteredCount) {
        body.innerHTML = '<div class="ni-e-report-empty">所有章节均符合长度要求，无过滤。</div>';
        if (restoreBtn) restoreBtn.style.display = 'none';
        return;
    }
    if (restoreBtn) restoreBtn.style.display = '';
    body.innerHTML = report.filtered.map((f, i) => `
        <div class="ni-e-report-row">
            <input type="checkbox" class="ni-e-chk" data-fid="${i}" checked>
            <span class="ni-e-title" style="cursor:default" title="${niEscAttr(f.title)}">${niEscHtml(f.title)}</span>
            <span class="ni-e-meta">${f.charCount} 字</span>
            <span class="ni-e-meta">${niEscHtml(f.reason)}</span>
        </div>`).join('');
}

function niEnrichRestoreFiltered() {
    const report = S.enrichReport;
    if (!report) return;
    const body = q('#ni-e-report-body');
    if (!body) return;
    const ids = [];
    body.querySelectorAll('.ni-e-report-row input:checked').forEach(cb => {
        const f = report.filtered[Number(cb.dataset.fid)];
        if (f?.id) ids.push(f.id);
    });
    if (!ids.length) { toastr?.warning('请先勾选要恢复的章节'); return; }
    const set = new Set(ids);
    (Array.isArray(S.enrichChapters) ? S.enrichChapters : []).forEach(ch => {
        if (set.has(ch.id)) {
            ch.filtered = false;
            ch.status = CHAPTER_STATUS.UNDETECTED;
        }
    });
    S.enrichReport = buildChapterImportReport(S.enrichChapters, niEnrichCfg().threshold);
    niEnrichRenderList();
    niEnrichRenderReport();
    toastr?.success(`已恢复 ${ids.length} 个章节`);
    niEnrichScheduleSave();
}

// —— 导入入口 ——
async function niEnrichApplyFile(file) {
    const reader = new FileReader();
    reader.onload = async ev => {
        try {
            const buf = ev.target.result;
            const fingerprint = await niFingerprintArrayBuffer(buf);
            const ext = niEnrichSupportedExt(file?.name || '');
            if (!ext) throw new Error('仅支持 .txt / .epub / .md 文件');

            let text;
            let boundaries = null;
            if (ext === '.epub') {
                const epub = niExtractEpubText(buf);
                text = epub.text;
                boundaries = epub.boundaries;
            } else {
                const encoding = detectEncoding(buf);
                text = new TextDecoder(encoding).decode(buf);
            }
            if (!text.trim()) throw new Error('文件内容为空');

            const cfg = niEnrichCfg();
            const chapters = recognizeChapters(text, {
                patterns: DEFAULT_CHAPTER_PATTERNS,
                customPatterns: cfg.customPatterns || [],
                boundaries,
            });
            S.enrichReport = applyChapterFilter(chapters, cfg.threshold, cfg.filterEnabled !== false);
            S.enrichChapters = chapters;
            S.enrichFileMeta = { name: file.name, size: file.size, fingerprint, importedAt: Date.now() };
            S.enrichSelected = new Set();

            // UI 反馈
            q('#ni-euz')?.classList.add('loaded');
            const labelEl = q('#ni-eu-label');
            if (labelEl) labelEl.textContent = file.name;
            const hintEl = q('#ni-eu-hint');
            if (hintEl) hintEl.textContent = `${Math.round(file.size / 1024)} KB · 共 ${chapters.length} 章（阈值 ${cfg.threshold} 字）`;
            const okEl = q('#ni-eu-ok');
            if (okEl) okEl.style.display = 'flex';
            const fnameEl = q('#ni-eu-fname');
            if (fnameEl) fnameEl.textContent = `${file.name} 已导入`;
            const infoEl = q('#ni-eimp-info');
            if (infoEl) infoEl.style.display = 'block';
            const sizeEl = q('#ni-est-size');
            if (sizeEl) sizeEl.textContent = `${Math.round(file.size / 1024)} KB`;
            niEnrichRenderList();

            if (S.enrichReport.allFiltered) toastr?.warning('没有符合长度阈值的章节，请调整阈值后点「重新过滤」，或临时关闭过滤');
            else if (S.enrichReport.filteredCount > 0) toastr?.info(`已过滤 ${S.enrichReport.filteredCount} 个短章节，可在「导入报告」查看或恢复`);
            else toastr?.success(`成功导入 ${S.enrichReport.keptCount} 个章节`);

            // 最近导入历史（设置中保留 8 条）
            const settings = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
            const history = Array.isArray(settings.enrichHistory) ? settings.enrichHistory : [];
            const entry = { name: file.name, size: file.size, fingerprint, importedAt: Date.now(), chapterCount: chapters.length };
            settings.enrichHistory = [entry, ...history.filter(h => h?.fingerprint !== fingerprint)].slice(0, 8);
            saveSettingsDebounced?.();
            niEnrichRenderHistory();
            // 导出默认书名 = 导入文件名
            const expTitleEl = q('#ni-e-exp-title');
            if (expTitleEl) expTitleEl.value = file.name.replace(/\.(txt|md|markdown|epub)$/i, '');
            niEnrichScheduleSave({ immediate: true });
        } catch (e) {
            console.error('[NI] 章节导入失败:', e);
            alert(`章节导入失败：${e.message || e}`);
        }
    };
    reader.onerror = () => alert('读取文件失败，请重新选择文件。');
    reader.readAsArrayBuffer(file);
}

function niEnrichRenderHistory() {
    const el = q('#ni-e-history');
    if (!el) return;
    const history = extension_settings[EXT_NAME]?.enrichHistory || [];
    if (!history.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = '<div class="ni-desc" style="margin:8px 0 4px">最近导入（↻ 重新选择该文件导入）</div>' +
        history.map((h, i) => `
        <div class="ni-e-hrow">
            <span class="ni-e-title" style="cursor:default" title="${niEscAttr(h.name)}">${niEscHtml(h.name)}</span>
            <span class="ni-e-meta">${h.chapterCount ?? '?'} 章 · ${new Date(h.importedAt).toLocaleString()}</span>
            <button class="ni-e-act" data-hist="${i}" title="重新导入该文件">↻</button>
        </div>`).join('');
}

// ============================================================
// 加料管道 P1 — 通用队列注册、章节持久化、快捷键
// ============================================================

// 判定/加料队列实例占位（P2/P3 通过 niSetBatchQueues 注册）
let niJudgeQueue = null;
let niEnrichQueue = null;

function niSetBatchQueues({ judge = null, enrich = null } = {}) {
    if (judge) niJudgeQueue = judge;
    if (enrich) niEnrichQueue = enrich;
}
window.niSetBatchQueues = niSetBatchQueues;

// —— 章节持久化（服务端重文件 *_chapters.json）——
let _niEnrichSaveQueue = Promise.resolve();
let _niEnrichSaveTimer = null;

function niEnrichHeavyFileKey() {
    const fp = S.enrichFileMeta?.fingerprint;
    return fp ? `enrich_${String(fp).slice(0, 12)}` : '';
}

function niEnrichScheduleSave({ immediate = false } = {}) {
    if (!Array.isArray(S.enrichChapters) || !S.enrichChapters.length) return;
    if (_niEnrichSaveTimer) { clearTimeout(_niEnrichSaveTimer); _niEnrichSaveTimer = null; }
    if (immediate) { void niEnrichSaveChapters(); return; }
    _niEnrichSaveTimer = setTimeout(() => {
        _niEnrichSaveTimer = null;
        void niEnrichSaveChapters();
    }, 800);
}

async function niEnrichSaveChapters() {
    const fileKey = niEnrichHeavyFileKey();
    if (!fileKey || !Array.isArray(S.enrichChapters) || !S.enrichChapters.length) return false;
    const payload = {
        version: 1,
        part: 'chapters',
        novelKey: S.enrichFileMeta?.fingerprint || '',
        savedAt: new Date().toISOString(),
        fileMeta: {
            name: S.enrichFileMeta?.name || '',
            size: S.enrichFileMeta?.size || 0,
            fingerprint: S.enrichFileMeta?.fingerprint || '',
            importedAt: S.enrichFileMeta?.importedAt || Date.now(),
        },
        chapters: S.enrichChapters.map(ch => ({
            id: ch.id, index: ch.index, title: ch.title, pattern: ch.pattern || '',
            text: ch.text || '', charCount: Number(ch.charCount) || 0,
            status: ch.status || CHAPTER_STATUS.UNDETECTED,
            flag: ch.flag || '', filtered: !!ch.filtered,
            judge: ch.judge || null, enrich: ch.enrich || null,
            error: ch.error || '',
        })),
    };
    const settings = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    if (settings._enrichFileKey !== fileKey) {
        settings._enrichFileKey = fileKey;
        saveSettingsDebounced?.();
    }
    _niEnrichSaveQueue = _niEnrichSaveQueue.catch(() => {}).then(() =>
        niServerUploadJson(niHeavyPartFileName(fileKey, 'chapters'), payload),
    );
    try {
        await _niEnrichSaveQueue;
        return true;
    } catch (e) {
        console.warn('[NI] 章节数据保存失败:', e);
        return false;
    }
}

function niEnrichNormalizeChapter(ch) {
    return {
        id: ch?.id || '', index: Number(ch?.index) || 0,
        title: ch?.title || '', pattern: ch?.pattern || '',
        text: ch?.text || '', charCount: Number(ch?.charCount) || 0,
        status: ch?.status || CHAPTER_STATUS.UNDETECTED,
        flag: ch?.flag || '', filtered: !!ch?.filtered,
        judge: ch?.judge || null, enrich: ch?.enrich || null,
        error: ch?.error || '',
    };
}

async function niEnrichTryRestore() {
    const fileKey = extension_settings[EXT_NAME]?._enrichFileKey;
    if (!fileKey || (Array.isArray(S.enrichChapters) && S.enrichChapters.length)) return false;
    try {
        const stored = await niServerLoadJsonByNames([niHeavyPartFileName(fileKey, 'chapters')]);
        // 等待期间用户可能已导入新文件
        if (S.enrichFileMeta || (Array.isArray(S.enrichChapters) && S.enrichChapters.length)) return false;
        if (!stored?.payload || !Array.isArray(stored.payload.chapters) || !stored.payload.chapters.length) return false;
        S.enrichChapters = stored.payload.chapters.map(niEnrichNormalizeChapter);
        S.enrichFileMeta = {
            name: stored.payload.fileMeta?.name || '恢复的小说',
            size: stored.payload.fileMeta?.size || 0,
            fingerprint: stored.payload.fileMeta?.fingerprint || stored.payload.novelKey || '',
            importedAt: stored.payload.fileMeta?.importedAt || Date.now(),
        };
        S.enrichSelected = new Set();
        S.enrichReport = applyChapterFilter(S.enrichChapters, niEnrichCfg().threshold, niEnrichCfg().filterEnabled !== false);
        q('#ni-euz')?.classList.add('loaded');
        const labelEl = q('#ni-eu-label');
        if (labelEl) labelEl.textContent = S.enrichFileMeta.name;
        const hintEl = q('#ni-eu-hint');
        if (hintEl) hintEl.textContent = `已从本地恢复上次导入 · 共 ${S.enrichChapters.length} 章`;
        const okEl = q('#ni-eu-ok');
        if (okEl) okEl.style.display = 'flex';
        const fnameEl = q('#ni-eu-fname');
        if (fnameEl) fnameEl.textContent = `${S.enrichFileMeta.name} 已恢复`;
        const infoEl = q('#ni-eimp-info');
        if (infoEl) infoEl.style.display = 'block';
        const sizeEl = q('#ni-est-size');
        if (sizeEl) sizeEl.textContent = S.enrichFileMeta.size ? `${Math.round(S.enrichFileMeta.size / 1024)} KB` : '—';
        niEnrichRenderList();
        toastr?.info(`已恢复上次导入：${S.enrichFileMeta.name}（${S.enrichChapters.length} 章）`);
        return true;
    } catch (e) {
        console.warn('[NI] 恢复章节数据失败:', e);
        return false;
    }
}

// —— 快捷键（Space/S/Esc 仅队列运行中生效；Ctrl+I 导入；Ctrl+E 导出待 P4）——
function niEnrichOnKeyDown(e) {
    if (extension_settings[EXT_NAME]?.enrichShortcutsEnabled === false) return;
    const target = e.target;
    const tag = target?.tagName?.toLowerCase?.();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

    const runningJudge = niJudgeQueue?.isRunning?.();
    const runningEnrich = niEnrichQueue?.isRunning?.();
    const queueRunning = runningJudge || runningEnrich;

    if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) {
        const drawerOpen = !!document.querySelector('#ni_drawer_content.openDrawer');
        if (drawerOpen) {
            e.preventDefault();
            q('#ni-e-fi')?.click();
        }
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        niEnrichExport();
        return;
    }
    if (!queueRunning) return;

    if (e.code === 'Space') {
        e.preventDefault();
        if (runningJudge) niJudgeQueue.pause();
        else if (runningEnrich) niEnrichQueue.pause();
        else (niJudgeQueue || niEnrichQueue)?.run?.();
    } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        (runningJudge ? niJudgeQueue : niEnrichQueue)?.skipCurrent?.();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        (runningJudge ? niJudgeQueue : niEnrichQueue)?.cancelAll?.();
    }
}

// ============================================================
// 加料管道 P2 — 亲密行为判定
// ============================================================

// 判定 API 客户端（独立档位，走酒馆反代）
const { callProfileApi: niJudgeCall } = createProfileApiClient({
    getProfile: () => niJudgeApiCfg(),
    acquireRateSlot: niAcquireJudgeRateSlot,
    runWithSemaphore,
    semaphore: JudgeSemaphore,
    readChatCompletionStream: niReadChatCompletionStream,
    hasLengthFinishReason: niHasLengthFinishReason,
    extractChatCompletionText: niExtractChatCompletionText,
    getRequestHeaders,
    fetch,
});

function niJudgeRules() {
    const base = {
        ...DEFAULT_JUDGE_RULES,
        keywords: (DEFAULT_JUDGE_RULES.keywords || []).map(k => ({ ...k })),
        regexes: (DEFAULT_JUDGE_RULES.regexes || []).map(r => ({ ...r })),
    };
    const saved = extension_settings[EXT_NAME]?.judgeRules;
    if (!saved || typeof saved !== 'object') return base;
    return {
        ...base,
        ...saved,
        keywords: Array.isArray(saved.keywords) ? saved.keywords.map(k => ({ ...k })) : base.keywords,
        regexes: Array.isArray(saved.regexes) ? saved.regexes.map(r => ({ ...r })) : base.regexes,
    };
}

function niJudgeSaveRules(patch) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg.judgeRules = { ...niJudgeRules(), ...(patch || {}) };
    saveSettingsDebounced?.();
}

function niJudgeApiCfg() {
    const base = { ...DEFAULT_SETTINGS.judgeApi };
    const saved = extension_settings[EXT_NAME]?.judgeApi;
    const cfg = saved && typeof saved === 'object' ? { ...base, ...saved } : base;
    // 判定 API 语义 = 独立配置（自带 url/key/model，无「预设/独立」双勾选 UI）：
    // 显式补 useIndependentApi，否则 callProfileApi 会把判定请求当成「两个 API 来源都没选」而拒绝。
    cfg.useIndependentApi = saved?.useIndependentApi ?? true;
    return cfg;
}

function niJudgeSaveApi(patch) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg.judgeApi = { ...niJudgeApiCfg(), ...(patch || {}) };
    saveSettingsDebounced?.();
}

// —— 场景引擎配置与全书级缓存（判定逻辑移植自 Auto Scene 3.5 纯加料器.py）——

/** 场景引擎配置（深拷贝合并，读取走此函数，勿直接改设置对象）。 */
function niSceneConfig() {
    const base = {
        ...DEFAULT_SCENE_CONFIG,
        female_names: [...(DEFAULT_SCENE_CONFIG.female_names || [])],
        excluded_names: [...(DEFAULT_SCENE_CONFIG.excluded_names || [])],
        adult_female_allowlist: [...(DEFAULT_SCENE_CONFIG.adult_female_allowlist || [])],
        allowed_chapter_ranges: [...(DEFAULT_SCENE_CONFIG.allowed_chapter_ranges || [])],
        aliases: { ...(DEFAULT_SCENE_CONFIG.aliases || {}) },
    };
    const saved = extension_settings[EXT_NAME]?.sceneConfig;
    return saved && typeof saved === 'object' ? { ...base, ...saved } : base;
}

let _niBookProfileCache = null;
let _niBookProfileSig = '';
/** 全书 R18 画像（high_r18/normal），按章节数量+字数签名缓存，章节内容变化自动失效。 */
function niGetBookProfile() {
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const sig = `${chapters.length}|${chapters.map(c => c?.charCount || 0).join(',')}`;
    if (_niBookProfileSig === sig && _niBookProfileCache) return _niBookProfileCache;
    _niBookProfileCache = detectBookProfile(chapters.map(c => c?.text || ''), niSceneConfig());
    _niBookProfileSig = sig;
    return _niBookProfileCache;
}

let _niAutoNamesCache = null;
let _niAutoNamesSig = '';
/** 全书自动女主名单（供窗口模式识别），按同样签名缓存。 */
function niGetAutoNames() {
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const sig = `${chapters.length}|${chapters.map(c => c?.charCount || 0).join(',')}`;
    if (_niAutoNamesSig === sig && _niAutoNamesCache) return _niAutoNamesCache;
    const cfg = niSceneConfig();
    _niAutoNamesCache = cfg.auto_extract_female_names === false
        ? []
        : buildAutoFemaleNames(chapters.map(c => c?.text || '').join('\n'), cfg);
    _niAutoNamesSig = sig;
    return _niAutoNamesCache;
}

/** 关键词模式场景评分（带全书画像/配置/自动名单上下文）。 */
function niScoreChapter(ch) {
    return scoreIntimacy(ch?.text || '', niJudgeRules(), {
        sceneConfig: niSceneConfig(),
        bookProfile: niGetBookProfile().profile,
        chapterNumber: ch?.index || 0,
        autoNames: niGetAutoNames(),
    });
}

/** 判定 API 调用（含截断放大重试）；供逐章 AI 判定与批量场景扫描共用。 */
async function niJudgeCallRetry(messages, api, signal, { baseLength = 800 } = {}) {
    const retries = Math.max(0, Number(api.retries) || 0);
    let truncatedCount = 0;
    let raw = '';
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw new Error('AbortError');
        try {
            raw = await niJudgeCall(messages, { responseLength: judgeResponseLength(truncatedCount, baseLength), signal });
            return raw;
        } catch (err) {
            if (signal?.aborted || err?.message === 'AbortError') throw err;
            lastErr = err;
            if (isTruncatedError(err)) {
                truncatedCount++;
                console.warn(`[NI] 判定返回被长度截断（第 ${attempt + 1} 次），已放大输出上限到 ${judgeResponseLength(truncatedCount, baseLength)} tokens`);
            }
            if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
    }
    throw lastErr || new Error('判定 API 无返回内容');
}

/** AI 深度判定单个章节（含截断放大重试）；供纯 AI 模式与混合模式的精判阶段使用。
 *  opts.sceneHint：关键词初筛的场景窗口明细（混合模式自动精判时传入，此时 ch.judge 尚未落库）；
 *  精判阶段（ch.judge 已有初筛结果）自动读取 ch.judge.scenes。
 */
async function aiJudgeChapter(ch, rules, signal, opts = {}) {
    const api = niJudgeApiCfg();
    if (!api.url || !api.model) throw new Error('请先在「判定设置」中填写 AI 模式需要的接口地址与模型');
    const template = extension_settings[EXT_NAME]?.judgePrompts?.template || DEFAULT_JUDGE_PROMPT;
    let rulesSummary = buildJudgeRulesSummary(rules);
    // 注入初筛的场景窗口分析，让 AI 精判可核实/反驳，避免两阶段结论打架
    const scenes = Array.isArray(opts.sceneHint)
        ? opts.sceneHint
        : (Array.isArray(ch?.judge?.scenes) ? ch.judge.scenes : []);
    if (scenes.length) {
        rulesSummary += `\n【关键词初筛的场景窗口分析（供参考，可核实或反驳）】\n${buildScenesText(scenes)}`;
    }
    const messages = buildJudgeMessages(template, {
        chapterContent: ch.text,
        rulesSummary,
    });
    const raw = await niJudgeCallRetry(messages, api, signal, { baseLength: 800 });
    const parsed = parseJudgeResponse(raw);
    const isDoubt = parsed.confidence < (Number(rules.aiThreshold) || 0.6);
    return {
        result: isDoubt ? 'doubt' : parsed.result,
        confidence: parsed.confidence,
        evidence: parsed.evidence,
        mode: 'ai',
        scenes: scenes.slice(), // 附带初筛场景窗口明细（详情/后续加料参考）
        at: Date.now(),
    };
}

/**
 * 批量场景扫描（一次 AI 调用判定一组章节，默认 10 章/组）：
 * 本地场景引擎先为每章提取场景窗口原文 → 打包成材料 → AI 逐章标记 has_gap →
 * 写回每章 judge（本地安全否决优先；AI 遗漏章节回退本地初筛结论）。
 * AI 调用/解析失败时整组降级为本地场景引擎初筛（不会全部失败），失败原因写入每章 error 供详情查看。
 * 标记「是/存疑」的章节后续单独走原 AI 加料流程。
 */
async function judgeChapterBatch(group, { signal = null } = {}) {
    const list = (Array.isArray(group) ? group : [group]).filter(ch => ch && ch.text);
    if (!list.length) return;
    let scoredByIndex = new Map();
    let fallbackMsg = '';
    try {
        const rules = niJudgeRules();
        const api = niJudgeApiCfg();
        if (!api.url || !api.model) throw new Error('请先在「判定设置」中填写 AI 模式需要的接口地址与模型');
        const sceneCfg = niSceneConfig();
        const bookProfile = niGetBookProfile().profile;
        const autoNames = niGetAutoNames();
        const aiThreshold = Number(rules.aiThreshold) || 0.6;

        // 本地场景引擎初筛（窗口明细/安全否决；AI 遗漏或降级时回退）
        for (const ch of list) scoredByIndex.set(ch.index, niScoreChapter(ch));

        const template = extension_settings[EXT_NAME]?.judgePrompts?.batchTemplate || BATCH_JUDGE_PROMPT;
        const chaptersText = buildBatchChaptersText(list, {
            sceneConfig: sceneCfg,
            bookProfile,
            autoNames,
            maxCharsPerChapter: Number(sceneCfg.batch_max_chars_per_chapter) || 1200,
        });
        const messages = buildBatchJudgeMessages(template, {
            chaptersText,
            rulesSummary: buildJudgeRulesSummary(rules),
        });
        const raw = await niJudgeCallRetry(messages, api, signal, { baseLength: 2000 });
        const byIndex = parseBatchJudgeResponse(raw);

        for (const ch of list) {
            const scored = scoredByIndex.get(ch.index) || niScoreChapter(ch);
            // 本地安全否决优先（词表直接命中，比 AI 可靠）
            if (scored.vetoed) {
                ch.judge = { ...keywordJudgeToStore(scored), result: 'vetoed', hybridPending: false, at: Date.now() };
            } else {
                const res = byIndex.get(ch.index);
                if (!res) {
                    // AI 遗漏该章：回退本地初筛结论
                    const cls = classifyKeywordResult(scored);
                    ch.judge = { ...keywordJudgeToStore(scored), result: cls.result, hybridPending: cls.hybridPending };
                } else {
                    const isDoubt = res.confidence < aiThreshold;
                    ch.judge = {
                        result: isDoubt ? 'doubt' : res.result,
                        confidence: res.confidence,
                        evidence: res.evidence || scored.evidence,
                        mode: 'batch',
                        scenes: scored.scenes,
                        safety: scored.safety,
                        bookProfile: scored.bookProfile,
                        modes: scored.modes,
                        score: scored.score,
                        hitCount: scored.hitCount,
                        at: Date.now(),
                    };
                }
            }
            delete ch.error;
            transitionChapter(ch, CHAPTER_STATUS.JUDGED);
        }
        niEnrichScheduleSave();
    } catch (err) {
        if (signal?.aborted || err?.message === 'AbortError') throw err;
        // 降级：整组回退本地场景引擎初筛，AI 失败原因写入每章 error（详情弹窗可查）
        const hint = /context|token|length|400|maximum|too large/i.test(String(err?.message || ''))
            ? '（可能是输入/输出超出模型上限：请调小每批章数或「每章材料上限」，或换上下文更大的模型）'
            : '';
        fallbackMsg = `批量 AI 判定失败，已回退本地场景引擎初筛：${err?.message || err}${hint}`;
        console.warn('[NI] 批量场景扫描降级为本地初筛:', err?.message || err);
        for (const ch of list) {
            let scored = scoredByIndex.get(ch.index);
            try { scored = scored || niScoreChapter(ch); } catch (_) { scored = null; }
            if (scored) {
                const cls = classifyKeywordResult(scored);
                ch.judge = {
                    ...keywordJudgeToStore(scored),
                    result: scored.vetoed ? 'vetoed' : cls.result,
                    hybridPending: false,
                    fallbackReason: fallbackMsg,
                    at: Date.now(),
                };
                ch.error = fallbackMsg;
                transitionChapter(ch, CHAPTER_STATUS.JUDGED);
            } else {
                ch.error = err?.message || String(err);
                transitionChapter(ch, CHAPTER_STATUS.FAILED);
            }
        }
        niEnrichScheduleSave();
    }
}

/**
 * 判定单个章节（批量与单章共用）。
 * 模式行为：
 *  - keyword：仅关键词评分
 *  - ai：仅 AI 深度分析
 *  - hybrid：关键词初筛（强命中→yes、无命中→no、部分命中→标记"可疑"并自动级联 AI 精判）
 *  - 精判阶段（forceAi / _niJudgeRefinePass）：跳过关键词直接 AI，覆盖可疑标记
 */
async function judgeChapter(ch, index, { signal = null, forceAi = false } = {}) {
    if (!ch || !ch.text) throw new Error('章节正文为空');
    if (ch.status !== CHAPTER_STATUS.DETECTING) {
        transitionChapter(ch, CHAPTER_STATUS.DETECTING);
    }
    try {
        const rules = niJudgeRules();
        const refinePass = forceAi || _niJudgeRefinePass === true;
        const keywordOnly = _niJudgeKeywordPass === true;
        let judge = null;
        if (refinePass) {
            // 精判阶段：直接 AI，覆盖之前的可疑标记与关键词结果
            judge = await aiJudgeChapter(ch, rules, signal);
        } else if (keywordOnly) {
            // 关键词初筛（场景引擎）：四分类（有可补全窗口→是、仅场景无缺口→可疑、
            // 无场景→否、安全否决→安全否决），可疑章节带 hybridPending 标记，供「AI 精判可疑」收集
            const scored = niScoreChapter(ch);
            const cls = classifyKeywordResult(scored);
            judge = { ...keywordJudgeToStore(scored), result: cls.result, hybridPending: cls.hybridPending };
        } else if (rules.mode === 'keyword') {
            // 纯关键词模式（场景引擎）：直接 是/否/安全否决 判定，不产生可疑标记
            judge = keywordJudgeToStore(niScoreChapter(ch));
        } else if (rules.mode === 'hybrid' || rules.mode === 'hybrid_all') {
            // 关键词 + AI 组合：先关键词初筛；
            //  - hybrid：仅可疑章节自动级联 AI 精判（"开始判定"全自动两阶段，推荐）
            //  - hybrid_all：初筛后全部章节 AI 精判（覆盖初筛结果）
            const scored = niScoreChapter(ch);
            const cls = classifyKeywordResult(scored);
            judge = { ...keywordJudgeToStore(scored), result: cls.result, hybridPending: cls.hybridPending };
            if (rules.mode === 'hybrid_all' || judge.hybridPending) {
                // 传入初筛窗口明细，AI 精判可核实/反驳
                judge = await aiJudgeChapter(ch, rules, signal, { sceneHint: scored.scenes });
            }
        } else {
            judge = await aiJudgeChapter(ch, rules, signal);
        }
        ch.judge = judge;
        delete ch.error;
        transitionChapter(ch, CHAPTER_STATUS.JUDGED);
        niEnrichScheduleSave();
        return judge;
    } catch (err) {
        if (signal?.aborted || err?.message === 'AbortError') throw err;
        // 已有可疑标记时保留标记（AI 精判失败可再次重试），仅记录错误
        if (!ch.judge?.hybridPending) ch.error = err?.message || String(err);
        transitionChapter(ch, CHAPTER_STATUS.FAILED);
        niEnrichScheduleSave();
        throw err;
    }
}

let niJudgeQueueCreated = false;
let niJudgeBatchQueueCreated = false;
// 混合模式运行期标志：AI 精判阶段 / 仅关键词初筛阶段（由对应按钮设置，队列结束时清除）
let _niJudgeRefinePass = false;
let _niJudgeKeywordPass = false;

function niJudgeQueueEligible(ch) {
    if (!ch || ch.filtered) return false;
    if (_niJudgeRefinePass) return !!ch.judge?.hybridPending;
    return [CHAPTER_STATUS.UNDETECTED, CHAPTER_STATUS.FAILED, CHAPTER_STATUS.SKIPPED].includes(ch.status);
}

/** 批量模式：把待判定章节按每批章数分组（每组 = 队列一项，一次 AI 调用）。 */
function niJudgeBatchGroups() {
    const chapters = (Array.isArray(S.enrichChapters) ? S.enrichChapters : []).filter(niJudgeQueueEligible);
    const batchSize = Math.max(1, Number(niSceneConfig().batch_chapters_per_call) || 10);
    const groups = [];
    for (let i = 0; i < chapters.length; i += batchSize) {
        groups.push(chapters.slice(i, i + batchSize));
    }
    return groups;
}

function niForEachGroupItem(item, fn) {
    (Array.isArray(item) ? item : [item]).forEach(fn);
}

/** 判定并发数（逐章与批量共用；0/空按 1 串行）。 */
function niJudgeConcurrency() {
    return Math.max(1, parseInt(extension_settings[EXT_NAME]?.judgeConcurrency, 10) || 1);
}

/** 判定队列按当前模式分发：batch → 分组批量队列；其余 → 逐章队列。 */
function niJudgeEnsureQueue() {
    const isBatch = niJudgeRules().mode === 'batch';
    if (isBatch ? niJudgeBatchQueueCreated : niJudgeQueueCreated) return niJudgeQueue;
    if (isBatch) niJudgeBatchQueueCreated = true; else niJudgeQueueCreated = true;
    niJudgeQueue = isBatch
        ? createBatchQueueController({
            getItems: niJudgeBatchGroups,
            isEligible: item => Array.isArray(item) && item.length > 0,
            processItem: judgeChapterBatch,
            setProcessingStatus: item => niForEachGroupItem(item, ch => { if (ch) ch.status = CHAPTER_STATUS.DETECTING; }),
            setSkippedStatus: item => niForEachGroupItem(item, ch => { if (ch) { ch.status = CHAPTER_STATUS.SKIPPED; niEnrichScheduleSave(); } }),
            setFailedStatus: (item, index, err) => niForEachGroupItem(item, ch => {
                if (ch && ch.status !== CHAPTER_STATUS.JUDGED) {
                    ch.status = CHAPTER_STATUS.FAILED;
                    if (!ch.error) ch.error = err?.message || '批量判定失败';
                    niEnrichScheduleSave();
                }
            }),
            resetStatus: item => niForEachGroupItem(item, ch => { if (ch) { ch.status = CHAPTER_STATUS.UNDETECTED; niEnrichScheduleSave(); } }),
            concurrency: niJudgeConcurrency,
            onProgress: niJudgeOnProgress,
            persist: () => niEnrichScheduleSave({ immediate: true }),
        })
        : createBatchQueueController({
            getItems: () => (Array.isArray(S.enrichChapters) ? S.enrichChapters : []),
            isEligible: niJudgeQueueEligible,
            processItem: judgeChapter,
            setProcessingStatus: ch => { if (ch) ch.status = CHAPTER_STATUS.DETECTING; },
            setSkippedStatus: ch => { if (ch) { ch.status = CHAPTER_STATUS.SKIPPED; niEnrichScheduleSave(); } },
            setFailedStatus: ch => { if (ch && ch.status !== CHAPTER_STATUS.JUDGED) { ch.status = CHAPTER_STATUS.FAILED; niEnrichScheduleSave(); } },
            resetStatus: ch => { if (ch) { ch.status = CHAPTER_STATUS.UNDETECTED; niEnrichScheduleSave(); } },
            concurrency: niJudgeConcurrency,
            onProgress: niJudgeOnProgress,
            persist: () => niEnrichScheduleSave({ immediate: true }),
        });
    niSetBatchQueues({ judge: niJudgeQueue });
    return niJudgeQueue;
}

/** 当前生效的判定队列（暂停/跳过/取消/重判用；避免模式切换时拿到未创建的实例）。 */
function niJudgeActiveQueue() {
    if (niJudgeRules().mode === 'batch') return niJudgeQueue || niJudgeEnsureQueue();
    return niJudgeQueue || niJudgeEnsureQueue();
}

/** 开始判定（工具栏/全局动作）：运行中或队列为空时给出明确提示。 */
async function niJudgeStartQueue() {
    if (niJudgeQueue?.isRunning?.()) { toastr?.warning('判定队列运行中，请先暂停或等待完成'); return; }
    const ok = await niJudgeEnsureQueue()?.run();
    if (ok === false) toastr?.info('没有待判定的章节（或当前引擎组合下没有符合条件的章节）');
}

function niJudgeOnProgress(p) {
    const prog = q('#ni-jp-title-prog');
    const bar = q('#ni-jp-title-bar');
    const note = q('#ni-jp-title-note');
    if (prog) prog.style.display = 'flex';
    if (bar) {
        bar.style.width = `${Math.round(((p.done || 0) / Math.max(1, p.total || 1)) * 100)}%`;
        bar.classList.toggle('g', !p.running && !p.paused);
    }
    if (note) note.textContent = p.note || (p.running ? `已完成 ${p.done}/${p.total}` : '');
    niJudgeSyncButtons(!!p.running);
    if (!p.running) {
        _niJudgeRefinePass = false;
        _niJudgeKeywordPass = false;
        niJudgeRenderStats();
        niEnrichRenderList();
    }
}

/** 关键词初筛（免费快速）：全部分类为 是/否/可疑/安全否决（部分命中标记 hybridPending，不调用 AI）。 */
function niJudgeKeywordScan() {
    if (niJudgeQueue?.isRunning?.()) { toastr?.warning('队列运行中，请先暂停或等待完成'); return; }
    const mode = niJudgeRules().mode;
    if (mode === 'batch' || mode === 'ai') { toastr?.warning('当前组合没有关键词初筛环节，请勾选「关键词判定」引擎'); return; }
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const targets = chapters.filter(ch => niJudgeQueueEligible(ch));
    if (!targets.length) { toastr?.info('没有待判定的章节'); return; }
    _niJudgeKeywordPass = true;
    niJudgeEnsureQueue()?.run();
}

/** AI 精判可疑章节：只处理关键词初筛标记为"可疑"（hybridPending）的章节，覆盖为 AI 结果。 */
function niJudgeAiRefine() {
    if (niJudgeQueue?.isRunning?.()) { toastr?.warning('队列运行中，请先暂停或等待完成'); return; }
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const targets = chapters.filter(ch => ch.judge?.hybridPending);
    if (!targets.length) { toastr?.info('没有可疑章节需要 AI 精判'); return; }
    const mode = niJudgeRules().mode;
    if (mode === 'keyword' || mode === 'batch') { toastr?.warning('当前组合没有 AI 精判环节，请勾选「AI 深度判定」引擎'); return; }
    _niJudgeRefinePass = true;
    niJudgeEnsureQueue()?.run();
}

function niJudgeSuspiciousCount() {
    return (Array.isArray(S.enrichChapters) ? S.enrichChapters : []).filter(ch => ch.judge?.hybridPending).length;
}

function niJudgeRenderStats() {
    const el = q('#ni-j-stats');
    if (!el) return;
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const c = { undetected: 0, detecting: 0, judged: 0, failed: 0, skipped: 0, modified: 0, suspicious: 0, other: 0 };
    chapters.forEach(ch => {
        if (ch.status === CHAPTER_STATUS.JUDGED && ch.judge?.hybridPending) { c.suspicious++; return; }
        if (c[ch.status] != null) c[ch.status]++; else c.other++;
    });
    const judged = c.judged + c.modified;
    const parts = [`待判定 ${c.undetected}`, `判定中 ${c.detecting}`, `已判定 ${judged}`];
    if (c.suspicious > 0) parts.push(`可疑 ${c.suspicious}`);
    parts.push(`失败 ${c.failed}`, `跳过 ${c.skipped}`);
    el.textContent = parts.join(' · ');
}

function niJudgeSyncButtons(running) {
    const startBtn = q('#ni-btn-judge');
    const pauseBtn = q('#ni-btn-judge-pause');
    const skipBtn = q('#ni-btn-judge-skip');
    const cancelBtn = q('#ni-btn-judge-cancel');
    const retryBtn = q('#ni-btn-judge-retry');
    const reallBtn = q('#ni-btn-judge-reall');
    const scanBtn = q('#ni-btn-judge-scan');
    const refineBtn = q('#ni-btn-judge-refine');
    if (!startBtn) return;
    if (running) {
        startBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (reallBtn) reallBtn.style.display = 'none';
        if (scanBtn) scanBtn.style.display = 'none';
        if (refineBtn) refineBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'inline-flex';
        if (skipBtn) skipBtn.style.display = 'inline-flex';
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    } else {
        startBtn.style.display = 'inline-flex';
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (skipBtn) skipBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        const hasChapters = Array.isArray(S.enrichChapters) && S.enrichChapters.length > 0;
        const mode = niJudgeRules().mode;
        const batchMode = mode === 'batch';
        if (retryBtn) {
            const failedCount = (Array.isArray(S.enrichChapters) ? S.enrichChapters : []).filter(ch => ch.status === CHAPTER_STATUS.FAILED).length;
            retryBtn.style.display = failedCount > 0 ? 'inline-flex' : 'none';
            retryBtn.textContent = failedCount > 0 ? `重判失败(${failedCount})` : '重判失败';
        }
        if (reallBtn) reallBtn.style.display = hasChapters ? 'inline-flex' : 'none';
        // 纯 AI / 批量模式：无关键词初筛环节，隐藏「关键词初筛」；批量模式再隐藏「AI 精判可疑」
        if (scanBtn) scanBtn.style.display = hasChapters && !batchMode && mode !== 'ai' ? 'inline-flex' : 'none';
        if (refineBtn) {
            const suspicious = niJudgeSuspiciousCount();
            refineBtn.style.display = suspicious > 0 && mode !== 'keyword' && mode !== 'batch' ? 'inline-flex' : 'none';
            refineBtn.textContent = suspicious > 0 ? `AI 精判可疑(${suspicious})` : 'AI 精判可疑';
        }
    }
}

/** 只把失败的章节重置并重新判定（不碰已判定/跳过的）。 */
function niJudgeRejudgeFailed() {
    if (niJudgeActiveQueue()?.isRunning?.()) { toastr?.warning('队列运行中，请先暂停或等待完成'); return; }
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const targets = chapters.filter(ch => ch.status === CHAPTER_STATUS.FAILED);
    if (!targets.length) { toastr?.info('没有失败的章节'); return; }
    targets.forEach(niEnrichResetForRejudge);
    niEnrichScheduleSave();
    niEnrichRenderList();
    niJudgeRenderStats();
    niJudgeEnsureQueue()?.run();
}

// —— 规则库 UI ——
function niJudgeRenderKeywords() {
    const el = q('#ni-j-keywords');
    if (!el) return;
    const rules = niJudgeRules();
    el.innerHTML = rules.keywords.map((k, i) => `
        <div class="ni-j-rule-row">
            <input type="text" class="ni-j-rule-word" data-i="${i}" value="${niEscAttr(k.word)}" placeholder="关键词">
            <input type="number" class="ni-j-rule-w" data-i="${i}" value="${k.weight ?? 1}" min="0" step="0.5" title="权重">
            <button class="ni-e-act danger" data-kw-del="${i}" title="删除">✕</button>
        </div>`).join('') || '<div class="ni-desc" style="margin:0">（空）</div>';
}

function niJudgeRenderRegexes() {
    const el = q('#ni-j-regexes');
    if (!el) return;
    const rules = niJudgeRules();
    el.innerHTML = rules.regexes.map((r, i) => `
        <div class="ni-j-rule-row">
            <input type="text" class="ni-j-rule-regex" data-i="${i}" value="${niEscAttr(r.pattern)}" placeholder="正则表达式">
            <input type="number" class="ni-j-rule-w" data-i="${i}" value="${r.weight ?? 1}" min="0" step="0.5" title="权重">
            <button class="ni-e-act danger" data-rx-del="${i}" title="删除">✕</button>
        </div>`).join('') || '<div class="ni-desc" style="margin:0">（空）</div>';
}

function niJudgeReadRulesFromUI() {
    const rules = niJudgeRules();
    const kwRows = qa('#ni-j-keywords .ni-j-rule-row');
    if (kwRows.length) {
        rules.keywords = [...kwRows].map(row => ({
            word: row.querySelector('.ni-j-rule-word')?.value?.trim() || '',
            weight: Number(row.querySelector('.ni-j-rule-w')?.value) || 0,
        })).filter(k => k.word);
    }
    const rxRows = qa('#ni-j-regexes .ni-j-rule-row');
    if (rxRows.length) {
        rules.regexes = [...rxRows].map(row => ({
            pattern: row.querySelector('.ni-j-rule-regex')?.value?.trim() || '',
            weight: Number(row.querySelector('.ni-j-rule-w')?.value) || 0,
        })).filter(r => r.pattern);
    }
    return rules;
}

/** 引擎勾选 → 判定模式（关键词/AI 并列组合）：
 *  仅关键词→keyword；仅 AI→ai；关键词+AI(仅可疑)→hybrid；关键词+AI(全部)→hybrid_all；批量→batch。 */
function niJudgeModeFromEngines() {
    const kw = q('#ni-j-engine-keyword')?.checked === true;
    const ai = q('#ni-j-engine-ai')?.checked === true;
    const batch = q('#ni-j-engine-batch')?.checked === true;
    const scope = String(q('#ni-j-ai-scope')?.value || 'all');
    if (batch) return 'batch';
    if (kw && ai) return scope === 'suspicious' ? 'hybrid' : 'hybrid_all';
    if (ai) return 'ai';
    return 'keyword';
}

/** 判定模式 → 引擎勾选状态（AI 单独勾选时 AI 范围强制「全部」且禁用）。 */
function niJudgeSyncEngineUI(mode) {
    const m = mode || 'keyword';
    const kw = q('#ni-j-engine-keyword');
    const ai = q('#ni-j-engine-ai');
    const batch = q('#ni-j-engine-batch');
    const scope = q('#ni-j-ai-scope');
    if (kw) kw.checked = m === 'keyword' || m === 'hybrid' || m === 'hybrid_all';
    if (ai) ai.checked = m === 'ai' || m === 'hybrid' || m === 'hybrid_all';
    if (batch) batch.checked = m === 'batch';
    if (scope) {
        scope.value = m === 'hybrid' ? 'suspicious' : 'all';
        scope.disabled = ai?.checked === true && kw?.checked !== true;
    }
}

function niJudgeSyncModeUI(mode) {
    const m = mode || niJudgeModeFromEngines() || 'keyword';
    niJudgeSyncEngineUI(m);
    const aiGroup = q('#ni-j-ai-group');
    if (aiGroup) aiGroup.style.display = m === 'ai' || m === 'hybrid' || m === 'hybrid_all' || m === 'batch' ? '' : 'none';
    const kwGroup = q('#ni-j-kw-group');
    if (kwGroup) kwGroup.style.display = m === 'keyword' || m === 'hybrid' || m === 'hybrid_all' ? '' : 'none';
    const batchGroup = q('#ni-j-batch-group');
    if (batchGroup) batchGroup.style.display = m === 'batch' ? '' : 'none';
}

function niJudgeSyncSettingsUI() {
    const rules = niJudgeRules();
    const api = niJudgeApiCfg();
    niJudgeSyncEngineUI(rules.mode || 'keyword');
    sv('#ni-j-threshold', rules.threshold ?? 3);
    sv('#ni-j-ai-threshold', rules.aiThreshold ?? 0.6);
    sv('#ni-j-api-url', api.url || '');
    sv('#ni-j-api-key', api.key || '');
    sv('#ni-j-api-model', api.model || '');
    const streamEl = q('#ni-j-api-stream');
    if (streamEl) streamEl.checked = !!api.stream;
    sv('#ni-j-api-timeout', api.timeoutSec ?? 60);
    sv('#ni-j-api-retries', api.retries ?? 2);
    sv('#ni-j-concurrency', extension_settings[EXT_NAME]?.judgeConcurrency ?? DEFAULT_SETTINGS.judgeConcurrency);
    sv('#ni-j-rate-limit', extension_settings[EXT_NAME]?.judgeRateLimit ?? DEFAULT_SETTINGS.judgeRateLimit);
    const ptEl = q('#ni-j-prompt');
    if (ptEl) ptEl.value = extension_settings[EXT_NAME]?.judgePrompts?.template || DEFAULT_JUDGE_PROMPT;
    // 批量场景扫描：每批章数 + 批量模板
    sv('#ni-j-batch-size', niSceneConfig().batch_chapters_per_call ?? 10);
    const bptEl = q('#ni-j-batch-prompt');
    if (bptEl) bptEl.value = extension_settings[EXT_NAME]?.judgePrompts?.batchTemplate || BATCH_JUDGE_PROMPT;
    // 附加特征开关
    const feat = rules.features || {};
    const fEl = (id, val) => { const el = q(id); if (el) el.checked = val !== false; };
    fEl('#ni-j-feat-cooccur', feat.cooccur !== false);
    fEl('#ni-j-feat-paragraph', feat.paragraph !== false);
    fEl('#ni-j-feat-ellipsis', feat.ellipsis !== false);
    fEl('#ni-j-feat-metaphor', feat.metaphorDownweight !== false);
    niJudgeRenderKeywords();
    niJudgeRenderRegexes();
    niJudgeSyncModeUI();
}

/** 批量重新判定：重置所有非处理中章节为未判定并重跑（覆盖已判定/失败/跳过）。 */
function niJudgeRejudgeAll() {
    if (niJudgeActiveQueue()?.isRunning?.()) { toastr?.warning('队列运行中，请先暂停或等待完成'); return; }
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const targets = chapters.filter(ch => !ch.filtered && ![CHAPTER_STATUS.DETECTING, CHAPTER_STATUS.ENRICHING].includes(ch.status));
    if (!targets.length) { toastr?.warning('没有可重新判定的章节'); return; }
    if (!confirm(`将重置 ${targets.length} 个章节的判定结果并全部重新判定（已判定/失败/跳过都会被覆盖重跑，AI 模式会消耗 API 额度）？`)) return;
    targets.forEach(niEnrichResetForRejudge);
    niEnrichScheduleSave();
    niEnrichRenderList();
    niJudgeRenderStats();
    niJudgeSyncButtons(false);
    niJudgeEnsureQueue()?.run();
}

function niJudgeExportCsv() {    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const rows = [['章节', '标题', '判定结果', '置信度', '模式', '证据']];
    chapters.forEach(ch => {
        if (!ch.judge) return;
        rows.push([ch.index, ch.title, judgeResultLabel(ch.judge.result), ch.judge.confidence, ch.judge.mode, String(ch.judge.evidence || '')]);
    });
    if (rows.length <= 1) { toastr?.warning('还没有判定结果可导出'); return; }
    const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `判定报告_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ============================================================
// 加料管道 P3 — AI 加料
// ============================================================

// 加料 API 客户端（独立档位；流式支持 onDelta 增量回调；可选跟随酒馆主预设服务配置）
const { callProfileApi: niEnrichCall } = createProfileApiClient({
    getProfile: () => niEnrichApiCfg(),
    acquireRateSlot: niAcquireEnrichRateSlot,
    runWithSemaphore,
    semaphore: EnrichSemaphore,
    readChatCompletionStream: niReadChatCompletionStream,
    hasLengthFinishReason: niHasLengthFinishReason,
    extractChatCompletionText: niExtractChatCompletionText,
    getRequestHeaders,
    getTavernServiceSettings: niGetTavernServiceSettings,
    fetch,
});

/**
 * 读取酒馆当前生效的运行时配置（跟随预设模式用）：
 *  - API 连接（地址/Key/模型/源）来自酒馆连接配置 `oai_settings`
 *    （酒馆客户端中 getContext().chatCompletionSettings 即此对象；"API 连接" 与 "预设" 是分开的两层，
 *     预设 promptManager.serviceSettings 只含提示词/温度等，不含 API 地址/Key/模型）；
 *  - 合并时连接配置优先，预设仅补充缺失字段。
 */
function niGetTavernServiceSettings() {
    try {
        const oai = (typeof oai_settings === 'object' && oai_settings) ? oai_settings : {};
        const presetSvc = promptManager?.serviceSettings || {};
        const source = String(oai.chat_completion_source || presetSvc.chat_completion_source || 'openai');
        const merged = { ...(presetSvc || {}), ...oai };
        merged.chat_completion_source = source;
        return merged;
    } catch (_) {
        return {};
    }
}

function niEnrichApiCfg() {
    const base = { ...DEFAULT_SETTINGS.enrichApi };
    const saved = extension_settings[EXT_NAME]?.enrichApi;
    if (!saved || typeof saved !== 'object') return base;
    const merged = { ...base, ...saved };
    // 旧配置迁移：之前是「预设 XOR 独立」二选一，未存 useIndependentApi 时按旧语义推断
    if (merged.useIndependentApi === undefined) {
        merged.useIndependentApi = merged.useTavernPreset !== true;
    }
    return merged;
}

function niEnrichSaveApi(patch) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg.enrichApi = { ...niEnrichApiCfg(), ...(patch || {}) };
    saveSettingsDebounced?.();
}

function niEnrichParams() {
    const base = { ...DEFAULT_SETTINGS.enrichParams };
    const saved = extension_settings[EXT_NAME]?.enrichParams;
    return saved && typeof saved === 'object' ? { ...base, ...saved } : base;
}

function niEnrichSaveParams(patch) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg.enrichParams = { ...niEnrichParams(), ...(patch || {}) };
    saveSettingsDebounced?.();
}

function niEnrichTemplates() {
    const base = (DEFAULT_ENRICH_TEMPLATES || []).map(t => ({ ...t }));
    const saved = extension_settings[EXT_NAME]?.enrichTemplates;
    if (!Array.isArray(saved) || !saved.length) return base;
    return saved.map(t => ({ ...t }));
}

function niEnrichSaveTemplates(list) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg.enrichTemplates = (Array.isArray(list) ? list : []).map(t => ({ ...t }));
    saveSettingsDebounced?.();
}

function niEnrichSafety() {
    const base = {
        ...DEFAULT_SETTINGS.enrichSafety,
        sensitiveWords: [...(DEFAULT_SETTINGS.enrichSafety?.sensitiveWords || [])],
    };
    const saved = extension_settings[EXT_NAME]?.enrichSafety;
    if (!saved || typeof saved !== 'object') return base;
    return {
        ...base,
        ...saved,
        sensitiveWords: Array.isArray(saved.sensitiveWords) ? [...saved.sensitiveWords] : base.sensitiveWords,
    };
}

function niEnrichSaveSafety(patch) {
    const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
    cfg.enrichSafety = { ...niEnrichSafety(), ...(patch || {}) };
    saveSettingsDebounced?.();
}

// —— 每日限额 ——
function niEnrichToday() {
    return new Date().toISOString().slice(0, 10);
}
function niEnrichDailyUsed() {
    const api = niEnrichApiCfg();
    return api.dailyQuotaDate === niEnrichToday() ? (Number(api.dailyQuotaUsed) || 0) : 0;
}
function niEnrichQuotaReached() {
    const api = niEnrichApiCfg();
    const quota = Number(api.dailyQuota) || 0;
    return quota > 0 && niEnrichDailyUsed() >= quota;
}
function niEnrichConsumeQuota() {
    niEnrichSaveApi({ dailyQuotaDate: niEnrichToday(), dailyQuotaUsed: niEnrichDailyUsed() + 1 });
}

/** 不可重试的错误（资格/敏感词/限额）：恢复原状态而不是标失败。 */
function niEnrichIsPermanentError(err) {
    const msg = String(err?.message || '');
    return msg.includes('无加料资格') || msg.includes('敏感词') || msg.includes('每日限额');
}

let _niEnrichQuotaWarned = false;
let _niEnrichDetailController = null;   // 详情弹窗流式生成的 abort controller
let niEnrichTemplateSaveTimer = null;   // 模板编辑防抖保存

/** AI 加料单个章节（批量与单章共用；流式 onDelta 实时回写 UI）。 */
async function enrichChapter(ch, index, { signal = null, onDelta = null } = {}) {
    if (!ch || !ch.text) throw new Error('章节正文为空');
    const prevStatus = ch.status;
    if (!canEnrichChapter(ch)) throw new Error('本章无加料资格（需判定为「是/存疑」或人工标记「通过」）');
    const safety = niEnrichSafety();
    if (safety.enabled && checkSensitive(ch.text, safety.sensitiveWords)) {
        const hit = checkSensitive(ch.text, safety.sensitiveWords);
        ch.error = `原文含敏感词「${hit.word}」，已跳过`;
        throw new Error(ch.error);
    }
    if (niEnrichQuotaReached()) {
        if (!_niEnrichQuotaWarned) {
            _niEnrichQuotaWarned = true;
            toastr?.warning('已达每日加料调用限额，加料已自动停止（可在设置中调整或明天继续）');
        }
        throw new Error('已达每日调用限额，加料已停止');
    }
    if (ch.status !== CHAPTER_STATUS.ENRICHING) transitionChapter(ch, CHAPTER_STATUS.ENRICHING);
    try {
        const api = niEnrichApiCfg();
        const useInd = api.useIndependentApi === true;
        const usePreset = api.useTavernPreset === true;
        if (!useInd && !usePreset) {
            throw new Error('请先选择 API 来源：在「加料设置」勾选「使用酒馆主预设」或「独立 API 配置」（两者可同时勾选）');
        }
        if (useInd && (!api.url || !api.model)) {
            throw new Error('请先在「加料设置」的独立 API 配置中填写接口地址与模型');
        }
        const templates = niEnrichTemplates();
        const params = niEnrichParams();
        const minChars = Math.max(0, Number(params.minChars) || ENRICH_MIN_CHARS);
        const enforceMin = params.enforceMinChars !== false && minChars > 0;
        const preferredId = ch.enrich?.templateId || params.templateId || templates[0]?.id;
        const template = templates.find(t => t.id === preferredId) || templates[0];
        if (!template?.prompt) throw new Error('没有可用的加料模板，请先在「加料设置」中新建或恢复默认模板');
        let messages = buildEnrichMessages(template.prompt, {
            chapterContent: ch.text,
            keywords: buildEnrichKeywordsSummary(ch.judge),
            style: template.style || template.name || '',
            intensity: `${enrichIntensityLabel(params.intensity)}\n${enrichIntensityGuide(params.intensity)}`,
            minChars,
        });
        // 预设模式：把酒馆当前预设（如「泉此方改加料」）启用的提示词拼进请求，
        // 复用项目「跟随酒馆预设」机制（createTavernPresetMessageTools）：
        // 正确筛选（排除上下文/标记占位提示词）+ 酒馆宏替换（{{setvar::}}/{{getvar::}}/{{user}} 等）；
        // 加料文风/人设跟随预设；任务模板与输出规范仍在最后一条生效。
        // 注意：预设只提供提示词/模型跟随，与「独立 API 连接」互不排斥（可同时勾选）。
        if (usePreset) {
            try {
                const presetMsgs = await niBuildTavernPresetPromptMessages();
                if (presetMsgs.length) {
                    messages = [...presetMsgs, ...messages];
                    console.log(`[NI] 加料已拼接酒馆预设提示词 ${presetMsgs.length} 条（当前预设：${promptManager?.serviceSettings?.name || '未知'}；宏已替换；任务模板+输出规范在最后一条）`);
                } else {
                    console.warn('[NI] 加料预设模式：当前酒馆预设没有可用的启用提示词——请在酒馆预设管理器确认已应用目标预设（如「泉此方改加料」）');
                }
            } catch (err) {
                console.warn('[NI] 加料预设模式：读取酒馆预设提示词失败，已退回纯插件模板。', err?.message || err);
            }
        }
        // 最大输出长度：默认按模型最大值（模型列表字段 → 内置模型表 → 手动值兜底）
        const manualMax = Math.min(64000, Math.max(256, Number(params.maxTokens) || 4000));
        let maxTokens = manualMax;
        if (params.maxTokensAuto !== false) {
            const oai = (typeof oai_settings === 'object' && oai_settings) ? oai_settings : {};
            const source = String(oai.chat_completion_source || 'openai');
            const curModel = String(
                (usePreset && !useInd)
                    ? (oai[`${source}_model`] || oai.model || '')
                    : (api.model || '')
            ).trim();
            const modelMax = niResolveModelMaxTokens(Array.isArray(oai.model_list) ? oai.model_list : [], curModel);
            if (modelMax && modelMax > 0) maxTokens = Math.min(modelMax, 64000);
        }
        const retries = Math.max(0, Number(api.retries) || 0);
        let raw = '';
        let lastErr = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (signal?.aborted) throw new Error('AbortError');
            try {
                raw = await niEnrichCall(messages, { responseLength: maxTokens, signal, onDelta });
                break;
            } catch (err) {
                if (signal?.aborted || err?.message === 'AbortError') throw err;
                lastErr = err;
                if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
        if (!raw) throw lastErr || new Error('加料 API 无返回内容');
        niEnrichConsumeQuota();
        // —— 回传过滤：剔除思考/思维链等非正文内容（小此预设 ECoT、<thinking> 等）——
        const cleaned = niFilterEnrichOutput(raw);
        // —— 无加料判定：AI 返回「无加料」标记或空输出 → 保留原文，不生成加料版 ——
        if (detectNoEnrichOutput(cleaned)) {
            ch.enrich = { noContent: true, at: Date.now() };
            delete ch.error;
            if (ch.status === CHAPTER_STATUS.ENRICHING) {
                if (!transitionChapter(ch, CHAPTER_STATUS.JUDGED)) ch.status = CHAPTER_STATUS.JUDGED;
            } else {
                ch.status = prevStatus;
            }
            niEnrichScheduleSave();
            return { reviewed: true, text: '', noContent: true };
        }
        // —— 解析加料段落（【¶N】锚点）并无缝回填原文 ——
        let segments = niParseEnrichSegments(cleaned);
        if (!segments.length) {
            // AI 没按格式输出（无段落编号）：整段视为一条无锚点加料，走兜底插入
            segments = [{ paragraph: 0, content: cleaned }];
        }
        // —— 强制字数：不足最低要求时自动追加一轮扩写（仅一次）——
        let addedLen = segments.reduce((sum, seg) => sum + String(seg.content || '').length, 0);
        if (enforceMin && addedLen > 0 && addedLen < minChars) {
            const boostMessages = [...messages, { role: 'user', content: buildEnrichShortfallInstruction(addedLen, minChars) }];
            let raw2 = '';
            let lastErr2 = null;
            for (let attempt = 0; attempt <= retries; attempt++) {
                if (signal?.aborted) throw new Error('AbortError');
                try {
                    raw2 = await niEnrichCall(boostMessages, { responseLength: maxTokens, signal, onDelta });
                    break;
                } catch (err) {
                    if (signal?.aborted || err?.message === 'AbortError') throw err;
                    lastErr2 = err;
                    if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
            if (raw2) {
                niEnrichConsumeQuota();
                const cleaned2 = niFilterEnrichOutput(raw2);
                if (!detectNoEnrichOutput(cleaned2)) {
                    const segs2 = niParseEnrichSegments(cleaned2);
                    if (segs2.length) {
                        segments.push(...segs2);
                        console.log(`[NI] 加料字数不足已自动扩写一轮：${addedLen} → ${segments.reduce((s, seg) => s + String(seg.content || '').length, 0)} 字`);
                    }
                }
            } else {
                console.warn('[NI] 加料字数补足扩写失败:', lastErr2?.message || lastErr2);
            }
            addedLen = segments.reduce((sum, seg) => sum + String(seg.content || '').length, 0);
        }
        const seamKeywords = (ch.judge?.evidence || '')
            .split(/[，,、;；\s]+/).map(s => s.trim()).filter(s => s.length >= 2);
        const mergeResult = mergeEnrichSegments(ch.text, segments, { seamKeywords });
        const mergedText = mergeResult.text;
        const reviewed = !(safety.enabled && checkSensitive(mergedText, safety.sensitiveWords));
        const postHit = safety.enabled ? checkSensitive(mergedText, safety.sensitiveWords) : null;
        ch.enrich = {
            text: mergedText,          // 加料版全文（原文 + 加料段落回填）
            segments,                  // 回填段落清单（含段落号），供详情弹窗人工调整
            merge: mergeResult.status, // ok / partial / manual
            templateId: template.id,
            intensity: params.intensity,
            at: Date.now(),
            reviewed,
            charCount: addedLen,       // 加料内容字数（非合并后总字数）
            short: addedLen < minChars,
        };
        // —— 强制字数：扩写一轮后仍不足 → 标记失败（保留内容供查看，可重试重新生成）——
        if (enforceMin && addedLen < minChars) {
            ch.error = `加料字数不足 ${minChars} 字（实际 ${addedLen} 字），已保留生成内容；可点「重试失败」重新生成或在详情中手动补写`;
            transitionChapter(ch, CHAPTER_STATUS.FAILED);
            niEnrichScheduleSave();
            return { reviewed, text: mergedText, charCount: addedLen, short: true, underMin: true, merge: mergeResult.status };
        }
        delete ch.error;
        if (!reviewed) {
            ch.error = `生成内容含敏感词「${postHit.word}」，已保留待人工审核`;
        }
        transitionChapter(ch, CHAPTER_STATUS.ENRICHED);
        niEnrichScheduleSave();
        return { reviewed, text: mergedText, charCount: addedLen, short: addedLen < minChars, merge: mergeResult.status };
    } catch (err) {
        if (signal?.aborted || err?.message === 'AbortError') throw err;
        if (!niEnrichIsPermanentError(err)) {
            ch.error = err?.message || String(err);
            transitionChapter(ch, CHAPTER_STATUS.FAILED);
        } else {
            ch.status = prevStatus;
        }
        niEnrichScheduleSave();
        throw err;
    }
}

let niEnrichQueueCreated = false;
function niEnrichEnsureQueue() {
    if (niEnrichQueueCreated) return niEnrichQueue;
    niEnrichQueueCreated = true;
    niEnrichQueue = createBatchQueueController({
        getItems: () => (Array.isArray(S.enrichChapters) ? S.enrichChapters : []),
        // 待加料：有资格且未加料；「强制字数」失败（short+failed）保留内容但允许重试重新生成
        isEligible: ch => canEnrichChapter(ch) && (!ch.enrich || (ch.status === CHAPTER_STATUS.FAILED && ch.enrich.short === true)),
        processItem: enrichChapter,
        setProcessingStatus: ch => { if (ch) ch.status = CHAPTER_STATUS.ENRICHING; },
        setSkippedStatus: ch => { if (ch) { ch.status = CHAPTER_STATUS.SKIPPED; niEnrichScheduleSave(); } },
        setFailedStatus: ch => {
            if (ch && ch.status !== CHAPTER_STATUS.ENRICHED && !niEnrichIsPermanentError(ch.error)) {
                ch.status = CHAPTER_STATUS.FAILED;
                niEnrichScheduleSave();
            }
        },
        resetStatus: ch => { if (ch) { ch.status = CHAPTER_STATUS.JUDGED; niEnrichScheduleSave(); } },
        concurrency: () => Math.max(1, parseInt(extension_settings[EXT_NAME]?.enrichConcurrency, 10) || 1),
        onProgress: niEnrichOnProgress,
        persist: () => niEnrichScheduleSave({ immediate: true }),
    });
    niSetBatchQueues({ enrich: niEnrichQueue });
    return niEnrichQueue;
}

/** 开始加料（工具栏/全局动作）：运行中或队列为空时给出明确提示。 */
async function niEnrichStartQueue() {
    if (niEnrichQueue?.isRunning?.()) { toastr?.warning('加料队列运行中，请先暂停或等待完成'); return; }
    const ok = await niEnrichEnsureQueue()?.run();
    if (ok === false) {
        toastr?.info('没有可加料的章节：需判定为「是/存疑」且尚未加料，或人工标记「通过」；可先对章节点「重判」或人工标记');
    }
}

function niEnrichOnProgress(p) {
    const prog = q('#ni-ep-title-prog');
    const bar = q('#ni-ep-title-bar');
    const note = q('#ni-ep-title-note');
    if (prog) prog.style.display = 'flex';
    if (bar) {
        bar.style.width = `${Math.round(((p.done || 0) / Math.max(1, p.total || 1)) * 100)}%`;
        bar.classList.toggle('g', !p.running && !p.paused);
    }
    if (note) note.textContent = p.note || (p.running ? `已完成 ${p.done}/${p.total}` : '');
    niEnrichSyncButtons(!!p.running);
    if (!p.running) {
        _niEnrichQuotaWarned = false;
        niEnrichRenderStats();
        niEnrichRenderList();
    }
}

function niEnrichRenderStats() {
    const el = q('#ni-e-stats');
    if (!el) return;
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    let pending = 0, enriching = 0, enriched = 0, failed = 0, skipped = 0, reviewed = 0, noContent = 0;
    chapters.forEach(ch => {
        if (ch.filtered) return;
        if (ch.status === CHAPTER_STATUS.ENRICHING) enriching++;
        else if (ch.status === CHAPTER_STATUS.FAILED) failed++;
        else if (ch.status === CHAPTER_STATUS.SKIPPED) skipped++;
        else if (ch.enrich) {
            if (ch.enrich.noContent) noContent++;
            else {
                enriched++;
                if (ch.enrich.reviewed === false) reviewed++;
            }
        } else if (canEnrichChapter(ch)) pending++;
    });
    const parts = [`待加料 ${pending}`, `加料中 ${enriching}`, `已加料 ${enriched}`];
    if (noContent > 0) parts.push(`无加料 ${noContent}`);
    if (reviewed > 0) parts.push(`需审核 ${reviewed}`);
    parts.push(`失败 ${failed}`, `跳过 ${skipped}`);
    el.textContent = parts.join(' · ');
}

/** 移动端/触屏环境检测（TauriTavern 安卓等 WebView；优先取酒馆 getContext().isMobile）。 */
function niIsMobileEnv() {
    try {
        const ctx = globalThis.SillyTavern?.getContext?.();
        if (typeof ctx?.isMobile === 'boolean') return ctx.isMobile;
    } catch (_) { /* 忽略 */ }
    return /Android|iPhone|iPad|iPod|Mobile|Tauri/i.test(String(navigator?.userAgent || ''));
}

// —— 导出（P4）——
function niEnrichExport() {
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const kept = chapters.filter(ch => !ch.filtered);
    if (!kept.length) { toastr?.warning('还没有导入小说，无法导出'); return; }

    const format = String(q('#ni-e-exp-format')?.value || 'txt');
    const mode = String(q('#ni-e-exp-mode')?.value || 'enriched');
    const onlySelected = q('#ni-e-exp-selected')?.checked === true;

    let list = kept;
    if (onlySelected) {
        const sel = S.enrichSelected || new Set();
        list = kept.filter(ch => sel.has(ch.id));
        if (!list.length) { toastr?.warning('未勾选任何可导出的章节'); return; }
    }

    // 未加料警告（加料版/对照模式）：桌面用 confirm；移动端 WebView 弹窗不可靠，改 toast 提示后继续
    const isMobile = niIsMobileEnv();
    if (mode !== 'original') {
        const missing = niCountNotEnriched(list);
        if (missing > 0) {
            if (isMobile) toastr?.warning(`有 ${missing} 章尚未加料，将按原文导出`);
            else if (!confirm(`有 ${missing} 章尚未加料（将按原文导出）。是否继续？`)) return;
        }
    }

    const metaTitle = S.enrichFileMeta?.name
        ? String(S.enrichFileMeta.name).replace(/\.(txt|md|markdown|epub)$/i, '')
        : '';
    const title = String(q('#ni-e-exp-title')?.value || '').trim() || metaTitle || '未命名小说';
    const author = String(q('#ni-e-exp-author')?.value || '').trim();

    const modeSuffix = mode === 'original' ? '（原文）' : mode === 'compare' ? '（对照）' : '（加料版）';
    const base = niSafeFileName(title, 'novel');
    let blob;
    let fileName;
    try {
        if (format === 'epub') {
            const bytes = niBuildExportEpub(list, { title, author });
            blob = new Blob([bytes], { type: 'application/epub+zip' });
            fileName = `${base}${modeSuffix}.epub`;
        } else if (format === 'md') {
            blob = new Blob([niBuildExportMarkdown(list, { title, author, mode })], { type: 'text/markdown;charset=utf-8' });
            fileName = `${base}${modeSuffix}.md`;
        } else {
            blob = new Blob([niBuildExportText(list, { title, author, mode })], { type: 'text/plain;charset=utf-8' });
            fileName = `${base}${modeSuffix}.txt`;
        }
    } catch (err) {
        toastr?.error(`导出失败：${err?.message || err}`);
        return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    // TauriTavern 移动端由同源窗口下载桥转原生落盘；桌面为浏览器下载
    if (isMobile) toastr?.success(`已导出 ${list.length} 章 → ${fileName}（已走系统下载，请在「文件管理/下载」中查看）`);
    else toastr?.success(`已导出 ${list.length} 章 → ${fileName}`);
}

function niEnrichSyncButtons(running) {
    const startBtn = q('#ni-btn-enrich');
    const pauseBtn = q('#ni-btn-enrich-pause');
    const skipBtn = q('#ni-btn-enrich-skip');
    const cancelBtn = q('#ni-btn-enrich-cancel');
    const retryBtn = q('#ni-btn-enrich-retry');
    if (!startBtn) return;
    if (running) {
        startBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'inline-flex';
        if (skipBtn) skipBtn.style.display = 'inline-flex';
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    } else {
        startBtn.style.display = 'inline-flex';
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (skipBtn) skipBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (retryBtn) {
            const failedCount = (Array.isArray(S.enrichChapters) ? S.enrichChapters : []).filter(ch => ch.status === CHAPTER_STATUS.FAILED).length;
            retryBtn.style.display = failedCount > 0 ? 'inline-flex' : 'none';
            retryBtn.textContent = failedCount > 0 ? `重试失败(${failedCount})` : '重试失败';
        }
    }
}

// —— 模板管理 UI ——
function niEnrichRenderTemplateSelect() {
    const sel = q('#ni-e-template-sel');
    if (!sel) return;
    const templates = niEnrichTemplates();
    sel.innerHTML = templates.map(t => `<option value="${niEscAttr(t.id)}">${niEscHtml(t.name || t.id)}</option>`).join('');
    const curId = niEnrichParams().templateId;
    sel.value = curId && templates.some(t => t.id === curId) ? curId : (templates[0]?.id || '');
    niEnrichRenderTemplateEditor();
}

function niEnrichRenderTemplateEditor() {
    const sel = q('#ni-e-template-sel');
    if (!sel) return;
    const t = niEnrichTemplates().find(x => x.id === sel.value);
    if (!t) return;
    sv('#ni-e-tpl-name', t.name || '');
    sv('#ni-e-tpl-desc', t.description || '');
    const pt = q('#ni-e-tpl-prompt');
    if (pt) pt.value = t.prompt || '';
}

function niEnrichSaveTemplateFromUI() {
    const sel = q('#ni-e-template-sel');
    if (!sel?.value) return;
    const templates = niEnrichTemplates();
    const t = templates.find(x => x.id === sel.value);
    if (!t) return;
    t.name = String(q('#ni-e-tpl-name')?.value || '').trim() || t.name;
    t.description = String(q('#ni-e-tpl-desc')?.value || '').trim();
    t.prompt = String(q('#ni-e-tpl-prompt')?.value || '');
    niEnrichSaveTemplates(templates);
}

// —— 设置同步 ——
/** 同步加料 API 来源 UI：两个独立勾选（使用酒馆主预设 / 独立 API 配置），可同时勾选或同时取消。 */
function niEnrichSyncTavernUI(usePreset, useIndependent) {
    const indBox = q('#ni-e-api-ind-box');
    const tvBox = q('#ni-e-api-tavern-box');
    if (indBox) indBox.style.display = useIndependent ? '' : 'none';
    if (tvBox) tvBox.style.display = usePreset ? '' : 'none';
    const indChk = q('#ni-e-api-ind');
    const tvChk = q('#ni-e-api-tavern');
    if (indChk) indChk.checked = !!useIndependent;
    if (tvChk) tvChk.checked = !!usePreset;
    // 独立未勾选时禁用地址/Key/模型输入（避免误填）
    ['#ni-e-api-url', '#ni-e-api-key', '#ni-e-api-model'].forEach(sel => {
        const el = q(sel);
        if (el) el.disabled = !useIndependent;
    });
}

function niEnrichSyncSettingsUI() {
    const api = niEnrichApiCfg();
    const params = niEnrichParams();
    const safety = niEnrichSafety();
    sv('#ni-e-api-url', api.url || '');
    sv('#ni-e-api-key', api.key || '');
    sv('#ni-e-api-model', api.model || '');
    const streamEl = q('#ni-e-api-stream');
    if (streamEl) streamEl.checked = api.stream !== false;
    sv('#ni-e-api-temp', api.temperature ?? 0.9);
    sv('#ni-e-api-topp', api.topP ?? 1);
    sv('#ni-e-api-timeout', api.timeoutSec ?? 120);
    sv('#ni-e-api-retries', api.retries ?? 2);
    sv('#ni-e-concurrency', extension_settings[EXT_NAME]?.enrichConcurrency ?? DEFAULT_SETTINGS.enrichConcurrency);
    sv('#ni-e-rate-limit', extension_settings[EXT_NAME]?.enrichRateLimit ?? DEFAULT_SETTINGS.enrichRateLimit);
    sv('#ni-e-api-quota', api.dailyQuota ?? 0);
    const usedEl = q('#ni-e-api-quota-used');
    if (usedEl) usedEl.textContent = String(niEnrichDailyUsed());
    niEnrichSyncTavernUI(api.useTavernPreset === true, api.useIndependentApi === true);
    sv('#ni-e-intensity', params.intensity || 'medium');
    sv('#ni-e-max-tokens', params.maxTokens ?? 4000);
    const maxAutoEl = q('#ni-e-max-auto');
    if (maxAutoEl) maxAutoEl.checked = params.maxTokensAuto !== false;
    sv('#ni-e-min-chars', params.minChars ?? ENRICH_MIN_CHARS);
    const enforceMinEl = q('#ni-e-enforce-min');
    if (enforceMinEl) enforceMinEl.checked = params.enforceMinChars !== false;
    const safetyEl = q('#ni-e-safety-enabled');
    if (safetyEl) safetyEl.checked = safety.enabled !== false;
    const wordsEl = q('#ni-e-safety-words');
    if (wordsEl) wordsEl.value = (safety.sensitiveWords || []).join('\n');
    niEnrichRenderTemplateSelect();
}

jQuery(async () => {
  try {

    // ── 动态注入小说库书卡样式─────
    {
        let s = document.getElementById('ni-book-grid-style');
        if (!s) { s = document.createElement('style'); s.id = 'ni-book-grid-style'; document.head.appendChild(s); }
        s.textContent = `
.ni-book-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:4px;align-items:start}
.ni-book-card{border:1.5px solid #aaa !important;border-radius:var(--border-radius-md);background:var(--color-background-secondary);padding:10px 10px 8px;cursor:default;transition:border-color .15s;display:flex;flex-direction:column}
.ni-book-card:hover{border-color:#888 !important}
.ni-book-card-active{border-color:rgba(160,68,94,.8)!important}
.ni-book-card-accent{height:3px;border-radius:2px;margin-bottom:9px;opacity:.56}
.ni-book-card-name-row{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:6px}
.ni-book-card-name{font-size:12px;font-weight:500;color:var(--color-text-primary);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin-bottom:0}
.ni-book-card-footer{display:flex;align-items:center;justify-content:flex-end;padding-top:3px;border-top:none;margin-top:auto}
.ni-book-card-pill{font-size:10px;padding:2px 5px;border-radius:999px;background:var(--ni-primary-alpha-12, rgba(160,68,94,.12));color:var(--ni-primary, #A0445E);font-weight:500;white-space:nowrap;flex-shrink:0}
.ni-book-card-acts{display:flex;gap:2px}
.ni-book-card-btn{width:22px;height:22px;border-radius:4px;border:none;background:transparent;color:var(--color-text-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:background .12s,color .12s}
.ni-book-card-btn:hover{background:var(--color-background-primary);color:var(--color-text-secondary)}
.ni-book-card-del:hover{color:rgba(192,57,43,.9)!important}
        `;
    }

    // ── 动态注入世界设定样式─────────
    {
        let ws = document.getElementById('ni-world-override-style');
        if (!ws) { ws = document.createElement('style'); ws.id = 'ni-world-override-style'; document.head.appendChild(ws); }
        ws.textContent = `
#ni-world-card{border:.5px solid var(--color-border-tertiary)!important;box-shadow:none!important;padding:8px 13px!important}
.ni-world-add-cat{margin-top:10px!important;width:100%!important;background:none!important;border:none!important;box-shadow:none!important;border-radius:0!important;padding:6px 0!important;cursor:pointer!important;color:var(--color-text-tertiary)!important;font-size:11px!important;display:inline-flex!important;align-items:center!important;justify-content:flex-start!important;gap:4px!important;min-height:unset!important;height:auto!important;margin-left:0!important;text-transform:none!important}
.ni-world-add-cat:hover{color:var(--ni-primary, #A0445E)!important;background:none!important}
.ni-world-gen-row{margin-bottom:8px!important;display:flex!important;justify-content:flex-end!important}
.ni-world-gen-all-btn{display:inline-flex!important;align-items:center!important;gap:4px!important;font-size:11px!important;font-weight:500!important;color:var(--ni-primary-focus, #B8336A)!important;border:0.5px solid var(--ni-primary-border-strong, #f4c0d1)!important;border-radius:4px!important;padding:2px 8px!important;background:transparent!important;cursor:pointer!important;white-space:nowrap!important;width:auto!important;min-height:unset!important;height:auto!important;margin:0!important;box-shadow:none!important;text-transform:none!important;letter-spacing:0!important}
.ni-world-gen-all-btn:hover{background:var(--ni-primary-soft-2, #fbeaf0)!important}
.ni-world-gen-all-btn i{font-size:12px!important}
.ni-world-regen,.ni-world-edit{background:none!important;border:none!important;box-shadow:none!important;border-radius:3px!important;padding:2px 5px!important;cursor:pointer!important;color:var(--color-text-tertiary)!important;font-size:11px!important;display:inline-flex!important;align-items:center!important;gap:3px!important;white-space:nowrap!important;width:auto!important;min-height:unset!important;height:auto!important;margin:0!important;font-weight:400!important;text-transform:none!important}
.ni-world-regen:hover,.ni-world-edit:hover{color:var(--ni-primary, #A0445E)!important;background:none!important}
.ni-world-regen:disabled{opacity:.4!important;pointer-events:none!important}
.ni-world-toggle{background:none!important;border:none!important;box-shadow:none!important;border-radius:3px!important;padding:2px 4px!important;cursor:pointer!important;color:var(--color-text-tertiary)!important;font-size:13px!important;line-height:1!important;display:inline-flex!important;align-items:center!important;flex-shrink:0!important;opacity:0.5!important;width:auto!important;min-height:unset!important;height:auto!important;margin:0!important}
.ni-world-toggle.on{color:var(--ni-primary, #A0445E)!important;opacity:1!important}
.ni-world-toggle:hover{opacity:1!important}
        `;
    }

    // ── 顶栏 Drawer───────────
    const settingsHtml = await renderExtensionTemplateAsync(EXT_FOLDER, 'template');

    // 插入顶栏抽屉
    const drawerHtml = `
      <div id="ni_drawer" class="drawer">
        <div class="drawer-toggle">
          <div id="ni_drawer_icon"
               class="drawer-icon fa-solid fa-book-open fa-fw closedIcon interactable"
               title="Novel Injector - 小说注入"
               tabindex="0">
          </div>
        </div>
        <div id="ni_drawer_content" class="drawer-content closedDrawer" style="padding:0;">
          ${settingsHtml}
        </div>
      </div>`;

    // 插入到扩展按钮之前
    const extensionsBtn = document.querySelector('.drawer-icon.fa-solid.fa-cubes');
    const extensionsDrawer = extensionsBtn?.closest('.drawer');
    if (extensionsDrawer) {
        extensionsDrawer.before($(drawerHtml)[0]);
    } else {
        // fallback：跟在已有插件抽屉最后，或扩展按钮后
        const existingDrawers = $('#extensions-settings-button').nextAll('.drawer');
        if (existingDrawers.length) {
            existingDrawers.last().after(drawerHtml);
        } else {
            $('#extensions-settings-button').after(drawerHtml);
        }
    }
    niBindTopbarIconToggleHandlers();
    // 底栏导航与弹窗操作按钮立即全局绑定（即使后续初始化抛错，这些控件仍可用）
    niBindNavbarGlobal();
    niBindGlobalActions();

    // ── 在 template 插入 DOM 后，立即将 FAB/popup 挂到 body ──
    if (typeof window.niPopBootstrap === 'function') {
        window.niPopBootstrap();
    }

    // 绑定图标点击
    let _niNavbarClick = null;
    try {
        const scriptModule = await import('/script.js');
        if (scriptModule.doNavbarIconClick) _niNavbarClick = scriptModule.doNavbarIconClick;
    } catch (_) {}

    const niToggle = $('#ni_drawer .drawer-toggle');
    if (typeof _niNavbarClick === 'function') {
        // 新版酒馆：直接把整个 toggle div 的点击交给酒馆处理
        niToggle.on('click', _niNavbarClick);
    } else {
        // 旧版酒馆：手动开关
        $('#ni_drawer_content').attr('data-slide-toggle', 'hidden').css('display', 'none');
        niToggle.on('click', function () {
            const icon    = $('#ni_drawer_icon');
            const content = $('#ni_drawer_content');
            if (icon.hasClass('closedIcon')) {
                // 关闭其他已打开的 drawer
                $('.openDrawer').not('#ni_drawer_content').not('.pinnedOpen')
                    .removeClass('openDrawer').addClass('closedDrawer').hide();
                $('.openIcon').not('#ni_drawer_icon').not('.drawerPinnedOpen')
                    .removeClass('openIcon').addClass('closedIcon');
                icon.removeClass('closedIcon').addClass('openIcon');
                content.removeClass('closedDrawer').addClass('openDrawer').css('display', '');
            } else {
                icon.removeClass('openIcon').addClass('closedIcon');
                content.removeClass('openDrawer').addClass('closedDrawer').css('display', 'none');
            }
        });
    }



    // ── 用 jQuery 事件绑定替代模板中的 inline handlers ──────────
    const $app = $('#ni-app');
    q('#ni-fi')?.setAttribute('accept', NI_UPLOAD_ACCEPT);
    q('#ni-u-label') && (q('#ni-u-label').textContent = NI_UPLOAD_LABEL);
    q('#ni-u-hint') && (q('#ni-u-hint').textContent = NI_UPLOAD_HINT);

    // 上传区点击 / 拖拽
    $app.on('click', '#ni-uz', () => document.getElementById('ni-fi').click());
    $app.on('dragover', '#ni-uz', e => e.preventDefault());
    $app.on('drop', '#ni-uz', e => { e.preventDefault(); niOnDrop(e.originalEvent); });
    $app.on('change', '#ni-fi', function() { niOnFile(this); });

    // ── 加料页：导入与章节 ──
    $app.on('click', '#ni-euz', () => q('#ni-e-fi')?.click());
    $app.on('dragover', '#ni-euz', e => e.preventDefault());
    $app.on('drop', '#ni-euz', e => {
        e.preventDefault();
        const f = e.originalEvent?.dataTransfer?.files?.[0];
        if (f) niEnrichApplyFile(f);
        else toastr?.warning('请拖入 .txt / .epub / .md 文件');
    });
    $app.on('change', '#ni-e-fi', function () {
        const f = this.files?.[0];
        if (f) niEnrichApplyFile(f);
        this.value = '';
    });
    $app.on('change', '#ni-e-threshold', function () {
        niEnrichSaveCfg({ threshold: Math.max(0, parseInt(this.value, 10) || 0) });
    });
    $app.on('click', '#ni-e-apply-filter', () => niEnrichRefilter());
    $app.on('click', '#ni-e-view-report', () => { niEnrichRenderReport(); q('#ni-e-report-modal').style.display = 'flex'; });
    // 报告弹窗按钮（关闭/恢复选中）由 niBindGlobalActions() 全局分发
    $app.on('click', '#ni-e-select-all', () => niEnrichSelectAll());
    $app.on('click', '#ni-e-select-invert', () => niEnrichSelectInvert());
    $app.on('click', '#ni-e-merge', () => niEnrichMergeSelected());
    $app.on('click', '#ni-e-del', () => niEnrichDeleteSelected());
    $app.on('change', '.ni-e-chk', function () {
        niEnrichToggleSelect(this.dataset.id, this.checked);
    });
    $app.on('click', '.ni-e-row .ni-e-title', function () {
        niEnrichOpenDetail(this.dataset.id);
    });
    $app.on('click', '.ni-e-act', async function () {
        const act = this.dataset.act;
        const id = this.dataset.id;
        if (act === 'view' && id) {
            niEnrichOpenDetail(id);
        } else if (act === 'del' && id) {
            if (!confirm('确定删除该章节？此操作不可撤销。')) return;
            const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
            const idx = chapters.findIndex(c => c.id === id);
            if (idx >= 0) {
                deleteChapters(chapters, [idx]);
                S.enrichSelected?.delete(id);
                S.enrichReport = buildChapterImportReport(chapters, niEnrichCfg().threshold);
                niEnrichRenderList();
                toastr?.success('章节已删除');
                niEnrichScheduleSave();
            }
        } else if (act === 'judge' && id) {
            if (niJudgeQueue?.isRunning?.()) { toastr?.warning('批量判定运行中，请先暂停或等待完成，再单独判定'); return; }
            const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
            const ch = chapters.find(c => c.id === id);
            if (!ch || !niEnrichCanJudge(ch)) return;
            this.disabled = true;
            try {
                const judge = await judgeChapter(ch);
                niEnrichRenderList();
                niJudgeRenderStats();
                niJudgeSyncButtons(false);
                toastr?.success(`「${ch.title}」判定完成：${judgeResultLabel(judge?.result)}`);
            } catch (err) {
                if (err?.message !== 'AbortError') toastr?.error(`判定失败：${err?.message || err}`);
                niEnrichRenderList();
                niJudgeRenderStats();
            } finally {
                this.disabled = false;
            }
        } else if (act === 'rejudge' && id) {
            if (niJudgeQueue?.isRunning?.()) { toastr?.warning('批量判定运行中，请先暂停或等待完成，再单独重判'); return; }
            const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
            const ch = chapters.find(c => c.id === id);
            if (!ch) return;
            this.disabled = true;
            try {
                niEnrichResetForRejudge(ch);
                niEnrichScheduleSave();
                const judge = await judgeChapter(ch);
                niEnrichRenderList();
                niJudgeRenderStats();
                niJudgeSyncButtons(false);
                toastr?.success(`「${ch.title}」重新判定完成：${judgeResultLabel(judge?.result)}`);
            } catch (err) {
                if (err?.message !== 'AbortError') toastr?.error(`重新判定失败：${err?.message || err}`);
                niEnrichRenderList();
                niJudgeRenderStats();
            } finally {
                this.disabled = false;
            }
        } else if (act === 'enrich' && id) {
            if (niEnrichQueue?.isRunning?.()) { toastr?.warning('批量加料运行中，请先暂停或等待完成，再单独加料'); return; }
            const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
            const ch = chapters.find(c => c.id === id);
            if (!ch || !canEnrichChapter(ch)) { toastr?.warning('本章无加料资格（需判定为「是/存疑」或标记「通过」）'); return; }
            this.disabled = true;
            try {
                const result = await enrichChapter(ch);
                niEnrichRenderList();
                niEnrichRenderStats();
                niEnrichSyncButtons(false);
                if (result?.noContent) toastr?.info(`「${ch.title}」无可加料内容，已跳过（保留原文）`);
                else if (result?.underMin) toastr?.warning(`「${ch.title}」加料字数不足 ${Math.max(0, Number(niEnrichParams().minChars) || ENRICH_MIN_CHARS)} 字（实际 ${result.charCount} 字），已按强制字数要求标记失败；可重试或手动补写`);
                else if (result?.short) toastr?.warning(`「${ch.title}」加料完成，但仅 ${result.charCount} 字（要求 ≥${Math.max(0, Number(niEnrichParams().minChars) || ENRICH_MIN_CHARS)} 字），建议重新生成`);
                else toastr?.success(result.reviewed ? `「${ch.title}」加料完成` : `「${ch.title}」加料完成，内容含敏感词需审核`);
            } catch (err) {
                if (err?.message !== 'AbortError') toastr?.error(`加料失败：${err?.message || err}`);
                niEnrichRenderList();
                niEnrichRenderStats();
            } finally {
                this.disabled = false;
            }
        } else if (this.dataset.hist !== undefined) {
            q('#ni-e-fi')?.click();
        }
    });
    // 详情弹窗按钮（取消/保存/拆分/生成/停止）由 niBindGlobalActions() 全局分发
    const _niEnrichThresholdEl = q('#ni-e-threshold');
    if (_niEnrichThresholdEl) _niEnrichThresholdEl.value = String(niEnrichCfg().threshold);
    niEnrichRenderList();
    niEnrichRenderHistory();

    // ── 加料页：快捷键开关 + 全局按键 + 章节数据恢复 ──
    const _niEnrichShortcutsEl = q('#ni-e-shortcuts-chk');
    if (_niEnrichShortcutsEl) {
        _niEnrichShortcutsEl.checked = extension_settings[EXT_NAME]?.enrichShortcutsEnabled !== false;
        $app.on('change', '#ni-e-shortcuts-chk', function () {
            const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
            cfg.enrichShortcutsEnabled = this.checked;
            saveSettingsDebounced?.();
        });
    }
    document.addEventListener('keydown', niEnrichOnKeyDown);
    niEnrichTryRestore();

    // ── 判定卡片（工具栏按钮已由 niBindGlobalActions() 全局分发，见 niBindGlobalActions）──
    $app.on('click', '#ni-j-cfg-btn', () => niTogglePanel('ni-j-settings', 'ni-j-cfg-btn'));

    // 判定引擎（并列勾选：关键词/AI/批量）
    $app.on('change', '#ni-j-engine-keyword, #ni-j-engine-ai, #ni-j-engine-batch, #ni-j-ai-scope', function () {
        const anyEngine = q('#ni-j-engine-keyword')?.checked || q('#ni-j-engine-ai')?.checked || q('#ni-j-engine-batch')?.checked;
        if (!anyEngine) {
            toastr?.warning('至少勾选一个判定引擎，已恢复「关键词判定」');
            niJudgeSaveRules({ mode: 'keyword' });
            niJudgeSyncModeUI('keyword');
            niJudgeSyncButtons(false);
            return;
        }
        if (niJudgeQueue?.isRunning?.()) {
            toastr?.warning('判定队列运行中，新组合将在下次「开始判定」时生效；如需立即生效请先暂停');
        }
        const mode = niJudgeModeFromEngines();
        niJudgeSaveRules({ mode });
        niJudgeSyncModeUI(mode);
        niJudgeSyncButtons(false);
    });
    $app.on('change', '#ni-j-threshold', function () {
        niJudgeSaveRules({ threshold: Math.max(0, parseInt(this.value, 10) || 0) });
    });
    $app.on('change', '#ni-j-ai-threshold', function () {
        niJudgeSaveRules({ aiThreshold: Math.max(0, Math.min(1, parseFloat(this.value) || 0)) });
    });
    // 附加特征开关
    $app.on('change', '#ni-j-feat-cooccur, #ni-j-feat-paragraph, #ni-j-feat-ellipsis, #ni-j-feat-metaphor', () => {
        const rules = niJudgeRules();
        const feat = { ...(rules.features || {}) };
        feat.cooccur = q('#ni-j-feat-cooccur')?.checked !== false;
        feat.paragraph = q('#ni-j-feat-paragraph')?.checked !== false;
        feat.ellipsis = q('#ni-j-feat-ellipsis')?.checked !== false;
        feat.metaphorDownweight = q('#ni-j-feat-metaphor')?.checked !== false;
        niJudgeSaveRules({ features: feat });
    });

    // 关键词/正则编辑
    $app.on('change', '#ni-j-keywords input', () => niJudgeSaveRules({ keywords: niJudgeReadRulesFromUI().keywords }));
    $app.on('change', '#ni-j-regexes input', () => niJudgeSaveRules({ regexes: niJudgeReadRulesFromUI().regexes }));
    $app.on('click', '[data-kw-del]', function () {
        const rules = niJudgeRules();
        rules.keywords.splice(Number(this.dataset.kwDel), 1);
        niJudgeSaveRules({ keywords: rules.keywords });
        niJudgeRenderKeywords();
    });
    $app.on('click', '[data-rx-del]', function () {
        const rules = niJudgeRules();
        rules.regexes.splice(Number(this.dataset.rxDel), 1);
        niJudgeSaveRules({ regexes: rules.regexes });
        niJudgeRenderRegexes();
    });
    $app.on('click', '#ni-j-kw-add', () => {
        const rules = niJudgeRules();
        rules.keywords.push({ word: '', weight: 1 });
        niJudgeSaveRules({ keywords: rules.keywords });
        niJudgeRenderKeywords();
        const words = qa('#ni-j-keywords .ni-j-rule-word');
        words[words.length - 1]?.focus();
    });
    $app.on('click', '#ni-j-rx-add', () => {
        const rules = niJudgeRules();
        rules.regexes.push({ pattern: '', weight: 1 });
        niJudgeSaveRules({ regexes: rules.regexes });
        niJudgeRenderRegexes();
        const rx = qa('#ni-j-regexes .ni-j-rule-regex');
        rx[rx.length - 1]?.focus();
    });

    // 规则导入/导出
    $app.on('click', '#ni-j-rules-export', () => {
        const blob = new Blob([JSON.stringify(niJudgeRules(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '判定规则.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });
    $app.on('click', '#ni-j-rules-import', () => q('#ni-j-rules-file')?.click());
    $app.on('change', '#ni-j-rules-file', async function () {
        const f = this.files?.[0];
        this.value = '';
        if (!f) return;
        try {
            const obj = JSON.parse(await f.text());
            const next = { ...niJudgeRules() };
            if (Array.isArray(obj.keywords)) {
                next.keywords = obj.keywords.filter(k => k?.word).map(k => ({ word: String(k.word), weight: Number(k.weight) || 0 }));
            }
            if (Array.isArray(obj.regexes)) {
                next.regexes = obj.regexes.filter(r => r?.pattern).map(r => ({ pattern: String(r.pattern), weight: Number(r.weight) || 0 }));
            }
            if (['ai', 'keyword', 'hybrid', 'hybrid_all', 'batch'].includes(obj.mode)) next.mode = obj.mode;
            if (Number(obj.threshold) > 0) next.threshold = Number(obj.threshold);
            if (Number(obj.aiThreshold) >= 0) next.aiThreshold = Number(obj.aiThreshold);
            niJudgeSaveRules(next);
            niJudgeSyncSettingsUI();
            toastr?.success('规则已导入');
        } catch (e) {
            toastr?.error(`规则导入失败：${e?.message || e}`);
        }
    });

    // 判定 API 面板
    $app.on('change', '#ni-j-api-url', function () { niJudgeSaveApi({ url: this.value.trim() }); });
    $app.on('change', '#ni-j-api-key', function () { niJudgeSaveApi({ key: this.value }); });
    $app.on('change', '#ni-j-api-model', function () { niJudgeSaveApi({ model: this.value.trim() }); });
    $app.on('change', '#ni-j-api-stream', function () { niJudgeSaveApi({ stream: this.checked }); });
    $app.on('change', '#ni-j-api-timeout', function () { niJudgeSaveApi({ timeoutSec: Math.max(5, parseInt(this.value, 10) || 60) }); });
    $app.on('change', '#ni-j-api-retries', function () { niJudgeSaveApi({ retries: Math.max(0, Math.min(10, parseInt(this.value, 10) || 0)) }); });
    $app.on('change', '#ni-j-concurrency', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.judgeConcurrency = Math.max(1, Math.min(16, parseInt(this.value, 10) || 1));
        saveSettingsDebounced?.();
        toastr?.info(`判定并发已设为 ${cfg.judgeConcurrency}（下次「开始判定」生效）`);
    });
    $app.on('change', '#ni-j-rate-limit', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.judgeRateLimit = Math.max(0, Math.min(600, parseInt(this.value, 10) || 0));
        saveSettingsDebounced?.();
    });
    $app.on('change', '#ni-j-prompt', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.judgePrompts = { ...(cfg.judgePrompts || {}), template: this.value };
        saveSettingsDebounced?.();
    });
    $app.on('change', '#ni-j-batch-size', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.sceneConfig = { ...niSceneConfig(), batch_chapters_per_call: Math.max(1, Math.min(50, parseInt(this.value, 10) || 10)) };
        saveSettingsDebounced?.();
    });
    $app.on('change', '#ni-j-batch-prompt', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.judgePrompts = { ...(cfg.judgePrompts || {}), batchTemplate: this.value };
        saveSettingsDebounced?.();
    });
    $app.on('click', '#ni-j-api-models', async () => {
        const api = niJudgeApiCfg();
        if (!api.url) { toastr?.warning('请先填写判定 API 地址'); return; }
        await niLoadModelList({
            url: api.url, key: api.key,
            setBusy: busy => { const b = q('#ni-j-api-models'); if (b) b.disabled = busy; },
            showAlert: msg => toastr?.warning(msg),
            onModels: models => niApplyModelListToControls({
                models,
                selectElement: q('#ni-j-api-model-sel'),
                textInputElement: q('#ni-j-api-model'),
                onSelected: model => niJudgeSaveApi({ model }),
            }),
        });
    });
    $app.on('click', '#ni-j-api-test', async () => {
        const api = niJudgeApiCfg();
        if (!api.url) { toastr?.warning('请先填写判定 API 地址'); return; }
        const btn = q('#ni-j-api-test');
        if (btn) btn.disabled = true;
        try {
            const models = await niFetchModelIds({ url: api.url, key: api.key });
            toastr?.success(models.length ? `连接成功，可用模型 ${models.length} 个（可点「刷新模型」选择）` : '连接成功，但接口未返回模型列表');
        } catch (e) {
            toastr?.error(`连接失败：${e?.message || e}`);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // 判定 UI 初始化
    niJudgeSyncSettingsUI();
    niJudgeRenderStats();
    niJudgeSyncButtons(false);
    niJudgeEnsureQueue();

    // ── 加料卡片（工具栏按钮已由 niBindGlobalActions() 全局分发）──
    $app.on('click', '#ni-e-cfg-btn', () => niTogglePanel('ni-e-settings', 'ni-e-cfg-btn'));

    // 模板选择与编辑
    $app.on('change', '#ni-e-template-sel', function () {
        niEnrichSaveParams({ templateId: this.value });
        niEnrichRenderTemplateEditor();
    });
    $app.on('input', '#ni-e-tpl-name, #ni-e-tpl-desc, #ni-e-tpl-prompt', () => {
        clearTimeout(niEnrichTemplateSaveTimer);
        niEnrichTemplateSaveTimer = setTimeout(() => {
            niEnrichSaveTemplateFromUI();
            niEnrichRenderTemplateSelect();
        }, 500);
    });
    $app.on('click', '#ni-e-tpl-new', () => {
        const templates = niEnrichTemplates();
        const tpl = { id: `custom_${Date.now().toString(36)}`, name: '新模板', description: '', prompt: '' };
        templates.push(tpl);
        niEnrichSaveTemplates(templates);
        niEnrichSaveParams({ templateId: tpl.id });
        niEnrichRenderTemplateSelect();
    });
    $app.on('click', '#ni-e-tpl-del', () => {
        const sel = q('#ni-e-template-sel');
        if (!sel?.value) return;
        if (!confirm('确定删除当前模板？')) return;
        const templates = niEnrichTemplates().filter(t => t.id !== sel.value);
        niEnrichSaveTemplates(templates.length ? templates : DEFAULT_ENRICH_TEMPLATES.map(t => ({ ...t })));
        niEnrichSaveParams({ templateId: templates[0]?.id || '' });
        niEnrichRenderTemplateSelect();
    });
    $app.on('click', '#ni-e-tpl-reset', () => {
        if (!confirm('恢复内置默认模板？当前自定义模板将被覆盖。')) return;
        niEnrichSaveTemplates(DEFAULT_ENRICH_TEMPLATES.map(t => ({ ...t })));
        niEnrichRenderTemplateSelect();
    });

    // 参数
    $app.on('change', '#ni-e-intensity', function () { niEnrichSaveParams({ intensity: this.value }); });
    $app.on('change', '#ni-e-max-tokens', function () {
        niEnrichSaveParams({ maxTokens: Math.min(8000, Math.max(256, parseInt(this.value, 10) || 4000)) });
    });
    $app.on('change', '#ni-e-max-auto', function () { niEnrichSaveParams({ maxTokensAuto: this.checked }); });
    $app.on('change', '#ni-e-min-chars', function () {
        niEnrichSaveParams({ minChars: Math.max(0, parseInt(this.value, 10) || 0) });
    });
    $app.on('change', '#ni-e-enforce-min', function () { niEnrichSaveParams({ enforceMinChars: this.checked }); });

    // 安全过滤
    $app.on('change', '#ni-e-safety-enabled', function () { niEnrichSaveSafety({ enabled: this.checked }); });
    $app.on('change', '#ni-e-safety-words', function () {
        niEnrichSaveSafety({ sensitiveWords: String(this.value || '').split(/\r?\n/).map(w => w.trim()).filter(Boolean) });
    });

    // 加料 API 面板
    $app.on('click', '#ni-e-api-copy-judge', () => {
        const judge = niJudgeApiCfg();
        niEnrichSaveApi({ url: judge.url, key: judge.key, model: judge.model, timeoutSec: judge.timeoutSec || 120 });
        niEnrichSyncSettingsUI();
        toastr?.success('已复制判定 API 配置到加料（流式/温度等参数按加料设置保留）');
    });
    // 导出（P4）
    $app.on('click', '#ni-e-exp-btn', () => niEnrichExport());
    // API 来源（两个独立勾选，可同时勾选或同时取消）
    $app.on('change', '#ni-e-api-tavern', function () {
        const api = niEnrichApiCfg();
        niEnrichSaveApi({ useTavernPreset: this.checked });
        niEnrichSyncTavernUI(this.checked, api.useIndependentApi === true);
        if (this.checked) toastr?.info('已开启使用酒馆主预设：加料将拼入酒馆当前预设提示词');
    });
    $app.on('change', '#ni-e-api-ind', function () {
        const api = niEnrichApiCfg();
        niEnrichSaveApi({ useIndependentApi: this.checked });
        niEnrichSyncTavernUI(api.useTavernPreset === true, this.checked);
        if (!this.checked && api.useTavernPreset !== true) toastr?.warning('两个来源都未勾选：加料时将提示选择 API 来源');
    });
    $app.on('change', '#ni-e-api-url', function () { niEnrichSaveApi({ url: this.value.trim() }); });
    $app.on('change', '#ni-e-api-key', function () { niEnrichSaveApi({ key: this.value }); });
    $app.on('change', '#ni-e-api-model', function () { niEnrichSaveApi({ model: this.value.trim() }); });
    $app.on('change', '#ni-e-api-stream', function () { niEnrichSaveApi({ stream: this.checked }); });
    $app.on('change', '#ni-e-api-temp', function () { niEnrichSaveApi({ temperature: Math.max(0, Math.min(2, parseFloat(this.value) || 0)) }); });
    $app.on('change', '#ni-e-api-topp', function () { niEnrichSaveApi({ topP: Math.max(0, Math.min(1, parseFloat(this.value) || 0)) }); });
    $app.on('change', '#ni-e-api-timeout', function () { niEnrichSaveApi({ timeoutSec: Math.max(5, parseInt(this.value, 10) || 120) }); });
    $app.on('change', '#ni-e-api-retries', function () { niEnrichSaveApi({ retries: Math.max(0, Math.min(10, parseInt(this.value, 10) || 0)) }); });
    $app.on('change', '#ni-e-api-quota', function () { niEnrichSaveApi({ dailyQuota: Math.max(0, parseInt(this.value, 10) || 0) }); });
    $app.on('change', '#ni-e-concurrency', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.enrichConcurrency = Math.max(1, Math.min(8, parseInt(this.value, 10) || 1));
        saveSettingsDebounced?.();
        toastr?.info(`加料并发已设为 ${cfg.enrichConcurrency}（下次「开始加料」生效）`);
    });
    $app.on('change', '#ni-e-rate-limit', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.enrichRateLimit = Math.max(0, Math.min(600, parseInt(this.value, 10) || 0));
        saveSettingsDebounced?.();
    });
    $app.on('click', '#ni-e-api-models', async () => {
        const api = niEnrichApiCfg();
        if (!api.url) { toastr?.warning('请先填写加料 API 地址'); return; }
        await niLoadModelList({
            url: api.url, key: api.key,
            setBusy: busy => { const b = q('#ni-e-api-models'); if (b) b.disabled = busy; },
            showAlert: msg => toastr?.warning(msg),
            onModels: models => niApplyModelListToControls({
                models,
                selectElement: q('#ni-e-api-model-sel'),
                textInputElement: q('#ni-e-api-model'),
                onSelected: model => niEnrichSaveApi({ model }),
            }),
        });
    });
    $app.on('click', '#ni-e-api-test', async () => {
        const api = niEnrichApiCfg();
        if (!api.url) { toastr?.warning('请先填写加料 API 地址'); return; }
        const btn = q('#ni-e-api-test');
        if (btn) btn.disabled = true;
        try {
            const models = await niFetchModelIds({ url: api.url, key: api.key });
            toastr?.success(models.length ? `连接成功，可用模型 ${models.length} 个（可点「刷新模型」选择）` : '连接成功，但接口未返回模型列表');
        } catch (e) {
            toastr?.error(`连接失败：${e?.message || e}`);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // 详情弹窗：生成/停止加料（流式实时追加）
    // 详情弹窗生成/停止：已由 niBindGlobalActions() 全局分发（niEnrichDetailGenerate）

    // 加料 UI 初始化
    niEnrichSyncSettingsUI();
    niEnrichRenderStats();
    niEnrichSyncButtons(false);
    niEnrichEnsureQueue();

    // 清洗区按钮
    $app.on('click', '#ni-clean-cfg-btn', () => niTogglePanel('ni-clean-api', 'ni-clean-cfg-btn'));
    $app.on('click', '#ni-prompt-btn', () => niTogglePrompt());
    $app.on('click', '#ni-btn-clean', () => niHandleCleanButtonClick(true));
    $app.on('contextmenu', '#ni-btn-clean', e => {
        e.preventDefault();
        niHandleCleanButtonClick(false);
    });
    $app.on('click', '#ni-btn-retry', () => niHandleCleanButtonClick(false));
    $app.on('click', '#ni-btn-skip',  () => niSkipChunk());
    $app.on('click', '#ni-btn-pause', () => niPauseClean());
    $app.on('click', '.ni-chunk-run-btn', function() {
        const i = parseInt(this.dataset.chunkIdx);
        if (!isNaN(i)) niRunSingleChunk(i);
    });
    $app.on('input', '#ni-chunk-kb', () => niOnKbChange());
    $app.on('input', '#ni-api-timeout', () => niSaveSettings());
    $app.on('input', '#ni-rate-limit',   () => niSaveSettings());
    $app.on('input', '#ni-api-concurrency', () => niSaveSettings());
    $app.on('input', '#ni-vec-rate-limit', () => niSaveSettings());
    $app.on('input', '#ni-vec-concurrency', () => niSaveSettings());
    $app.on('change', '#ni-vec-batch-size', () => niSaveSettings());

    // 流式开关
    $app.on('change', '#ni-clean-stream', function() {
        niSaveSettings();
    });
    // 自动续跑清洗开关
    $app.on('click', '#ni-clean-auto-resume-btn', function() {
        const cb = q('#ni-clean-auto-resume');
        const pill = q('#ni-clean-auto-resume-pill');
        if (!cb) return;
        cb.checked = !cb.checked;
        if (pill) pill.textContent = cb.checked ? '开' : '关';
        niSaveSettings();
    });
    $app.on('click', '#ni-clean-done-close', () => {
        const modal = q('#ni-clean-done-modal');
        if (modal) modal.style.display = 'none';
    });
    $app.on('click', '#ni-clean-done-modal', function(e) {
        if (e.target === this) this.style.display = 'none';
    });
    $app.on('click', '#ni-stream-btn', function() {
        const cb = q('#ni-clean-stream');
        const pill = q('#ni-stream-pill');
        if (!cb) return;
        cb.checked = !cb.checked;
        if (pill) pill.textContent = cb.checked ? '开' : '关';
        niSaveSettings();
    });

    // 提示词编辑 & 重置
    $app.on('input', '#ni-pt-content', () => niSaveSettings());
    $app.on('click', '#ni-pt-reset', () => {
        const el = q('#ni-pt-content');
        if (el) {
            el.value = CLEAN_PROMPT;
            niSaveSettings();
        }
    });

    // 演绎提示词面板
    $app.on('click', '#ni-stage-prompt-btn', () => niToggleStagePrompt());
    $app.on('click', '#ni-vec-off-btn', () => {
        const cfg = extension_settings[EXT_NAME];
        niSetVectorInjectionDisabledByUser(cfg, !niIsVectorInjectionDisabledByUser(cfg));
        niSaveSettings();
        niUpdateVecOffBtn();
    });

    // 开关：启用/禁用演绎提示词
    $app.on('change', '#ni-stage-pt-enabled', () => {
        const enabled = q('#ni-stage-pt-enabled')?.checked ?? true;
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].roleplayEnabled = enabled;
        niSaveSettings();
        niSyncRoleplayToDepth();
    });

    // 内容变更：自动保存并同步到 depth_prompt_prompt
    $app.on('input', '#ni-stage-pt-content', () => {
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].roleplayPrompt = q('#ni-stage-pt-content')?.value || '';
        niSaveSettings();
        niSyncRoleplayToDepth();
    });

    // 重置默认提示词
    $app.on('click', '#ni-stage-pt-reset', () => {
        const el = q('#ni-stage-pt-content');
        if (el) {
            el.value = ROLEPLAY_PROMPT;
            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
            extension_settings[EXT_NAME].roleplayPrompt = ROLEPLAY_PROMPT;
            niSaveSettings();
            niSyncRoleplayToDepth();
        }
    });

    // 清洗 API 输入框
    $app.on('input', '#ni-clean-key, #ni-clean-url, #ni-clean-model', () => niSaveSettings());
    $app.on('click', '#ni-clean-fetch-models', () =>
        fetchModels('ni-clean-url', 'ni-clean-key', 'ni-clean-model-select', 'ni-clean-model'));
    $app.on('click', '#ni-vec-fetch-models', () =>
        fetchModels('ni-vec-url', 'ni-vec-key', 'ni-vec-model-select', 'ni-vec-model'));

    // 向量化按钮
    $app.on('click', '#ni-vec-cfg-btn', () => niTogglePanel('ni-vec-api', 'ni-vec-cfg-btn'));
    $app.on('click', '#ni-vec-stage-btn', () => niToggleStagePanel());  // 选择阶段 → 展开/收起面板
    $app.on('click', '#ni-btn-vec', () => niStartVec());             // 开始向量化 → 直接用当前勾选
    $app.on('click', '#ni-btn-vec-fill', () => niVecFillMissing());    // 补全缺失向量块

    // 向量化阶段面板内按钮
    $app.on('click', '#ni-vsp-all',     () => { qa('#ni-vec-stage-selector .ni-vec-stage-chk').forEach(c => c.checked = true); });
    $app.on('click', '#ni-vsp-none',    () => { qa('#ni-vec-stage-selector .ni-vec-stage-chk').forEach(c => c.checked = false); });
    $app.on('click', '#ni-vsp-pending', () => {
        qa('#ni-vec-stage-selector .ni-vec-stage-chk').forEach(c => {
            const idx = parseInt(c.value);
            c.checked = !S.stageVecDone[idx];
        });
    });

    $app.on('click', '#ni-vsp-debug', async () => {
        try {
            const chunks = await dbLoadByNovel();
            const stageCount = {};
            const rawFingerprintCount = {};
            chunks.forEach(c => {
                const si = Number(c.stageIdx);
                stageCount[si] = (stageCount[si] || 0) + 1;
                const fingerprint = String(c.fingerprint || '(旧版未记录)');
                rawFingerprintCount[fingerprint] = (rawFingerprintCount[fingerprint] || 0) + 1;
            });
            const fingerprintCount = {};
            for (const [rawFingerprint, count] of Object.entries(rawFingerprintCount)) {
                const fingerprint = rawFingerprint === '(旧版未记录)'
                    ? rawFingerprint
                    : (await niSafeVectorFingerprint(rawFingerprint) || '(摘要不可用)');
                fingerprintCount[fingerprint] = (fingerprintCount[fingerprint] || 0) + count;
            }
            const currentFingerprint = await niSafeVectorFingerprint(getVectorFingerprint());
            const dimensionReport = summarizeVectorCompatibility(chunks);

            let msg = '=== IndexedDB 诊断 ===\n';
            msg += `novelKey: ${S.novelKey || '(空)'}\n`;
            msg += `总向量块数: ${chunks.length}\n`;
            msg += `stageMapN: ${S.stageMapN}\n`;
            msg += `stageVecDone: ${JSON.stringify(S.stageVecDone)}\n\n`;
            if (dimensionReport.dimensions.length) {
                msg += `数据库向量维度: ${dimensionReport.dimensions.map(dimension => `${dimension}维×${dimensionReport.dimensionCounts[dimension]}`).join('，')}\n`;
            }
            if (niQueryVectorCompatibility?.queryDimensions > 0) {
                msg += `最近查询向量维度: ${niQueryVectorCompatibility.queryDimensions}\n`;
            }
            msg += `本机向量配置指纹: ${currentFingerprint || '(摘要不可用)'}\n`;
            if (Object.keys(fingerprintCount).length) {
                msg += '数据库向量来源指纹:\n';
                Object.entries(fingerprintCount).forEach(([fingerprint, n]) => {
                    msg += `  ${fingerprint}: ${n} 块\n`;
                });
            }
            msg += '说明：指纹仅供诊断；跨设备导入或本机切换模型后，已有向量仍会打标并参与召回。\n\n';

            if (chunks.length > 0) {
                msg += '各阶段实际向量块数:\n';
                let hasAnomaly = false;
                Object.entries(stageCount).sort((a,b)=>a[0]-b[0]).forEach(([si, n]) => {
                    msg += `  第${si}阶段: ${n} 块\n`;
                });
                // 检测异常：标记已向量但实际0块
                for (let si = 1; si <= S.stageMapN; si++) {
                    if (S.stageVecDone[si] && !stageCount[si]) {
                        msg += `\n⚠️ 第${si}阶段标记为已向量，但 IndexedDB 中无向量块！\n`;
                        msg += `   可能原因：API 调用失败（Key/地址/模型有误）或限速被截断。\n`;
                        msg += `   建议：检查 API 配置后重新向量化该阶段。\n`;
                        hasAnomaly = true;
                    }
                }
            } else {
                msg += '⚠️ IndexedDB 中没有任何向量数据！\n';
                if (Object.values(S.stageVecDone).some(v => v)) {
                    msg += '   但 stageVecDone 显示已向量——可能是 API 失败被忽略。\n';
                    msg += '   请检查 API 配置后重新向量化。\n';
                }
            }
            const modal = q('#ni-vec-debug-modal');
            const content = q('#ni-vec-debug-content');
            if (modal && content) {
                content.textContent = msg;
                content.scrollTop = 0;
                modal.style.display = 'flex';
            } else {
                alert(msg);
            }
        } catch(e) {
            alert('诊断失败: ' + e.message);
        }
    });

    // 向量诊断弹窗关闭按钮由 niBindGlobalActions() 全局分发；背景点击关闭保留
    $app.on('click', '#ni-vec-debug-modal', function(e) {
        if (e.target === this) this.style.display = 'none';
    });

    $app.on('input', '#ni-vec-key, #ni-vec-url, #ni-vec-model', () => niSaveSettings());
    $app.on('change', '#ni-vec-url, #ni-vec-model', () => {
        niSaveSettings();
        niRefreshCurrentVectorSourceHint().catch(e => console.warn('[NI] 刷新向量来源提示失败:', e));
    });

    // 注入设置折叠
    $app.on('click', '#ni-inj-toggle', () => {
        const body = document.getElementById('ni-inj-body');
        if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
    });
    $app.on('input change', '#ni-inj-depth, #ni-recall-topk, #ni-recall-thresh, #ni-vec-msg-tag, #ni-vec-msg-count, #ni-vec-inj-pos, #ni-vec-inj-role, #ni-char-inj-pos, #ni-char-inj-depth, #ni-char-inj-role, #ni-plot-inj-pos, #ni-plot-inj-depth, #ni-plot-inj-role, #ni-plot-inj-max-tokens, #ni-dev-inj-pos, #ni-dev-inj-depth, #ni-dev-inj-role, #ni-global-head-inj-pos, #ni-global-head-inj-depth, #ni-global-head-inj-role, #ni-global-tail-inj-pos, #ni-global-tail-inj-depth, #ni-global-tail-inj-role', () => niSaveSettings());
    $app.on('input change', '#ni-plot-inj-max-tokens', () => niUpdateStageInjectionBudgetNote());
    $app.on('input change', '#ni-raw-inj-mode', async function() {
        const cfg = extension_settings[EXT_NAME] || {};
        cfg.rawInjMode = niNormalizeRawInjMode(this.value);
        saveSettingsDebounced();
        await niBuildStagesWithChunksIfNeeded();
    }); // 直接采用本次选择，切换后立即刷新 token 估算与注入模式

    // 注入设置手风琴切换
    $app.on('click', '.ni-inj-acc-header', function() {
        const header = $(this);
        const key = header.data('ni-acc');
        const panel = q(`#ni-inj-panel-${key}`);
        const isOpen = header.hasClass('open');
        header.toggleClass('open', !isOpen);
        if (panel) panel.classList.toggle('open', !isOpen);
    });

    // 世界设定注入设置 change
    $app.on('input change', '#ni-world-inj-pos, #ni-world-inj-depth, #ni-world-inj-role', () => niSaveSettings());

    // 世界设定模块：展开/收起
    $app.on('click', '#ni-world-toggle-head', () => {
        const body = q('#ni-world-body-wrap');
        const icon = q('#ni-world-chevron');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
    });

    // 世界设定：AI全部生成
    $app.on('click', '#ni-world-gen-all', () => niWorldGenAll());

    // 世界设定：分类生成提示词
    $app.on('click', '#ni-world-prompt-btn', () => niTogglePanel('ni-world-pb', 'ni-world-prompt-btn'));
    $app.on('input change', '.ni-world-prompt-textarea', function() {
        niWorldSavePrompt(this.value);
    });

    // 世界设定：添加大类
    $app.on('click', '.ni-world-add-cat', () => niWorldAddCat());
    $app.on('click', '.ni-world-remove-btn', () => niWorldDeleteCat());

    // 用户代入角色
    $app.on('click', '#ni-user-sub-cfg-btn', () => {
        niTogglePanel('ni-user-sub-panel', 'ni-user-sub-cfg-btn');
        niRenderUserSubUI();
    });
    $app.on('click', '#ni-user-sub-prompt-btn', () => {
        niTogglePanel('ni-user-sub-pb', 'ni-user-sub-prompt-btn');
        niSyncUserSubPromptPreview();
    });
    $app.on('input change', '#ni-user-sub-prompt-preview', () => {
        niSaveUserSubPromptFromUI();
    });
    $app.on('change', '#ni-user-sub-chk', async function() {
        await niSaveUserSubFromUI({ rerender: true });
        await niPersistUserSubConfig({ immediate: true });
    });
    $app.on('click', '.ni-user-sub-mode-btn', async function() {
        const cfg = niGetUserSubConfig();
        cfg.userSubMode = niNormalizeUserSubMode(this.dataset.userSubMode);
        niRefreshUserSubDependents({ rerenderUserSub: true });
        await niPersistUserSubConfig({ immediate: true });
    });
    // 代入角色可搜索选择器：点开/过滤/选择
    $app.on('click', '#ni-user-sub-char-toggle', function(e) {
        e.stopPropagation();
        niToggleUserSubCharPicker();
    });
    $app.on('click', '#ni-user-sub-char-panel', e => e.stopPropagation());
    $app.on('click', '#ni-user-sub-char-picker .ni-char-picker-option', async function() {
        const cfg = niGetUserSubConfig();
        const idx = this.dataset.charIdx || '';
        niSelectUserSubChar(idx);
        cfg.userSubCharIdx = idx;
        cfg.userSubAliases = niUserSubDefaultAliasesForChar(idx);
        await niSaveUserSubChatStates({});
        niRefreshUserSubDependents({ rerenderUserSub: true });
        await niPersistUserSubConfig({ immediate: true });
    });
    $app.on('input', '#ni-user-sub-char-search', function() {
        niRenderUserSubCharPicker(this.value);
    });
    $app.on('keydown', '#ni-user-sub-char-search', function(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            niCloseUserSubCharPicker();
        } else if (e.key === 'Enter') {
            const first = q('#ni-user-sub-char-list .ni-char-picker-option');
            if (first) {
                e.preventDefault();
                first.click();
            }
        }
    });
    // 点击面板外任意处关闭
    $app.on('click', function(e) {
        if (!e.target.closest?.('#ni-user-sub-char-picker')) niCloseUserSubCharPicker();
    });
    $app.on('click', '#ni-user-sub-add', async function() {
        const cfg = niGetUserSubConfig();
        const c = S.characters[parseInt(cfg.userSubCharIdx, 10)] || null;
        cfg.userSubAliases = niReadUserSubAliasesFromUI();
        cfg.userSubAliases.push({
            text: '',
            firstStage: c ? (getCharFirstStage(c) || '') : '',
            kind: 'custom',
        });
        niRefreshUserSubDependents({ rerenderUserSub: true });
        await niPersistUserSubConfig({ immediate: true });
        const last = q('#ni-user-sub-list .ni-user-sub-row:last-child .ni-user-sub-name');
        last?.focus();
    });
    $app.on('click', '#ni-user-sub-reset', async function() {
        await niSaveUserSubChatStates({});
        niRefreshUserSubDependents({ rerenderUserSub: true });
    });
    $app.on('change', '.ni-user-sub-enabled', async function() {
        const row = this.closest('.ni-user-sub-row');
        await niSaveUserSubRowState(row);
        niRefreshUserSubDependents();
    });
    $app.on('input', '.ni-user-sub-name', () => {
        niSaveUserSubFromUI();
    });
    $app.on('change', '.ni-user-sub-name', async function() {
        const row = this.closest('.ni-user-sub-row');
        await niMigrateUserSubRowState(row);
        niSaveUserSubFromUI();
        await niSaveUserSubRowState(row);
        niRefreshUserSubDependents();
    });
    $app.on('click', '.ni-user-sub-del', async function() {
        const row = this.closest('.ni-user-sub-row');
        await niDeleteUserSubRowState(row);
        row?.remove();
        await niSaveUserSubFromUI({ rerender: true });
        await niPersistUserSubConfig({ immediate: true });
    });

    // 底栏导航：已由 niBindNavbarGlobal() 在模板插入后立即全局绑定（见上），此处不再重复绑定

    // 剧情 tab
    $app.on('click', '#ni-pg-plot .ni-tab', function() {
        const tab = $(this).data('tab');
        if (tab) niSwitchTab(tab, this);
    });

    // 偏差分析
    $app.on('click', '#ni-btn-dev', async () => {
        const result = await niRunDev();
        if (result?.ok) niResetDevAutoCounter();
    });
    $app.on('click', '#ni-dev-cfg-btn', () => {
        niToggleDevCfgPanel();
    });
    $app.on('click', '#ni-dev-prompt-btn', () => {
        niTogglePanel('ni-dev-pb', 'ni-dev-prompt-btn');
    });
    $app.on('click', '#ni-dev-facts-history-btn', function() {
        const panel = q('#ni-dev-facts-history');
        if (!panel) return;
        const open = panel.hidden;
        panel.hidden = !open;
        this.setAttribute('aria-expanded', String(open));
    });
    $app.on('click', '#ni-dev-facts-history-clear', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!Array.isArray(S.devFactHistory) || !S.devFactHistory.length) return;
        if (!confirm('确定清除所有变更记录吗？当前分支事实不会受影响。')) return;
        S.devFactHistory = [];
        await niQueueDeviationGuideSave({ immediate: true });
        niSyncDeviationResultUI({ preserveBody: true });
    });
    $app.on('click', '#ni-dev-facts-edit-toggle', async function() {
        const editing = this.getAttribute('aria-expanded') === 'true';
        if (!editing) {
            this.setAttribute('aria-expanded', 'true');
            this.textContent = '保存';
            niSyncDeviationResultUI({ preserveBody: true });
            const firstInput = q('#ni-dev-facts-list')?.querySelector('.ni-dev-fact-inline-input');
            niResizeDeviationFactInlineInput(firstInput);
            firstInput?.focus();
            return;
        }
        const sections = niUpdateDeviationSectionsFromUI();
        this.setAttribute('aria-expanded', 'false');
        this.textContent = '编辑';
        if (!niBuildDeviationGuideFromSections(sections).trim()) {
            S.devCoveredFloor = 0;
            S.devLastRange = null;
        }
        await niQueueDeviationGuideSave({ immediate: true });
        niSyncDeviationResultUI({ preserveBody: true });
    });
    $app.on('input', '.ni-dev-fact-inline-input', function() {
        niResizeDeviationFactInlineInput(this);
    });
    $app.on('click', '.ni-dev-fact-remove', function(e) {
        e.preventDefault();
        const row = this.closest('.ni-dev-fact-row-editing');
        if (!row) return;
        const nextInput = row.nextElementSibling?.querySelector?.('.ni-dev-fact-inline-input')
            || row.previousElementSibling?.querySelector?.('.ni-dev-fact-inline-input');
        row.remove();
        (nextInput || q('#ni-dev-fact-add'))?.focus();
    });
    $app.on('click', '#ni-dev-fact-add', function(e) {
        e.preventDefault();
        niAppendDeviationFactInlineDraft();
    });
    $app.on('change', '#ni-dev-auto-enabled', async () => {
        niSyncDevAutoUI({ syncNote: true });
        niSaveSettings();
        if (!q('#ni-dev-auto-enabled')?.checked) {
            S.devAutoLastFloor = null;
            return;
        }
        await niStartDevAutoCatchup({ announce: true }).catch(e => {
            console.warn('[NI] 自动偏差分析启动失败:', e);
            const noteEl = q('#ni-dev-note');
            if (noteEl) noteEl.textContent = `自动更新启动失败: ${e.message || e}`;
            return { ok: false, error: e };
        });
    });
    $app.on('input change', '#ni-dev-auto-every, #ni-dev-manual-msg-count', () => {
        niSyncDevAutoUI();
        niSaveSettings();
        niResetDevAutoCounter();
    });
    $app.on('input', '#ni-dev-pt-content', () => niSaveSettings());
    $app.on('click', '#ni-dev-pt-reset', () => {
        const el = q('#ni-dev-pt-content');
        if (el) el.value = DEV_PROMPT;
        niSaveSettings();
    });
    $app.on('input', '#ni-dev-current-constraint, #ni-dev-preserved-facts', function() {
        const sections = niUpdateDeviationSectionsFromUI();
        if (!niBuildDeviationGuideFromSections(sections).trim()) {
            S.devCoveredFloor = 0;
            S.devLastRange = null;
        }
        niSyncDeviationResultUI({ preserveBody: true });
        niQueueDeviationGuideSave();
    });
    $app.on('blur', '#ni-dev-current-constraint, #ni-dev-preserved-facts', async function() {
        const sections = niUpdateDeviationSectionsFromUI();
        if (!niBuildDeviationGuideFromSections(sections).trim()) {
            S.devCoveredFloor = 0;
            S.devLastRange = null;
        }
        await niQueueDeviationGuideSave({ immediate: true });
        niSyncDeviationResultUI({ preserveBody: true });
    });
    $app.on('click', '#ni-dev-retry-btn', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await niRunDev({ retry: true });
    });
    $app.on('click', '#ni-dev-result-toggle', (e) => {
        if (e.target?.closest?.('#ni-dev-retry-btn')) return;
        const body = q('#ni-dev-result-body');
        const btn  = q('#ni-dev-result-toggle > i:last-child');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (btn) btn.className = isOpen ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
    });

    // 剧情tab切换时记录当前tab，并根据是否时间轴隐藏删除/编辑按钮
    $app.on('click', '.ni-plot-tab-row .ni-tab[data-tab]', function() {
        niSetCurrentPlotTab($(this).data('tab') || 'timeline');
        niSyncPlotActionButtons(true);
    });

    $app.on('click', '#ni-plot-link-btn', () => niRepairBranchLinks());
    $app.on('click', '#ni-plot-add-btn', () => {
        const currentPlotTab = niGetCurrentPlotTab();
        const type = ['main','sub','pivot'].includes(currentPlotTab) ? currentPlotTab : 'main';
        niOpenPlotModal('add', type, null);
    });
    // 剧情事件 编辑模式
    $app.on('click', '#ni-plot-edit-btn', () => niTogglePlotEdit());
    // 剧情事件 删除模式
    $app.on('click', '#ni-plot-del-btn', () => niTogglePlotDel());
    // 删除确认/取消
    $app.on('click', '#ni-plot-del-cancel', () => niTogglePlotDel());
    $app.on('click', '#ni-plot-del-confirm', () => {
        niConfirmPlotDel();
    });
    // modal 保存/取消
    $app.on('click', '#ni-plot-modal-save', () => {
        niSavePlotModal();
    });
    $app.on('click', '#ni-plot-modal-cancel', () => niClosePlotModal());
    // modal 点背景关闭
    $app.on('click', '#ni-plot-modal', function(e) {
        if (!e.target.closest?.('#ni-plot-main-picker')) niClosePivotMainPicker();
        if (e.target === this) niClosePlotModal();
    });
    $app.on('click', '#ni-plot-main-picker-toggle', function(e) {
        e.stopPropagation();
        niTogglePivotMainPicker();
    });
    $app.on('click', '#ni-plot-main-picker-panel', e => e.stopPropagation());
    $app.on('input', '#ni-plot-main-picker-search', function() {
        niFilterPivotMainPicker(this.value);
    });
    $app.on('keydown', '#ni-plot-main-picker-search', function(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            niClosePivotMainPicker();
        } else if (e.key === 'Enter') {
            const first = q('#ni-plot-main-picker-list .ni-main-picker-option');
            if (first) {
                e.preventDefault();
                niSelectPivotMain(first.dataset.mainKey || '');
            }
        }
    });
    $app.on('click', '.ni-main-picker-option', function() {
        niSelectPivotMain(this.dataset.mainKey || '');
    });
    // modal 类型按钮
    $app.on('click', '.ni-plot-type-btn', function() {
        qa('.ni-plot-type-btn').forEach(b => b.classList.remove('on'));
        this.classList.add('on');
        const type = $(this).data('ptype');
        niRefreshPlotParentField(type, q('#ni-plot-modal-title-input')?.value.trim() || '');
        niRefreshPivotAfterMainField(type);
        niRefreshPlotInsertField(type);
    });
    // 删除模式：点击事件卡选中
    $app.on('click', '.ni-plot-del-mode .ni-plot-item, .ni-plot-del-mode .ni-tl-item', function(e) {
        e.stopPropagation();
        const el = this;
        // 从id反推 type 和 idx
        const id = el.id; // ni-pi-ni-tp-main-0 或 ni-tl-main-0
        let type = null, idx = null;
        const m1 = id.match(/ni-pi-ni-tp-(main|sub|pivot)-(\d+)/);
        const m2 = id.match(/ni-tl-(main|sub|pivot)-(\d+)/);
        const m = m1 || m2;
        if (m) { type = m[1]; idx = parseInt(m[2]); }
        if (!type) return;
        const key = `${type}:${idx}`;
        el.classList.toggle('ni-plot-selected', niTogglePlotDeleteSelection(key));
    });
    // 编辑模式：点击事件卡弹出编辑框
    $app.on('click', '.ni-plot-edit-mode .ni-plot-item, .ni-plot-edit-mode .ni-tl-item', function(e) {
        e.stopPropagation();
        const id = this.id;
        const m1 = id.match(/ni-pi-ni-tp-(main|sub|pivot)-(\d+)/);
        const m2 = id.match(/ni-tl-(main|sub|pivot)-(\d+)/);
        const m = m1 || m2;
        if (!m) return;
        niTogglePlotEdit(); // 退出编辑模式
        niOpenPlotModal('edit', m[1], parseInt(m[2]));
    });

    // 阶段划分面板按钮
    $app.on('click', '#ni-stage-map-btn', () => niOpenStagePanel());
    $app.on('click', '#ni-sp-ai-btn',     () => niAutoStageByPivot());
    $app.on('click', '.ni-sp-add-btn',    () => niAddStageSlot());
    $app.on('click', '.ni-sp-cancel-btn', () => niCloseStagePanel());
    $app.on('click', '#ni-sp-confirm-btn',() => {
        niConfirmStageMap();
        void niSaveStageRuntimeSettings({ saveMapping: true });
    });

    // 阶段/角色 AI 生成按钮
    $app.on('click', '#ni-btn-gen-chars',  () => niGenCharsManual());
    $app.on('click', '.ni-char-ai-one-btn', function(e) {
        e.preventDefault();
        e.stopPropagation();
        niGenOneCharManual(Number(this.dataset.charIdx));
    });
    $app.on('click', '#ni-btn-gen-stages',       () => niGenStagesManual(false));
    $app.on('click', '#ni-btn-gen-stages-empty', () => niGenStagesManual(true));

    // 角色 Tab 切换
    $app.on('click', '#ni-char-tab-row .ni-tab', function() {
        niSwitchCharTab($(this).data('role'));
    });
    $app.on('change', '#ni-char-page-size', function() {
        niSetCharPageSize(this.value);
    });
    $app.on('change', '#ni-char-page-current', function() {
        niSetCharPage(this.value);
    });
    $app.on('keydown', '#ni-char-page-size, #ni-char-page-current', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (this.id === 'ni-char-page-size') niSetCharPageSize(this.value);
        else niSetCharPage(this.value);
    });
    $app.on('click', '#ni-char-page-prev', () => niChangeCharPage(-1));
    $app.on('click', '#ni-char-page-next', () => niChangeCharPage(1));
    // + 添加角色：打开弹窗
    $app.on('click', '#ni-btn-add-char', () => {
        const modal = q('#ni-add-char-modal');
        if (modal) {
            q('#ni-new-char-name').value = '';
            ['identity','appearance','personality','relations'].forEach(k => {
                const el = q(`#ni-new-char-${k}`);
                if (el) el.value = '';
            });
            const genderEl = q('#ni-new-char-gender');
            if (genderEl) genderEl.value = '';
            // 填充登场阶段选项
            const fsEl = q('#ni-new-char-firststage');
            if (fsEl) {
                fsEl.innerHTML = '<option value="">— 不指定 —</option>' +
                    Array.from({length: S.stageMapN}, (_, k) => k + 1)
                        .map(s => `<option value="${s}">第 ${s} 阶段</option>`).join('');
            }
            modal.style.display = 'flex';
        }
    });
    // 弹窗取消
    $app.on('click', '#ni-add-char-cancel', () => {
        const modal = q('#ni-add-char-modal');
        if (modal) modal.style.display = 'none';
    });
    // 弹窗点背景关闭
    $app.on('click', '#ni-add-char-modal', function(e) {
        if (e.target === this) this.style.display = 'none';
    });
    // 弹窗确认添加
    $app.on('click', '#ni-add-char-confirm', () => {
        const name        = q('#ni-new-char-name')?.value?.trim();
        const role        = q('#ni-new-char-role')?.value || '其他';
        const gender      = q('#ni-new-char-gender')?.value?.trim()      || '';
        const identity    = q('#ni-new-char-identity')?.value?.trim()    || '';
        const appearance  = q('#ni-new-char-appearance')?.value?.trim()  || '';
        const personality = q('#ni-new-char-personality')?.value?.trim() || '';
        const relations   = q('#ni-new-char-relations')?.value?.trim()   || '';
        if (!name) { alert('请输入角色姓名'); return; }
        // 登场阶段 → 反查 stageMap 得到 _firstChunkIdx
        const fsVal = q('#ni-new-char-firststage')?.value;
        const fsStage = fsVal ? parseInt(fsVal) : null;
        let firstChunkIdx = null;
        if (fsStage != null && S.stageMapN > 0) {
            const entry = Object.entries(S.stageMap).find(([, si]) => si === fsStage);
            if (entry) firstChunkIdx = Number(entry[0]);
        }
        S.characters.push({ name, role, gender, identity, appearance, personality, relations, enabled: true, _firstChunkIdx: firstChunkIdx });
        niSaveSettings();
        niSwitchCharTab(role);
        const modal = q('#ni-add-char-modal');
        if (modal) modal.style.display = 'none';
    });
    // - 删除模式切换
    $app.on('click', '#ni-btn-del-char', () => niToggleCharDel());
    // 删除模式：点击角色卡选中/取消
    $app.on('click', '.ni-char-card.ni-del-mode', function(e) {
        // 不拦截内部按钮/checkbox等的点击
        if ($(e.target).closest('button, a, input, label').length) return;
        const idx = parseInt($(this).attr('id').replace('ni-cc-', ''));
        if (isNaN(idx)) return;
        $(this).toggleClass('ni-plot-selected', niToggleCharDeleteSelection(idx));
    });
    // 删除模式：取消
    $app.on('click', '#ni-char-del-cancel-btn', () => niToggleCharDel());
    // 删除模式：确认删除
    $app.on('click', '#ni-char-del-confirm-btn', () => niConfirmCharDel());

    // 动态生成元素的事件委托
    $app.on('click', '.ni-plot-head', function(e) {
        if (niIsPlotInteractionModeActive()) {
            e.preventDefault();
            return;
        }
        niTogglePlot($(this).data('plot-id'));
    });
    // Timeline node toggle
    $app.on('click', '.ni-tl-head', function(e) {
        if (niIsPlotInteractionModeActive()) {
            e.preventDefault();
            return;
        }
        const id = $(this).data('tl-id');
        q(`#${id}`)?.classList.toggle('open');
    });
    // Timeline branch link: jump to sub tab and expand that sub plot
    $app.on('click', '.ni-tl-branch-link', function() {
        const subIdx = parseInt($(this).data('sub-idx'));
        if (!Number.isFinite(subIdx) || subIdx < 0) return;
        const targetPage = niSetPlotPageForPosition('sub', subIdx, { render: false });
        const subTabBtn = q('#ni-pg-plot .ni-plot-tab-row .ni-tab[data-tab="sub"]');
        niSwitchTab('sub', subTabBtn);
        setTimeout(() => {
            if (niGetPlotPage('sub') !== targetPage) return;
            const items = qa('#ni-tp-sub .ni-plot-item');
            items.forEach(el => el.classList.remove('open'));
            const target = q(`#ni-tp-sub .ni-plot-item[data-plot-pos="${subIdx}"]`);
            if (target) {
                target.classList.add('open');
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 60);
    });
    $app.on('click', '.ni-stage-link', function() {
        niJumpToStage(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-char-stage-tag', function() {
        niJumpToStage(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-char-edit-btn', function() {
        niEditChar(parseInt($(this).data('char-idx')));
    });
    $app.on('click', '.ni-char-save-btn', async function() {
        await niSaveChar(parseInt($(this).data('char-idx')));
    });
    $app.on('click', '#ni-char-auto-sleep-btn', function() {
        const cfg = extension_settings[EXT_NAME] || {};
        cfg.charAutoSleepEnabled = !niCharAutoSleepEnabled();
        cfg._charAutoSleepInitialized = true;
        extension_settings[EXT_NAME] = cfg;
        niSyncCharAutoSleepUI();
        saveSettingsDebounced();
    });
    // 单个角色开关
    $app.on('click', '.ni-char-chk', function() {
        const i = parseInt($(this).data('char-idx'));
        if (!S.characters[i]) return;
        if (niIsUserSubReplaceSelectedChar(i)) {
            globalThis.toastr?.info('该角色已由当前聊天的“用户代入角色”替换，原角色人设保持关闭。');
            renderCharacters();
            return;
        }
        const nowOn = !$(this).hasClass('ni-char-chk-on');
        S.characters[i].enabled = nowOn;
        niClearCharAutoSleep(S.characters[i]);
        $(this).toggleClass('ni-char-chk-on', nowOn);
        q(`#ni-cc-${i}`)?.classList.toggle('ni-char-disabled', !nowOn);
        niSaveSettings();
        renderCharacters();
    });
    // 原始人设眼睛
    $app.on('click', '.ni-char-eye-raw', function() {
        const i = parseInt($(this).data('char-idx'));
        if (!S.characters[i]) return;
        S.characters[i].showRaw = S.characters[i].showRaw === false ? true : false;
        niSaveSettings();
        renderCharacters();
    });
    // AI人设眼睛
    $app.on('click', '.ni-char-eye-ai, .ni-char-eye-ai-r', async function() {
        const i = parseInt($(this).data('char-idx'));
        if (!S.characters[i]) return;
        await niSetCharAiShowEnabled(i, !niGetCharAiShowEnabled(i));
        niSaveSettings();
        renderCharacters();
    });
    // 全开当前 tab 角色
    $app.on('click', '#ni-char-enable-all, #ni-char-enable-all-simple', () => {
        const charTab = niGetCurrentCharTab();
        S.characters.forEach(c => { if ((c.role || '其他') === charTab) { c.enabled = true; niClearCharAutoSleep(c); } });
        niSaveSettings(); renderCharacters();
    });
    // 全关当前 tab 角色
    $app.on('click', '#ni-char-disable-all, #ni-char-disable-all-simple', () => {
        const charTab = niGetCurrentCharTab();
        S.characters.forEach(c => { if ((c.role || '其他') === charTab) { c.enabled = false; niClearCharAutoSleep(c); } });
        niSaveSettings(); renderCharacters();
    });
    // 阶段抽屉：触发按钮开关
    $app.on('click', '#ni-drawer-trigger', function(e) {
        e.stopPropagation();
        const panel = q('#ni-drawer-panel');
        const trigger = q('#ni-drawer-trigger');
        if (!panel) return;
        const isOpen = panel.classList.toggle('open');
        trigger.classList.toggle('open', isOpen);
        if (isOpen) niRenderStageDrawer();
        else q('#ni-drawer-list')?.replaceChildren();
    });
    // 阶段抽屉：点击外部关闭
    $(document).on('click.ni-drawer', function(e) {
        const panel = q('#ni-drawer-panel');
        if (!panel || !panel.classList.contains('open')) return;
        const drawer = q('#ni-stage-drawer');
        if (drawer && !drawer.contains(e.target)) {
            panel.classList.remove('open');
            q('#ni-drawer-trigger')?.classList.remove('open');
            q('#ni-drawer-list')?.replaceChildren();
        }
    });
    // 阶段抽屉：全选
    // 阶段抽屉：显示/隐藏空阶段
    $app.on('click', '#ni-drawer-toggle-empty', function(e) {
        e.preventDefault();
        e.stopPropagation();
        niToggleShowEmptyStages();
        niRenderStageDrawer();
    });
    $app.on('click', '#ni-drawer-all', function(e) {
        e.preventDefault();
        e.stopPropagation();
        niToggleAllStageChars(true);
    });
    // 阶段抽屉：全不选
    $app.on('click', '#ni-drawer-none', function(e) {
        e.preventDefault();
        e.stopPropagation();
        niToggleAllStageChars(false);
    });
    // 阶段抽屉：单个阶段 checkbox
    $app.on('change', '.ni-drawer-item input[type=checkbox]', function(e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('drawer-stage'));
        if (!isNaN(idx)) {
            niToggleCharsByStage(idx, this.checked);
            niUpdateStageDrawerNote();  // 只更新文字，不重建列表
        }
    });
    // 阶段抽屉：点击 item 行触发
    $app.on('click', '.ni-drawer-item', function(e) {
        e.stopPropagation();
        // checkbox 和 label 内部点击均交由原生行为 + change 事件处理，不重复处理
        if (e.target.type === 'checkbox' || e.target.closest('label')) return;
        const cb = this.querySelector('input[type=checkbox]');
        if (!cb) return;
        if (cb.disabled) return;
        cb.checked = !cb.checked;
        // 手动触发 change 事件，统一走 change 分支
        $(cb).trigger('change');
    });
    $app.on('click', '#ni-stage-enable-all', () => {
        niSetAllStagesEnabled(true);
    });
    $app.on('click', '#ni-stage-disable-all', () => {
        niSetAllStagesEnabled(false);
    });
    $app.on('change', '#ni-stage-page-size', function() {
        niSetStagePageSize(this.value);
    });
    $app.on('change', '#ni-stage-page-current', function() {
        niSetStagePage(this.value);
    });
    $app.on('keydown', '#ni-stage-page-size, #ni-stage-page-current', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (this.id === 'ni-stage-page-size') niSetStagePageSize(this.value);
        else niSetStagePage(this.value);
    });
    $app.on('click', '#ni-stage-page-prev', () => niChangeStagePage(-1));
    $app.on('click', '#ni-stage-page-next', () => niChangeStagePage(1));
    $app.on('click', '.ni-stg-chk', function() {
        niToggleStage(parseInt($(this).data('stage-idx')), { source: 'manual' });
    });
    $app.on('click', '.ni-stage-expand-btn', function() {
        niToggleStageBody(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-stage-save-btn', function() {
        niSaveStage(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-stage-cancel-btn', function() {
        niCancelStageEdit(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-node-pill', function() {
        const plotType = $(this).data('plot-type');
        const stageIdx = parseInt($(this).data('stage-idx'));
        const container = q(`#ni-pin-${stageIdx}`);
        // If already expanded for this type → collapse; otherwise expand
        if (container && container.style.display !== 'none' && container.dataset.activeType === plotType) {
            container.style.display = 'none';
            container.dataset.activeType = '';
            $(this).removeClass('ni-pill-active');
        } else {
            // Render inline node list
            const nodes = getNodesForStage(stageIdx);
            const typeMap = { main: '主线节点', sub: '支线节点', pivot: '关键转折' };
            const items = nodes[plotType] || [];
            if (!items.length) { niGoPlot(plotType, stageIdx); return; }
            const html = items.map((p, idx) => `<div class="ni-pin-row ni-pin-type-${plotType}" data-plot-type="${plotType}" data-stage-idx="${stageIdx}" data-item-idx="${idx}" data-node-id="${niEscAttr(niEnsurePlotNodeId(p, plotType, idx))}">
              <i class="ti ti-git-branch ni-pin-icon"></i>
              <span class="ni-pin-title">${niEscHtml(p.title || '')}</span>
              ${p.location ? `<span class="ni-pin-loc"><i class="ti ti-map-pin"></i>${niEscHtml(p.location)}</span>` : ''}
            </div>`).join('');
            container.innerHTML = `<div class="ni-pin-label">${typeMap[plotType] || plotType}</div>${html}`;
            container.dataset.activeType = plotType;
            container.style.display = 'block';
            // Highlight active pill, unhighlight others in same stage
            $(this).closest('.ni-stage-node-pills').find('.ni-node-pill').removeClass('ni-pill-active');
            $(this).addClass('ni-pill-active');
        }
    });
    $app.on('click', '.ni-pin-row', function() {
        const plotType = $(this).data('plot-type');
        const stageIdx = parseInt($(this).data('stage-idx'));
        const itemIdx = parseInt($(this).data('item-idx'));
        const nodeId = $(this).data('node-id');
        niGoPlot(plotType, stageIdx, itemIdx, nodeId);
    });
    $app.on('click', '.ni-sp-node-row', function() {
        niToggleChunkInSlot(parseInt($(this).data('slot-id')), parseInt($(this).data('chunk-idx')));
    });
    $app.on('click', '.ni-slot-toggle', function(e) {
        if ($(e.target).closest('.ni-slot-del-btn').length) return;
        const sid = String($(this).data('slot-id'));
        if (!window._slotOpenStates) window._slotOpenStates = {};
        window._slotOpenStates[sid] = !window._slotOpenStates[sid];
        niRenderStageSlots();
    });
    $app.on('click', '.ni-slot-del-btn', function(e) {
        e.stopPropagation();
        niRemoveStageSlot(parseInt($(this).data('slot-id')));
    });
    $app.on('change', '.ni-slot-name-input', function() {
        niSlotRename(parseInt($(this).data('slot-id')), $(this).val());
    });
    // Fix③: 未分配节点区域折叠切换
    $app.on('click', '#ni-unassigned-head', function() {
        window._unassignedOpen = !window._unassignedOpen;
        niRenderStageSlots();
    });

    // 加载设置
    niLoadSettings();
    niSyncTopbarIconVisibility();
    niEnsureExtensionsMenuTopbarToggle();
    niRenderWorldSettings();
    // 设置 Tab 事件绑定
    // 插件总开关
    $app.on('change', '#ni-plugin-chk', () => niTogglePlugin());
    $app.on('change', '#ni-autosave-chk', function() {
        niAutosave.setEnabled(this.checked);
    });

    // 外观配色
    $app.on('click', '#ni-theme-toggle-head', () => niThemeEditor.togglePanel());
    $app.on('change', '#ni-theme-preset', function() {
        niThemeEditor.setPreset(this.value);
    });
    $app.on('input change', '.ni-theme-color-input', function() {
        niThemeEditor.setColor(this.dataset.themeColor, this.value);
    });
    $app.on('input', '.ni-theme-code', function() {
        niThemeEditor.setColorFromText(this.dataset.themeColorCode, this.value);
    });
    $app.on('blur', '.ni-theme-code', function() {
        niThemeEditor.restoreColorText(this.dataset.themeColorCode);
    });
    $app.on('change', '#ni-theme-surface-follow', function() {
        niThemeEditor.setSurfaceFollow(this.checked);
    });
    $app.on('change', '#ni-theme-borderless', function() {
        niThemeEditor.setBorderless(this.checked);
    });
    $app.on('change', '#ni-theme-cardless', function() {
        niThemeEditor.setCardless(this.checked);
    });
    $app.on('change', '#ni-theme-statusbar-follow', function() {
        niThemeEditor.setStatusbarFollow(this.checked);
    });
    $app.on('change', '#ni-theme-icon-replace', function() {
        niThemeEditor.setIconReplace(this.checked);
    });
    $app.on('click', '#ni-theme-import', () => q('#ni-theme-import-file')?.click());
    $app.on('change', '#ni-theme-import-file', function() {
        niThemeEditor.importPresetFile(this.files?.[0]);
        this.value = '';
    });
    $app.on('click', '#ni-theme-export', () => niThemeEditor.exportPreset());
    $app.on('click', '#ni-theme-delete', () => niThemeEditor.deletePreset());
    $app.on('click', '#ni-theme-new', () => niThemeEditor.newPreset());
    $app.on('click', '#ni-theme-save', () => niThemeEditor.savePreset());

    // 全局提示词面板
    $app.on('click', '#ni-global-prompt-btn', () => niToggleGlobalPrompt());
    $app.on('change', '#ni-global-source-tavern, #ni-global-source-builtin, #ni-global-source-none', function() {
        if (!this.checked) {
            this.checked = true;
            return;
        }
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].globalPromptSource =
            this.id === 'ni-global-source-tavern' ? 'tavern' :
            this.id === 'ni-global-source-none' ? 'none' :
            'builtin';
        niSyncGlobalPromptSourceUI(extension_settings[EXT_NAME]);
        niSaveSettings();
    });
    $app.on('input', '#ni-global-pt-content', () => {
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].globalPrompt = q('#ni-global-pt-content')?.value ?? GLOBAL_PROMPT;
        niSaveSettings();
    });
    $app.on('input', '#ni-global-tail-pt-content', () => {
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].globalTailPrompt = q('#ni-global-tail-pt-content')?.value ?? GLOBAL_TAIL_PROMPT;
        niSaveSettings();
    });
    $app.on('click', '#ni-global-pt-reset', () => {
        const el = q('#ni-global-pt-content');
        if (el) {
            el.value = GLOBAL_PROMPT;
            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
            extension_settings[EXT_NAME].globalPrompt = GLOBAL_PROMPT;
            niSaveSettings();
        }
    });
    $app.on('click', '#ni-global-tail-pt-reset', () => {
        const el = q('#ni-global-tail-pt-content');
        if (el) {
            el.value = GLOBAL_TAIL_PROMPT;
            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
            extension_settings[EXT_NAME].globalTailPrompt = GLOBAL_TAIL_PROMPT;
            niSaveSettings();
        }
    });

    // 小说库 — 保存快照面板
    $app.on('click', '#ni-lib-save-btn', () => {
        const panel = q('#ni-lib-save-panel');
        if (panel) panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
    $app.on('click', '#ni-lib-save-cancel', () => {
        const panel = q('#ni-lib-save-panel');
        if (panel) panel.style.display = 'none';
    });
    $app.on('click', '#ni-lib-save-confirm', () => {
        const name = q('#ni-lib-save-name')?.value?.trim();
        if (!name) { alert('请输入快照名称'); return; }
        niSaveNovelSnapshot(name);
        const panel = q('#ni-lib-save-panel');
        if (panel) panel.style.display = 'none';
        q('#ni-lib-save-name') && (q('#ni-lib-save-name').value = '');
    });
    // 小说库 — 加载/删除
    $app.on('click', '.ni-lib-load-btn', function() {
        niLoadNovelSnapshot(parseInt($(this).data('lib-idx')));
    });
    $app.on('click', '.ni-lib-del-btn', async function() {
        await niDeleteNovelSnapshot(parseInt($(this).data('lib-idx')));
    });
    $app.on('click', '.ni-lib-update-btn', function() {
        niUpdateNovelSnapshot(parseInt($(this).data('lib-idx')));
    });
    $app.on('click', '.ni-lib-rename-btn', function() {
        niRenameNovelSnapshot(parseInt($(this).data('lib-idx')));
    });
    $app.on('change', '#ni-lib-page-size', function() {
        niSetNovelLibraryPageSize(this.value);
    });
    $app.on('change', '#ni-lib-page-current', function() {
        niSetNovelLibraryPage(this.value);
    });
    $app.on('keydown', '#ni-lib-page-size, #ni-lib-page-current', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (this.id === 'ni-lib-page-size') niSetNovelLibraryPageSize(this.value);
        else niSetNovelLibraryPage(this.value);
    });
    $app.on('click', '#ni-lib-page-prev', () => niChangeNovelLibraryPage(-1));
    $app.on('click', '#ni-lib-page-next', () => niChangeNovelLibraryPage(1));

    // 导入/导出
    $app.on('click', '#ni-export-btn', () => niExportData());
    $app.on('click', '#ni-import-btn', () => q('#ni-import-fi')?.click());
    $app.on('change', '#ni-import-fi', function() {
        const f = this.files?.[0];
        if (f) { niImportData(f); this.value = ''; }
    });

    // 清除缓存
    $app.on('click', '#ni-clear-vec-btn', () => niClearVecCache());
    $app.on('click', '#ni-clear-all-btn', () => niClearAllData());

    // ── 文风模块 ──
    // 设置面板开关
    $app.on('click', '#ni-style-cfg-btn', () => {
        niTogglePanel('ni-style-cfg-panel', 'ni-style-cfg-btn');
        // 打开时填充段落下拉
        if (q('#ni-style-cfg-panel')?.classList.contains('on')) niStylePopulateChunkSel();
    });
    // 提示词面板开关
    $app.on('click', '#ni-style-prompt-btn', () => {
        niTogglePanel('ni-style-pb', 'ni-style-prompt-btn');
    });
    // 提示词重置
    $app.on('click', '#ni-style-pt-reset', () => {
        const el = q('#ni-style-pt-content');
        if (el) el.value = STYLE_PROMPT;
        niSaveSettings();
    });
    // 模式切换
    $app.on('change', '#ni-style-mode', () => {
        niStyleSyncMode();
        niSaveSettings();
    });
    // 采样参数变更 → 保存
    $app.on('change', '#ni-style-sample-len, #ni-style-chunk-sel', () => niSaveSettings());
    // 结果手动编辑 → 同步到 S.styleGuide
    $app.on('input', '#ni-style-result', function() {
        S.styleGuide = this.value;
    });
    $app.on('blur', '#ni-style-result', async function() {
        S.styleGuide = this.value;
        niSaveSettings();
        if (S.novelKey) await niServerSaveHeavy(S.novelKey, S.heavyFileKey);
    });
    // 结果区收起/展开
    $app.on('click', '#ni-style-result-toggle', () => {
        const body = q('#ni-style-result-body');
        const btn  = q('#ni-style-result-toggle i:last-child');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (btn) btn.className = isOpen ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
    });
    // 生成文风按钮
    $app.on('click', '#ni-btn-style', () => niGenerateStyle());

    // 切换到设置页时刷新小说库和缓存信息
    $app.on('click', '.ni-nav-btn[data-page="settings"]', () => {
        niRenderNovelLibrary({ force: true });

    });

    // 恢复 UI 状态
    if (canUseDerivedModules(S)) {
        // 恢复文件状态显示
        if (S.chunkStatus.length) {
            q('#ni-chunk-info').style.display = 'block';
            q('#ni-st-chunks').textContent = S.chunkStatus.length;
            renderChunkList();
        }
        renderPlots();
        renderCharacters();
        buildStages();
        setBtn('#ni-btn-vec', false);
        if (S.vecDone) {
            setBtn('#ni-btn-vec', false, '<i class="ti ti-check"></i>向量化完成');
        }
        niStylePopulateChunkSel();
        niSyncCleanButtonState();
    }

    // 监听酒馆事件：发消息前注入上下文
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
    eventSource.makeLast?.(event_types.CHAT_COMPLETION_PROMPT_READY, niFinalUserSubPromptRewrite);
    eventSource.makeLast?.(event_types.MESSAGE_RECEIVED, niPostprocessUserSubMessage);
    niBindDeviationAutoUpdateEvents();
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            _niDetachedUserSubConfig = null;
            niLoadPlotPagesFromChat();
            niLoadStagePageFromChat();
            niRefreshUserSubDependents({ rerenderUserSub: true });
            setTimeout(() => {
                niLoadPlotPagesFromChat({ render: true });
                niLoadStagePageFromChat({ render: true });
                niRefreshUserSubDependents({ rerenderUserSub: true });
            }, 350);
        });
    }
    niResetDevAutoCounter();
    setTimeout(() => {
        niStartDevAutoCatchup().catch(e => console.warn('[NI] 自动偏差分析启动追赶失败:', e));
    }, 800);

    console.log('[NI] 小说注入插件 加载完成');
    console.log('[NI] 全局绑定状态: 导航=' + !!window._niNavbarGlobalBound + ', 弹窗动作=' + !!window._niGlobalActionsBound);

  } catch (err) {
    console.error('[NI] 初始化异常（导航已由全局绑定兜底，其余功能可能部分失效）:', err);
    toastr?.error?.('[NI] 初始化异常：' + (err?.message || err));
  }
});

// ============================================================
// 阶段划分面板
// ============================================================

// 面板内临时状态：{ slotId: { label, chunkSet: Set<chunkIdx> } }
// ── niSaveSettings / syncSettingsToUI 补丁 ───────────────────
// 在插件已有的 niSaveSettings / syncSettingsToUI 之后追加穿书字段同步

const _niSaveSettingsOrig = window.niSaveSettings;
window.niSaveSettings = function () {
    if (typeof _niSaveSettingsOrig === 'function') _niSaveSettingsOrig();
    const cfg = extension_settings[EXT_NAME];
    if (cfg.pluginEnabled !== false) {
        cfg.transBookMode = document.getElementById('ni-tb-chk')?.checked ?? cfg.transBookMode;
    }
    cfg.tbAdvancePrompt  = document.getElementById('ni-tb-advance-prompt')?.value || cfg.tbAdvancePrompt;
    cfg.tbInferPrompt    = document.getElementById('ni-tb-infer-prompt')?.value   || cfg.tbInferPrompt;
    cfg.tbOngoingPrompt  = document.getElementById('ni-tb-ongoing-prompt')?.value || cfg.tbOngoingPrompt;
    cfg.tbDisplayStatusbar = document.getElementById('ni-tb-display-statusbar')?.checked ?? cfg.tbDisplayStatusbar;
    cfg.tbDisplayPopup     = document.getElementById('ni-tb-display-popup')?.checked     ?? cfg.tbDisplayPopup;
    cfg.tbLightRecallMode  = document.getElementById('ni-tb-light-recall-mode')?.checked ?? cfg.tbLightRecallMode;
    cfg.tbImmersionMode    = document.getElementById('ni-tb-immersion-mode')?.checked ?? cfg.tbImmersionMode;
    cfg.tbImmersionPrompt  = document.getElementById('ni-tb-immersion-prompt')?.value || cfg.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT;
};

// syncSettingsToUI 补丁：切换到设置页时将穿书字段同步到 UI
const _niSyncSettingsToUIOrig = window.syncSettingsToUI || syncSettingsToUI;
const _niSyncSettingsToUIPatched = function () {
    if (typeof _niSyncSettingsToUIOrig === 'function') _niSyncSettingsToUIOrig();
    const cfg = extension_settings[EXT_NAME] || {};
    const chk = document.getElementById('ni-tb-chk');
    if (chk) niSyncTransBookToggleUI();
    const advEl = document.getElementById('ni-tb-advance-prompt');
    if (advEl) advEl.value = cfg.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT;
    const inferEl = document.getElementById('ni-tb-infer-prompt');
    if (inferEl) inferEl.value = cfg.tbInferPrompt || TB_DEFAULT_INFER_PROMPT;
    const ongoingEl = document.getElementById('ni-tb-ongoing-prompt');
    if (ongoingEl) ongoingEl.value = cfg.tbOngoingPrompt || TB_DEFAULT_ONGOING_PROMPT;
    const statusbarChkSync = document.getElementById('ni-tb-display-statusbar');
    if (statusbarChkSync) statusbarChkSync.checked = !!cfg.tbDisplayStatusbar;
    const popupChkSync = document.getElementById('ni-tb-display-popup');
    if (popupChkSync) popupChkSync.checked = !!cfg.tbDisplayPopup;
    const lightRecallModeChkSync = document.getElementById('ni-tb-light-recall-mode');
    if (lightRecallModeChkSync) lightRecallModeChkSync.checked = !!cfg.tbLightRecallMode;
    const immersionModeChkSync = document.getElementById('ni-tb-immersion-mode');
    if (immersionModeChkSync) immersionModeChkSync.checked = !!cfg.tbImmersionMode;
    const immersionPromptEl = document.getElementById('ni-tb-immersion-prompt');
    if (immersionPromptEl) immersionPromptEl.value = cfg.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT;
    if (typeof niSyncGlobalPromptSourceUI === 'function') niSyncGlobalPromptSourceUI(cfg);
};
window.syncSettingsToUI = _niSyncSettingsToUIPatched;

// ── onPromptReady 补丁：注入穿书开场/推进/持续/沉浸提示词 ─────
// 直接在 CHAT_COMPLETION_PROMPT_READY 上追加一个独立监听
// 注意：此处不再重复 import，而是直接追加到 eventData.chat，
// 与 onPromptReady 内 doInject 的 fallback 逻辑一致，避免双重 import 开销。
jQuery(document).ready(function () {
    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (eventData) => {
            if (eventData?.dryRun) return;
            if (extension_settings[EXT_NAME]?.pluginEnabled === false) return;
            if (!extension_settings[EXT_NAME]?.transBookMode) return;

            const cfg = extension_settings[EXT_NAME];
            let setExtensionPromptFn = null;
            try {
                const mod = await import('/script.js');
                setExtensionPromptFn = mod.setExtensionPrompt || null;
            } catch (_) {}

            const _inject = (slotKey, content) => {
                content = niApplyUserSubstitution(content);
                if (!content.trim()) {
                    setExtensionPromptFn?.(slotKey, '', 1, 1, true, 0);
                    return;
                }
                if (eventData?.chat && Array.isArray(eventData.chat)) {
                    niInsertIntoEventChat(eventData.chat, content, 1, 1, 0);
                } else if (setExtensionPromptFn) {
                    setExtensionPromptFn(slotKey, content, 1, 1, true, 0);
                }
            };

            const immersionAppend = niTbGetImmersionAppend(cfg);
            const pausedPromptSlots = niResolvePausedTransbookPromptSlots({
                paused: !!S.tbPaused,
                immersionContent: immersionAppend,
            });
            if (pausedPromptSlots) {
                // 暂停开场/推进/持续提示词；沉浸提示只由自己的开关控制。
                _inject(`${EXT_NAME}_tb_advance`, pausedPromptSlots.advanceContent);
                _inject(`${EXT_NAME}_tb_ongoing`, pausedPromptSlots.ongoingContent);
                return;
            }

            // ── 一次性推进/开场提示词 ──────────────────────────
            // 只有当前确实停在首节点时才注入开场提示词。
            // 用户从状态栏/弹窗切到后续节点后，早期未归档节点不能再抢占当前阶段。
            if (!niTbPeekPendingAdvancePrompt()) {
                const nodes = niGetTbNodes();
                if (nodes.length > 0) {
                    niTbReconcileCurrentNode(nodes);
                    if (S.tbCurIdx === 0 && !nodes[0].done) {
                        niTbWriteOpeningPrompt();
                    }
                }
            }

            const pendingAdvancePrompt = niTbConsumePendingAdvancePrompt();
            if (pendingAdvancePrompt) {
                const content = pendingAdvancePrompt + immersionAppend;
                _inject(`${EXT_NAME}_tb_advance`, content);
                // 一次性提示词发出后，本次不再叠加持续提示词，避免重复
                return;
            }

            // ── 持续提示词：每条消息都注入 ───────────────────────
            // 节点必须走归档进度推导（niTbGetInjectionNode）：锚点 tbCurIdx 不随
            // 勾选归档移动，直接按锚点下标取节点会在锚点归档后继续注入已归档内容。
            const nodes = niGetTbNodes();
            const curNode = niTbGetInjectionNode(nodes) || nodes[0];
            if (!curNode) return;

            const ongoingTpl = (cfg.tbOngoingPrompt || TB_DEFAULT_ONGOING_PROMPT).trim();
            const ongoingContent = ongoingTpl
                .replace(/{B_TITLE}/g, curNode.title)
                .replace(/{B_BODY}/g,  curNode.body || '（暂无描述）') + immersionAppend;
            _inject(`${EXT_NAME}_tb_ongoing`, ongoingContent);
        });
        eventSource.makeLast?.(event_types.CHAT_COMPLETION_PROMPT_READY, niFinalUserSubPromptRewrite);
    }
});

// ── ST 事件监听：消息渲染后挂载状态栏 ────────────────────────

jQuery(document).ready(function () {
    if (typeof eventSource === 'undefined' || typeof event_types === 'undefined') return;

    // 消息渲染完成后挂载状态栏
    const onRendered = (messageId) => {
        if (!extension_settings[EXT_NAME]?.transBookMode) return;
        setTimeout(() => niTbRenderStoryBar({ resetView: true }), 100);
    };

    eventSource.on(event_types.MESSAGE_RENDERED,            onRendered);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED,  onRendered);

    // 真正生成新消息时解钉预览节点：之后的重挂载才允许自动回正到当前节点
    eventSource.on(event_types.MESSAGE_RECEIVED, () => niTbUnpinView());
    eventSource.on(event_types.MESSAGE_SENT,     () => niTbUnpinView());

    // 切换对话：重置状态，重新加载
    eventSource.on(event_types.CHAT_CHANGED, () => {
        document.getElementById('ni-storybar')?.remove();
        niTbResetPromptRuntimeState();
        niTbLoadState();
        niTbSyncPauseUI();
        niRefreshUserSubDependents({ rerenderUserSub: true });
        // 短暂延迟等对话 DOM 就绪
        setTimeout(() => niTbRenderStoryBar(), 300);
    });

    // 剧情页打开时初始化穿书模式 UI；保留设置页触发兼容旧布局
    const $app = typeof $ !== 'undefined' ? $(document.getElementById('ni-app') || document) : null;
    if ($app) {
        $app.on('click', '.ni-nav-btn[data-page="plot"], .ni-nav-btn[data-page="settings"]', () => {
            setTimeout(() => niTbInitSettingsUI(), 50);
        });
    }
    setTimeout(() => niTbInitSettingsUI(), 100);

    // niConfirmStageMap 后刷新状态栏
    const _origConfirm = window.niConfirmStageMap;
    if (typeof _origConfirm === 'function') {
        window.niConfirmStageMap = function () {
            _origConfirm.apply(this, arguments);
            setTimeout(() => niTbRenderStoryBar(), 200);
        };
    }

    // 初次加载：如果已有对话且穿书模式开启，挂载状态栏
    niTbLoadState();
    setTimeout(() => niTbRenderStoryBar(), 500);

});

console.log('[NI-TB] 穿书模式模块已加载');

// ══════════════════════════════════════════════════════════════
// 穿书弹窗控制逻辑
// ══════════════════════════════════════════════════════════════
(function niPopupInit() {
    'use strict';

    // ── 工具函数 ──
    // 注意：bootstrap 后 FAB/popup 已移到父页面 document，所以优先在父页面查找
    function q(id) {
        // _niPopDoc 在 bootstrap 后才赋值，这里做兼容处理
        const parentDoc = (typeof _niPopDoc !== 'undefined') ? _niPopDoc : document;
        return parentDoc.getElementById(id) || document.getElementById(id);
    }
    function niPopEsc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // ── 条形码 ──
    function niPopBuildBarcode() {
        const bc = q('ni-pop-barcode');
        if (!bc || bc.children.length) return;
        [2,1,3,1,2,4,1,2,3,1,4,2,1,3,2,1,4,1,2,3].forEach(w => {
            const s = document.createElement('span');
            s.style.cssText = 'width:' + w + 'px;height:32px';
            bc.appendChild(s);
        });
    }

    // ── 状态 ──
    let _popOpen = false;
    let _popInferring = false;
    let _popInferExp = true;
    let _popStageOpen = false;
    let _popCurIdx = 0;   // 当前节点索引
    let _popStagePage = 1;
    let _popNodePage = 1;
    const NI_POP_NODE_PAGE_SIZE = NI_STAGE_PAGE_SIZE_DEFAULT;

    function niPopGetStagePageSize() {
        const cfg = extension_settings[EXT_NAME] || {};
        return niNormalizeStagePageSize(cfg.transBookStagePageSize, DEFAULT_SETTINGS.transBookStagePageSize || NI_TRANSBOOK_STAGE_PAGE_SIZE);
    }

    function niPopGetNodePageSize() {
        const cfg = extension_settings[EXT_NAME] || {};
        return niNormalizeStagePageSize(cfg.transBookNodePageSize, DEFAULT_SETTINGS.transBookNodePageSize || NI_POP_NODE_PAGE_SIZE);
    }

    function niPopSetStagePageSize(value) {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.transBookStagePageSize = niNormalizeStagePageSize(value, cfg.transBookStagePageSize || DEFAULT_SETTINGS.transBookStagePageSize || NI_TRANSBOOK_STAGE_PAGE_SIZE);
        _popStagePage = 1;
        saveSettingsDebounced();
        const latest = niPopGetState();
        const view = niPopGetStageView(latest.nodes, latest.viewIdx);
        niPopBuildStages(latest.stages, view.stageIdx);
        return cfg.transBookStagePageSize;
    }

    function niPopSetNodePageSize(value) {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.transBookNodePageSize = niNormalizeStagePageSize(value, cfg.transBookNodePageSize || DEFAULT_SETTINGS.transBookNodePageSize || NI_POP_NODE_PAGE_SIZE);
        _popNodePage = 1;
        saveSettingsDebounced();
        const latest = niPopGetState();
        const view = niPopGetStageView(latest.nodes, latest.viewIdx);
        niPopBuildNodes(view.nodes, latest.viewIdx, { alignActive: false });
        return cfg.transBookNodePageSize;
    }

    // ── 从主插件数据拉取节点/阶段信息 ──
    function niPopGetState() {
        // 优先通过主模块暴露的函数读取
        if (typeof window.niCreateTbSnapshot === 'function') {
            const snapshot = window.niCreateTbSnapshot();
            const nodes  = snapshot?.nodes || [];
            const stages = snapshot?.stages || [];
            const S      = window._niS;
            const curIdx = (S && typeof S.tbCurIdx === 'number') ? S.tbCurIdx : _popCurIdx;
            const viewIdx = (S && typeof S.tbViewIdx === 'number') ? S.tbViewIdx : curIdx;
            return { nodes, stages, curIdx, viewIdx };
        }
        if (typeof window.niGetTbNodes === 'function' && typeof window.niGetTbStages === 'function') {
            const nodes  = window.niGetTbNodes();
            const stages = window.niGetTbStages(nodes);
            const S      = window._niS;
            const curIdx = (S && typeof S.tbCurIdx === 'number') ? S.tbCurIdx : _popCurIdx;
            const viewIdx = (S && typeof S.tbViewIdx === 'number') ? S.tbViewIdx : curIdx;
            return { nodes, stages, curIdx, viewIdx };
        }
        // fallback：旧路径
        const cfg = (typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
            ? extension_settings[EXT_NAME] : null;
        const nodes  = (cfg && Array.isArray(cfg.tbNodes))  ? cfg.tbNodes  : [];
        const stages = (cfg && Array.isArray(cfg.tbStages)) ? cfg.tbStages : [];
        const curIdx = (cfg && typeof cfg.tbCurIdx === 'number') ? cfg.tbCurIdx : _popCurIdx;
        return { nodes, stages, curIdx, viewIdx: curIdx };
    }

    function niPopGetStageView(nodes, curIdx) {
        if (typeof window.niTbStageView === 'function') return window.niTbStageView(nodes, curIdx);
        const curNode = nodes[curIdx] || nodes[0];
        if (!curNode) return { nodes: [], curIdx: 0, stageIdx: null };
        const stageNodes = nodes
            .map((nd, idx) => ({ ...nd, _globalIdx: idx }))
            .filter(nd => nd.stageIdx === curNode.stageIdx);
        const localIdx = Math.max(0, stageNodes.findIndex(nd => nd.id === curNode.id));
        return { nodes: stageNodes, curIdx: localIdx, stageIdx: curNode.stageIdx };
    }

    function niPopCommitCurrentIdx(nextIdx, nodes, { archivePrior = false } = {}) {
        if (typeof window.niTbSetCurrentIdx !== 'function') {
            console.error('[NI] 穿书弹窗无法同步当前节点：主状态控制器未就绪');
            return false;
        }
        window.niTbSetCurrentIdx(nextIdx, nodes, { persist: true, archivePrior });
        window.niTbSetViewIdx?.(nextIdx, nodes, { render: true });
        const mainIdx = window._niS?.tbCurIdx;
        _popCurIdx = Number.isFinite(Number(mainIdx)) ? Number(mainIdx) : nextIdx;
        return _popCurIdx === nextIdx;
    }

    // ── 渲染阶段下拉 ──
    function niPopSyncStageValue(stages, curStageIdx) {
        const val = q('ni-pop-stage-val');
        if (!val) return;
        const current = (stages || []).find(stage => stage.enabled !== false && Number(stage.stageIdx) === Number(curStageIdx));
        val.textContent = current?.title || current?.name || (current ? `阶段 ${current.stageIdx}` : '—');
    }

    function niPopBuildStages(stages, curStageIdx, { alignActive = false } = {}) {
        const drop = q('ni-pop-stage-drop');
        if (!drop) return;
        const active = (stages || []).filter(s => s.enabled !== false);
        const pagination = niResolveTransbookStagePagination(active, {
            page: _popStagePage,
            pageSize: niPopGetStagePageSize(),
            activeStageIdx: curStageIdx,
            alignActive,
        });
        _popStagePage = pagination.page;
        const pagerHtml = niBuildListPaginationHtml({
            pagination,
            idPrefix: 'ni-pop-stage-page',
            wrapperClass: 'ni-pop-stage-page',
            sizeInputClass: 'ni-pop-stage-page-size',
            pageInputClass: 'ni-pop-stage-page-current',
            pageButtonClass: 'ni-pop-stage-page-btn',
            sizeAriaLabel: '每页小票阶段数',
            pageAriaLabel: '当前小票阶段页码',
        });
        drop.innerHTML = pagerHtml + pagination.items.map(stage =>
            `<div class="ni-stage-opt${Number(stage.stageIdx) === Number(curStageIdx) ? ' active' : ''}" data-stage-idx="${stage.stageIdx}">
              <span class="ni-sdot"></span>${niPopEsc(stage.title || stage.name || `阶段 ${stage.stageIdx}`)}
            </div>`
        ).join('');
        niPopSyncStageValue(active, curStageIdx);
    }

    // ── 渲染节点列表 ──
    function niPopBuildNodes(nodes, curIdx, { alignActive = false } = {}) {
        const list = q('ni-pop-node-list');
        if (!list) return;
        list.innerHTML = '';
        const activeLocalIdx = Math.max(0, nodes.findIndex(node => (node._globalIdx ?? -1) === curIdx));
        const nodePageSize = niPopGetNodePageSize();
        if (alignActive) _popNodePage = Math.floor(activeLocalIdx / nodePageSize) + 1;
        const pagination = niResolveStagePagination({
            total: nodes.length,
            page: _popNodePage,
            pageSize: nodePageSize,
        });
        _popNodePage = pagination.page;
        const pagerHtml = niBuildListPaginationHtml({
            pagination,
            idPrefix: 'ni-pop-node-page',
            wrapperClass: 'ni-pop-node-page',
            sizeInputClass: 'ni-pop-node-page-size',
            pageInputClass: 'ni-pop-node-page-current',
            pageButtonClass: 'ni-pop-node-page-btn',
            sizeAriaLabel: '每页小票节点数',
            pageAriaLabel: '当前小票节点页码',
        });
        if (pagerHtml) list.insertAdjacentHTML('beforeend', pagerHtml);
        nodes.slice(pagination.startIndex, pagination.endIndex).forEach((n, pageIdx) => {
            const i = pagination.startIndex + pageIdx;
            const gi = n._globalIdx ?? i;
            const typeMap = { main:'main', sub:'sub', pivot:'pivot', 支线:'sub', 主线:'main', 关键转折:'pivot' };
            const typeKey = typeMap[n.type] || 'main';
            const typeLbl = { main:'主线', sub:'支线', pivot:'关键转折' }[typeKey] || (n.type || '');
            const isDone = !!n.done;
            const isActive = gi === curIdx;

            const g = document.createElement('div');
            g.className = 'ni-node-group' + (isActive ? ' is-active-g' : '');

            const row = document.createElement('div');
            row.id = 'ni-pop-nr' + gi;
            row.className = 'ni-node-row' + (isActive ? ' is-active' : '') + (isDone ? ' is-done' : '');
            row.innerHTML =
                '<span class="ni-nr-num">' + String(i+1).padStart(2,'0') + '</span>' +
                '<span class="ni-nr-tag ni-tag-' + typeKey + '">' + niPopEsc(typeLbl) + '</span>' +
                '<span class="ni-nr-title-blk">' +
                  '<span class="ni-nr-title">' + niPopEsc(n.title) + '</span>' +
                  (n.time || n.location ? '<div class="ni-nr-meta">' +
                    (n.time     ? '<span class="ni-nr-meta-item">🕐 ' + niPopEsc(n.time)     + '</span>' : '') +
                    (n.location ? '<span class="ni-nr-meta-item">📍 ' + niPopEsc(n.location) + '</span>' : '') +
                  '</div>' : '') +
                '</span>' +
                '<span class="ni-nr-status"><span class="ni-nr-chk' + (isDone ? ' checked' : '') + '" id="ni-pop-chk'+gi+'">' + (isDone ? '✔' : '') + '</span></span>';

            row.title = isActive ? '点击右侧勾选切换归档状态' : '点击切换到此节点';
            row.addEventListener('click', function(e) {
                e.preventDefault();
                if (n.locked) return;
                if (!e.target.closest('.ni-nr-chk')) {
                    niPopSetActive(gi, { archivePrior: true });
                    return;
                }
                const chkEl = q('ni-pop-chk' + gi);
                if (typeof window.niTbToggleCheck === 'function') {
                    window.niTbToggleCheck(gi).then(() => {
                        niPopRender();
                    }).catch(e => console.warn('[NI] 弹窗节点归纳切换失败:', e));
                    return;
                }
                // fallback：兼容旧版
                n.done = !n.done;
                chkEl?.classList.toggle('checked', n.done);
                if (chkEl) chkEl.textContent = n.done ? '✔' : '';
                row.classList.toggle('is-done', n.done);
                niPopSyncFt(nodes);
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            });

            g.appendChild(row);
            // 展开区：概括 + 事件 + 伏笔
            {
                const hasBody  = !!n.body;
                const hasSubs  = Array.isArray(n.sub_notes)   && n.sub_notes.length > 0;
                const foreshadows = (n.branch_links || []).filter(l => l.startsWith('【伏笔】')).map(l => l.replace('【伏笔】', '').trim());
                const hasFore  = foreshadows.length > 0;
                if (hasBody || hasSubs || hasFore || n.desc || n.description) {
                    const dd = document.createElement('div');
                    dd.className = 'ni-node-desc' + (isActive ? ' vis' : '');
                    let html = '';
                    // 概括
                    const bodyTxt = n.body || n.desc || n.description || '';
                    if (bodyTxt) {
                        html += '<div class="ni-nd-body">' + niPopEsc(bodyTxt) + '</div>';
                    }
                    // 事件
                    if (hasSubs) {
                        html += '<div class="ni-nd-section">';
                        n.sub_notes.forEach((s, si) => {
                            html += '<div class="ni-nd-event"><span class="ni-nd-event-num">' + (si+1) + '</span>' + niPopEsc(s) + '</div>';
                        });
                        html += '</div>';
                    }
                    // 伏笔
                    if (hasFore) {
                        html += '<div class="ni-nd-section">';
                        foreshadows.forEach(f => {
                            html += '<span class="ni-nd-foreshadow"><span>🔖</span>' + niPopEsc(f) + '</span>';
                        });
                        html += '</div>';
                    }
                    dd.innerHTML = html;
                    g.appendChild(dd);
                }
            }
            list.appendChild(g);
        });

        // 滚动到当前
        requestAnimationFrame(() => {
            const r = q('ni-pop-nr' + curIdx);
            if (!r) return;
            const g = r.parentElement, l = q('ni-pop-node-list');
            if (l) l.scrollTop += (g.getBoundingClientRect().top - l.getBoundingClientRect().top) - (l.clientHeight/2) + (g.offsetHeight/2);
        });
    }

    function niPopSyncFt(nodes) {
        const done = nodes.filter(n => n.done).length;
        const ftD = q('ni-pop-ft-done'), ftT = q('ni-pop-ft-todo');
        if (ftD) ftD.textContent = done;
        if (ftT) ftT.textContent = nodes.length - done;
    }

    function niPopSyncNav(nodes, curIdx) {
        const localIdx = Math.max(0, nodes.findIndex(n => (n._globalIdx ?? -1) === curIdx));
        q('ni-pop-btn-up')?.classList.toggle('disabled', localIdx === 0);
        q('ni-pop-btn-down')?.classList.toggle('disabled', localIdx >= nodes.length - 1);
        const prog = q('ni-pop-nav-prog');
        if (prog) prog.innerHTML = '<strong>' + (localIdx+1) + '</strong> / ' + nodes.length;
    }

    // ── 更新副标题：阶段•节点标题 #mesID ──
    function niPopSyncSub(nodes, stages, curIdx) {
        const sub = document.getElementById('ni-rcp-sub');
        if (!sub) return;
        const node = nodes[curIdx];
        if (!node) { sub.textContent = '✨ 阶段•节点标题'; return; }
        let stageName = '';
        if (Array.isArray(stages) && stages.length) {
            const s = stages.find(st => st.stageIdx === node.stageIdx)
                   || stages.find(st => Array.isArray(st.nodes) && st.nodes.some(nd => nd?.id === node.id))
                   || stages[0];
            if (s) stageName = s.title || s.name || '';
        }
        let mesID = '';
        try {
            const ctx = (typeof getContext === 'function') ? getContext() : null;
            if (ctx && Array.isArray(ctx.chat) && ctx.chat.length) {
                for (let k = ctx.chat.length - 1; k >= 0; k--) {
                    if (!ctx.chat[k].is_user) {
                        const mid = ctx.chat[k].mes_id ?? ctx.chat[k].id ?? k;
                        mesID = String(mid);
                        break;
                    }
                }
            }
        } catch(e) {}
        const nodeTitle = node.title || '';
        let txt = stageName ? (stageName + '•' + nodeTitle) : nodeTitle;
        if (mesID) txt += ' #' + mesID;
        sub.textContent = '✨ ' + txt;
    }

    // ── 更新底部时间──
    function niPopSyncTime() {
        const el = document.getElementById('ni-pop-time');
        if (!el) return;
        const pad = n => String(n).padStart(2, '0');
        try {
            const ctx = (typeof getContext === 'function') ? getContext() : null;
            if (ctx && Array.isArray(ctx.chat) && ctx.chat.length) {
                for (let k = ctx.chat.length - 1; k >= 0; k--) {
                    const msg = ctx.chat[k];
                    if (!msg.is_user) {
                        const raw = msg.send_date || msg.date || msg.timestamp;
                        let d = raw ? new Date(raw) : null;
                        if (!d || isNaN(d)) d = new Date();
                        el.textContent = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
                                       + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
                        return;
                    }
                }
            }
        } catch(e) {}
        const now = new Date();
        el.textContent = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate())
                       + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    }

    // ── 更新预览节点；只有列表明确选点时才提交后台节点并归档前序节点 ──
    function niPopSetActive(newIdx, { archivePrior = false } = {}) {
        const { nodes } = niPopGetState();
        if (newIdx < 0 || newIdx >= nodes.length) return;
        if (archivePrior) {
            if (!niPopCommitCurrentIdx(newIdx, nodes, { archivePrior: true })) return;
        } else {
            if (typeof window.niTbSetViewIdx !== 'function') {
                console.error('[NI] 穿书弹窗无法切换预览节点：主状态控制器未就绪');
                return;
            }
            window.niTbSetViewIdx(newIdx, nodes, { render: true, persist: true });
            _popCurIdx = newIdx;
        }
        niPopRender({ alignStagePage: true, alignNodePage: true });
        // 滚动到新节点
        requestAnimationFrame(() => {
            const r = q('ni-pop-nr' + newIdx);
            if (!r) return;
            const g = r.parentElement, l = q('ni-pop-node-list');
            if (l) l.scrollTop += (g.getBoundingClientRect().top - l.getBoundingClientRect().top) - (l.clientHeight/2) + (g.offsetHeight/2);
        });
    }

    // ── 主渲染 ──
    function niPopRender({ alignStagePage = false, alignNodePage = true } = {}) {
        const { nodes, stages, viewIdx } = niPopGetState();
        // 弹窗展示预览节点；后台注入继续使用用户在节点列表中确认的节点。
        _popCurIdx = Number.isInteger(viewIdx) && viewIdx >= 0 && viewIdx < nodes.length ? viewIdx : 0;
        const view = niPopGetStageView(nodes, _popCurIdx);
        niPopSyncStageValue(stages, view.stageIdx);
        const stageDrop = q('ni-pop-stage-drop');
        if (_popStageOpen) {
            niPopBuildStages(stages, view.stageIdx, { alignActive: alignStagePage });
        } else if (stageDrop) {
            stageDrop.innerHTML = '';
        }
        niPopBuildNodes(view.nodes, _popCurIdx, { alignActive: alignNodePage });
        niPopSyncFt(view.nodes);
        niPopSyncNav(view.nodes, _popCurIdx);
        niPopSyncSub(nodes, stages, _popCurIdx);
        niPopSyncTime();
        niPopBuildBarcode();
    }

    // ── 弹窗开关 ──
    function niPopOpen() {
        _popOpen = true;
        // 主渲染会用同一份快照同步当前预览节点；预览不会改写后台注入节点。
        const fab = q('ni-fab'), panel = q('ni-popup-panel'), overlay = q('ni-popup-overlay');
        if (fab) fab.classList.add('open');
        if (panel) { panel.style.display = 'flex'; requestAnimationFrame(() => panel.classList.add('vis')); }
        if (overlay) overlay.style.display = 'block';
        // 强制用 JS 把遮罩层锁定到真实视口，绕开 CSS inset 可能失效的问题
        const wrap = q('ni-popup-wrap');
        if (wrap) {
            wrap.style.position = 'fixed';
            wrap.style.left     = '0';
            wrap.style.top      = '0';
            wrap.style.width    = window.innerWidth  + 'px';
            wrap.style.height   = window.innerHeight + 'px';
            wrap.style.display  = 'flex';
            wrap.style.alignItems    = 'center';
            wrap.style.justifyContent = 'center';
            wrap.style.pointerEvents = 'auto';
        }
        niPopRender({ alignNodePage: true });
        if (typeof window.niTbSyncPauseUI === 'function') window.niTbSyncPauseUI();
    }
    function niPopClose() {
        _popOpen = false;
        _popStageOpen = false;
        const fab = q('ni-fab'), panel = q('ni-popup-panel'), overlay = q('ni-popup-overlay');
        if (fab) fab.classList.remove('open');
        if (panel) { panel.classList.remove('vis'); setTimeout(() => { panel.style.display = 'none'; }, 380); }
        if (overlay) overlay.style.display = 'none';
        const wrap = q('ni-popup-wrap');
        if (wrap) wrap.style.pointerEvents = 'none';
        const stageDrop = q('ni-pop-stage-drop');
        if (stageDrop) {
            stageDrop.classList.remove('vis');
            stageDrop.innerHTML = '';
        }
    }
    window.niPopOpen  = niPopOpen;
    window.niPopClose = niPopClose;

    // ── 显示/隐藏浮动按钮──
    function niPopSetVisible(show) {
        const fab = q('ni-fab'), ring = q('ni-fab-ring');
        if (fab)  fab.style.display  = show ? 'flex' : 'none';
        if (ring) ring.style.display = show ? 'block' : 'none';
    }
    window.niPopSetVisible = niPopSetVisible;

    // ── FAB 拖动 ──
    function niPopInitFab() {
        const fab  = q('ni-fab');
        const ring = q('ni-fab-ring');
        if (!fab) return;

        const _win = (typeof _niPopWin !== 'undefined') ? _niPopWin : window;

        let bx = _win.innerWidth - 24 - 40;
        let by = _win.innerHeight - 80 - 40;

        function applyPos() {
            bx = Math.max(0, Math.min(_win.innerWidth - 40, bx));
            by = Math.max(0, Math.min(_win.innerHeight - 40, by));
            fab.style.left = bx + 'px';
            fab.style.top  = by + 'px';
            if (ring) {
                ring.style.left   = (bx - 6) + 'px';
                ring.style.top    = (by - 6) + 'px';
                ring.style.width  = '52px';
                ring.style.height = '52px';
            }
        }
        applyPos();

        let dragging = false, moved = false, sx = 0, sy = 0, sbx = 0, sby = 0;

        function startDrag(e) {
            dragging = true; moved = false;
            const p = e.touches ? e.touches[0] : e;
            sx = p.clientX; sy = p.clientY; sbx = bx; sby = by;
            if (e.cancelable) e.preventDefault();
            _win.addEventListener('mousemove', onMove);
            _win.addEventListener('mouseup', onUp);
            _win.addEventListener('touchmove', onMove, { passive: false });
            _win.addEventListener('touchend', onUp);
        }
        function onMove(e) {
            if (!dragging) return;
            if (e.cancelable) e.preventDefault();
            const p = e.touches ? e.touches[0] : e;
            const dx = p.clientX - sx, dy = p.clientY - sy;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
            bx = sbx + dx; by = sby + dy;
            applyPos();
        }
        function onUp(e) {
            dragging = false;
            _win.removeEventListener('mousemove', onMove);
            _win.removeEventListener('mouseup', onUp);
            _win.removeEventListener('touchmove', onMove);
            _win.removeEventListener('touchend', onUp);
            if (!moved) { _popOpen ? niPopClose() : niPopOpen(); }
            else if (e && e.cancelable) e.stopPropagation();
        }
        fab.addEventListener('mousedown', startDrag);
        fab.addEventListener('touchstart', startDrag, { passive: false });
        _win.addEventListener('resize', applyPos);
        _win.addEventListener('resize', function() {
            const wrap = q('ni-popup-wrap');
            if (wrap && _popOpen) {
                wrap.style.width  = _win.innerWidth  + 'px';
                wrap.style.height = _win.innerHeight + 'px';
            }
        });
    }

    // ── 按钮事件 ──
    function niPopBindEvents() {
        q('ni-popup-overlay')?.addEventListener('click', niPopClose);

        q('ni-pop-stage-row')?.addEventListener('click', () => {
            // 弹窗可能持续打开；展开阶段选择前重新读取主模块的最新状态。
            _popStageOpen = !_popStageOpen;
            if (_popStageOpen) niPopRender({ alignStagePage: true, alignNodePage: true });
            else {
                const drop = q('ni-pop-stage-drop');
                if (drop) drop.innerHTML = '';
            }
            q('ni-pop-stage-drop')?.classList.toggle('vis', _popStageOpen);
            const arrow = q('ni-pop-stage-arrow')?.querySelector('span');
            if (arrow) arrow.className = _popStageOpen ? 'ni-arr-us' : 'ni-arr-ds';
        });

        q('ni-pop-stage-drop')?.addEventListener('click', e => {
            e.stopPropagation();
            const pageBtn = e.target.closest('.ni-pop-stage-page-btn');
            if (pageBtn && !pageBtn.disabled) {
                const page = parseInt(pageBtn.dataset.page, 10);
                if (Number.isFinite(page)) _popStagePage = page;
                const latest = niPopGetState();
                const view = niPopGetStageView(latest.nodes, latest.viewIdx);
                niPopBuildStages(latest.stages, view.stageIdx);
                q('ni-pop-stage-drop')?.classList.add('vis');
                return;
            }
            const option = e.target.closest('.ni-stage-opt[data-stage-idx]');
            if (!option) return;
            const stageIdx = Number(option.dataset.stageIdx);
            const { nodes } = niPopGetState();
            const firstIdx = nodes.findIndex(node => Number(node.stageIdx) === stageIdx);
            if (firstIdx >= 0 && !niPopCommitCurrentIdx(firstIdx, nodes, { archivePrior: true })) return;
            _popStageOpen = false;
            const drop = q('ni-pop-stage-drop');
            if (drop) {
                drop.classList.remove('vis');
                drop.innerHTML = '';
            }
            const arrow = q('ni-pop-stage-arrow')?.querySelector('span');
            if (arrow) arrow.className = 'ni-arr-ds';
            niPopRender({ alignStagePage: true, alignNodePage: true });
        });
        q('ni-pop-stage-drop')?.addEventListener('change', e => {
            const target = e.target;
            if (target?.classList?.contains('ni-pop-stage-page-size')) {
                niPopSetStagePageSize(target.value);
            } else if (target?.classList?.contains('ni-pop-stage-page-current')) {
                const latest = niPopGetState();
                const view = niPopGetStageView(latest.nodes, latest.viewIdx);
                const active = (latest.stages || []).filter(stage => stage.enabled !== false);
                _popStagePage = niResolveTransbookStagePagination(active, {
                    page: target.value,
                    pageSize: niPopGetStagePageSize(),
                }).page;
                niPopBuildStages(latest.stages, view.stageIdx);
            }
        });
        q('ni-pop-stage-drop')?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            const target = e.target;
            if (!target?.classList?.contains('ni-pop-stage-page-size') && !target?.classList?.contains('ni-pop-stage-page-current')) return;
            e.preventDefault();
            if (target.classList.contains('ni-pop-stage-page-size')) niPopSetStagePageSize(target.value);
            else {
                const latest = niPopGetState();
                const view = niPopGetStageView(latest.nodes, latest.viewIdx);
                const active = (latest.stages || []).filter(stage => stage.enabled !== false);
                _popStagePage = niResolveTransbookStagePagination(active, {
                    page: target.value,
                    pageSize: niPopGetStagePageSize(),
                }).page;
                niPopBuildStages(latest.stages, view.stageIdx);
            }
        });

        q('ni-pop-node-list')?.addEventListener('click', e => {
            const pageBtn = e.target.closest('.ni-pop-node-page-btn');
            if (!pageBtn || pageBtn.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            const page = parseInt(pageBtn.dataset.page, 10);
            if (!Number.isFinite(page)) return;
            _popNodePage = page;
            const latest = niPopGetState();
            const view = niPopGetStageView(latest.nodes, latest.viewIdx);
            niPopBuildNodes(view.nodes, latest.viewIdx, { alignActive: false });
        });
        q('ni-pop-node-list')?.addEventListener('change', e => {
            const target = e.target;
            if (target?.classList?.contains('ni-pop-node-page-size')) {
                niPopSetNodePageSize(target.value);
            } else if (target?.classList?.contains('ni-pop-node-page-current')) {
                const latest = niPopGetState();
                const view = niPopGetStageView(latest.nodes, latest.viewIdx);
                _popNodePage = niResolveStagePagination({
                    total: view.nodes.length,
                    page: target.value,
                    pageSize: niPopGetNodePageSize(),
                }).page;
                niPopBuildNodes(view.nodes, latest.viewIdx, { alignActive: false });
            }
        });
        q('ni-pop-node-list')?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            const target = e.target;
            if (!target?.classList?.contains('ni-pop-node-page-size') && !target?.classList?.contains('ni-pop-node-page-current')) return;
            e.preventDefault();
            if (target.classList.contains('ni-pop-node-page-size')) niPopSetNodePageSize(target.value);
            else {
                const latest = niPopGetState();
                const view = niPopGetStageView(latest.nodes, latest.viewIdx);
                _popNodePage = niResolveStagePagination({
                    total: view.nodes.length,
                    page: target.value,
                    pageSize: niPopGetNodePageSize(),
                }).page;
                niPopBuildNodes(view.nodes, latest.viewIdx, { alignActive: false });
            }
        });

        const niPopMoveInStage = (delta) => {
            const { nodes } = niPopGetState();
            const view = niPopGetStageView(nodes, _popCurIdx);
            const localIdx = view.nodes.findIndex(n => (n._globalIdx ?? -1) === _popCurIdx);
            const nextNode = view.nodes[localIdx + delta];
            if (nextNode) niPopSetActive(nextNode._globalIdx);
        };

        q('ni-pop-btn-up')?.addEventListener('click', () => {
            niPopMoveInStage(-1);
        });
        q('ni-pop-btn-down')?.addEventListener('click', () => {
            niPopMoveInStage(1);
        });

        q('ni-pop-btn-pause')?.addEventListener('click', () => {
            if (typeof window.niTbTogglePaused === 'function') {
                window.niTbTogglePaused();
                return;
            }
            const runtime = (typeof window._niS !== 'undefined') ? window._niS : null;
            if (runtime) {
                runtime.tbPaused = !runtime.tbPaused;
                const paused = !!runtime.tbPaused;
                q('ni-pop-btn-pause')?.classList.toggle('paused', paused);
                const txt = q('ni-pop-pause-txt');
                if (txt) txt.textContent = paused ? '恢复' : '暂停';
            }
        });

        q('ni-pop-btn-infer')?.addEventListener('click', () => {
            if (_popInferring) return;
            _popInferring = true;
            const btn = q('ni-pop-btn-infer');
            const lbl = q('ni-pop-infer-lbl');
            if (btn) btn.classList.add('loading');
            if (lbl) lbl.textContent = '推演中…';
            q('ni-pop-infer-sec')?.classList.remove('vis');
            // 调用主插件推演函数
            const doInfer = window.niTbGenerateInfer || window.niTbDoInfer || window.niDoInfer;
            if (typeof doInfer === 'function') {
                doInfer().then(() => niPopInferDone(btn, lbl)).catch(() => niPopInferDone(btn, lbl));
            } else {
                setTimeout(() => niPopInferDone(btn, lbl), 1200);
            }
        });

        q('ni-pop-infer-tog')?.addEventListener('click', () => {
            _popInferExp = !_popInferExp;
            q('ni-pop-infer-items')?.classList.toggle('vis', _popInferExp);
            const chev = q('ni-pop-infer-chev')?.querySelector('span');
            if (chev) chev.className = _popInferExp ? 'ni-arr-us' : 'ni-arr-ds';
        });

        q('ni-pop-infer-items')?.addEventListener('click', (e) => {
            const item = e.target.closest('.ni-infer-item');
            if (!item) return;
            const desc = niApplyUserSubstitution(item?.dataset.desc || '');
            const ta = document.getElementById('send_textarea') || document.querySelector('#send_textarea');
            if (ta) {
                ta.value = desc;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.focus();
            }
        });
    }

    function niPopInferDone(btn, lbl) {
        _popInferring = false;
        if (btn) btn.classList.remove('loading');
        if (lbl) lbl.textContent = '✦ 重新推演';
        // 从主插件读取推演结果：优先从 window._niS，兼容旧路径
        const _S = (typeof window._niS !== 'undefined') ? window._niS
            : ((typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
               ? extension_settings[EXT_NAME] : null);
        const results = _S?.tbLastInfer;
        if (Array.isArray(results) && results.length) {
            const items = q('ni-pop-infer-items');
            if (items) {
                items.innerHTML = '';
                results.forEach((d, i) => {
                    const tagMap = { canon:'ni-itag-canon', diverge:'ni-itag-diverge', break:'ni-itag-break' };
                    const title = niApplyUserSubstitution(d.title || '');
                    const desc = niApplyUserSubstitution(d.desc || d.description || '');
                    const el = document.createElement('div');
                    el.className = 'ni-infer-item ni-fade-in';
                    el.dataset.desc = desc;
                    el.innerHTML =
                        '<div class="ni-infer-idx">' + (i+1) + '</div>' +
                        '<div class="ni-infer-body">' +
                          '<span class="ni-infer-tag ' + (tagMap[d.tag] || 'ni-itag-canon') + '">' + niPopEsc(d.tagLabel || d.tl || d.label || '') + '</span>' +
                          '<div class="ni-infer-title">' + niPopEsc(title) + '</div>' +
                          '<div class="ni-infer-desc">' + niPopEsc(desc) + '</div>' +
                        '</div>';
                    items.appendChild(el);
                });
                _popInferExp = true;
                items.classList.add('vis');
            }
            q('ni-pop-infer-sec')?.classList.add('vis');
            const chev = q('ni-pop-infer-chev')?.querySelector('span');
            if (chev) chev.className = 'ni-arr-us';
        }
    }

    // ── 响应设置变化：tbDisplayPopup 打钩时显示 FAB ──
    function niPopSyncVisibility() {
        const S = (typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
            ? extension_settings[EXT_NAME] : null;
        const show = !!(S?.transBookMode && S?.tbDisplayPopup);
        niPopSetVisible(show);
    }
    window.niPopSyncVisibility = niPopSyncVisibility;

    // ── 注入弹窗 CSS 到 document.head──
    // ── 本插件为 ES Module，直接运行在酒馆主页面，document/window 即主页面 ──
    const _niPopDoc = document;
    const _niPopWin = window;

    // ── 注入弹窗 CSS 到主页面 document.head ──
    function niPopInjectCSS() {
        if (_niPopDoc.getElementById('ni-popup-injected-css')) return;
        const style = _niPopDoc.createElement('style');
        style.id = 'ni-popup-injected-css';
        style.textContent = `#ni-fab{position:fixed !important;width:40px !important;height:40px !important;border-radius:50% !important;z-index:2147483647 !important;cursor:grab;user-select:none;background:linear-gradient(135deg,#b8a8f8 0%,#9ac8f0 40%,#f0a8d0 100%) !important;box-shadow:0 4px 18px rgba(160,130,220,.38),0 1px 4px rgba(160,130,220,.2),inset 0 1px 2px rgba(255,255,255,.5) !important;display:none;align-items:center !important;justify-content:center !important;transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .22s;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;}
#ni-fab::before{content:'' !important;position:absolute !important;inset:0 !important;border-radius:50% !important;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.45) 0%,transparent 65%) !important;pointer-events:none}
#ni-fab.open{background:linear-gradient(135deg,#c8b8ff 0%,#a8d8ff 40%,#ffb8e0 100%) !important}
#ni-fab:active{cursor:grabbing}
#ni-fab svg{pointer-events:none !important;display:block !important}
#ni-fab-ring{position:fixed !important;border-radius:50%;border:2px solid rgba(180,155,245,.45);pointer-events:none;z-index:2147483646 !important;animation:ni-fabRing 2.8s ease-in-out infinite;display:none}
@keyframes ni-fabRing{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.15);opacity:0}}
#ni-popup-wrap{position:fixed !important;left:0 !important;top:0 !important;width:100vw !important;height:100vh !important;z-index:2147483645 !important;pointer-events:none;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
#ni-popup-overlay{position:absolute;inset:0;background:var(--ni-popup-overlay-bg,rgba(180,160,220,.18));backdrop-filter:var(--ni-popup-backdrop-filter,blur(2px));cursor:pointer;display:none}
.ni-popup-panel{pointer-events:auto;transform-origin:center center;transform:scale(0.88);opacity:0;transition:transform .36s cubic-bezier(.34,1.25,.64,1),opacity .26s ease;filter:drop-shadow(0 8px 32px rgba(160,120,200,.28));width:320px;max-height:calc(100vh - 32px);display:none;flex-direction:column;border-radius:6px;overflow:visible;padding-bottom:24px}
.ni-popup-panel.vis{transform:scale(1);opacity:1}
.ni-popup-panel .ni-rcp-body,.ni-popup-panel .ni-node-list{scrollbar-width:thin;scrollbar-color:#dbeeff #fff8fc}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar,.ni-popup-panel .ni-node-list::-webkit-scrollbar{width:6px}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar-track,.ni-popup-panel .ni-node-list::-webkit-scrollbar-track{background:#fff8fc;border-left:1px dashed rgba(245,210,222,.5)}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar-thumb,.ni-popup-panel .ni-node-list::-webkit-scrollbar-thumb{background:linear-gradient(to bottom,#f8dbe6,#dbeeff);border-radius:6px;border:1px solid #fff8fc}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar-thumb:hover,.ni-popup-panel .ni-node-list::-webkit-scrollbar-thumb:hover{background:linear-gradient(to bottom,#f2c7d8,#cfe2ff)}`;
        _niPopDoc.head.appendChild(style);
    }

    // ── 初始化入口──
    function niPopBootstrap() {
        niPopInjectCSS();
        // ── 将 FAB、FAB-ring 和弹窗容器移动到主页面 body──
        const fabRing = document.getElementById('ni-fab-ring');
        const fab     = document.getElementById('ni-fab');
        const popWrap = document.getElementById('ni-popup-wrap');
        if (fabRing && fabRing.parentElement !== _niPopDoc.body) _niPopDoc.body.appendChild(fabRing);
        if (fab     && fab.parentElement     !== _niPopDoc.body) _niPopDoc.body.appendChild(fab);
        if (popWrap && popWrap.parentElement !== _niPopDoc.body) _niPopDoc.body.appendChild(popWrap);

        niPopInitFab();
        niPopBindEvents();
        niPopSyncVisibility();
    }

    // ── 暴露 bootstrap 供主模块在 template 插入后调用 ──
    window.niPopBootstrap = niPopBootstrap;

    // ── 监听穿书开关和弹窗选项变化，自动同步 FAB 显隐 ──
    // 直接在此处更新设置，防止 niTbInitSettingsUI 尚未调用时设置值未同步
    document.addEventListener('change', function(e) {
        if (!e.target) return;
        const _S = (typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
            ? extension_settings[EXT_NAME] : null;
        if (e.target.id === 'ni-tb-display-popup') {
            if (_S) {
                _S.tbDisplayPopup = e.target.checked;
                if (e.target.checked) _S.tbDisplayStatusbar = false;
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            }
            niPopSyncVisibility();
        } else if (e.target.id === 'ni-tb-chk') {
            if (_S) {
                if (_S.pluginEnabled !== false) _S.transBookMode = e.target.checked;
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            }
            niPopSyncVisibility();
        }
    });
})();
