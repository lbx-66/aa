/**
 * Novel Injector - 小说加料插件
 * 功能：导入小说 → 亲密关系判定 → AI 加料 → 导出
 */

import {
    renderExtensionTemplateAsync,
    getContext,
    extension_settings,
} from '/scripts/extensions.js';

import {
    saveSettingsDebounced,
    extractMessageFromData,
    getRequestHeaders,
    substituteParams,
} from '/script.js';

import {
    promptManager,
    oai_settings,
} from '/scripts/openai.js';

import {
    niB64,
    niEscAttr,
    niEscHtml,
    niServerFileId,
} from './lib/storage-system.js';

import {
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
    runWithSemaphore,
} from './lib/api-system.js';

import {
    BATCH_JUDGE_PROMPT,
    DEFAULT_JUDGE_PROMPT,
    DEFAULT_JUDGE_RULES,
    LEGACY_BATCH_JUDGE_PROMPT,
    LEGACY_BATCH_JUDGE_PROMPT_V2,
    LEGACY_BATCH_JUDGE_PROMPT_V3,
    LEGACY_BATCH_JUDGE_PROMPT_V4,
    LEGACY_JUDGE_PROMPT,
    LEGACY_JUDGE_PROMPT_V2,
    LEGACY_JUDGE_PROMPT_V3,
    LEGACY_JUDGE_PROMPT_V4,
    LEGACY_JUDGE_PROMPT_V5,
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
    buildEnrichContextNotes,
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
    NI_THEME_DEFAULT,
    createThemeEditor,
} from './lib/ui-system.js';

// ============================================================
// 常量
// ============================================================

const EXT_NAME = 'novel-injector';
const NI_UPLOAD_ACCEPT = '.txt,.mobi';
const NI_UPLOAD_LABEL = '点击上传 .txt / .mobi 文件';
const NI_UPLOAD_HINT = '支持 .txt / .mobi，将按设定大小自动分段';

// 通过 Error stack trace 获取当前模块的实际路径
function _detectExtFolder() {
    try {
        const stack = new Error().stack || '';
        const m = stack.match(/extensions\/([^/]+\/[^/]+)\/index\.js/);
        if (m) return m[1];
    } catch (_) {}
    return `third-party/${EXT_NAME}`;
}
const EXT_FOLDER = _detectExtFolder();

const DEFAULT_SETTINGS = {
    pluginEnabled: true,
    autoSaveEnabled: false,
    topbarIconVisible: true,
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
    judgeConcurrency: 1,
    judgeRateLimit: 0,
    enrichConcurrency: 1,
    enrichRateLimit: 0,
    enrichImport: {
        threshold: 200,
        customPatterns: [],
        filterEnabled: true,
    },
    enrichHistory: [],
    enrichShortcutsEnabled: true,
    judgeRules: DEFAULT_JUDGE_RULES,
    judgePrompts: { template: DEFAULT_JUDGE_PROMPT, batchTemplate: BATCH_JUDGE_PROMPT },
    judgeApi: { url: '', key: '', model: '', stream: false, timeoutSec: 60, retries: 2, temperature: 0.3 },
    sceneConfig: DEFAULT_SCENE_CONFIG,
    enrichApi: { url: '', key: '', model: '', stream: true, timeoutSec: 120, retries: 2, temperature: 0.9, topP: 1, dailyQuota: 0, dailyQuotaDate: '', dailyQuotaUsed: 0, useTavernPreset: false, useIndependentApi: true },
    enrichTemplates: DEFAULT_ENRICH_TEMPLATES,
    enrichParams: { intensity: 'medium', maxTokens: 4000, minChars: ENRICH_MIN_CHARS, enforceMinChars: false, presetSkipNames: ['接', '卡思维链（K）', '快速思维链', '涩涩加速', '不只看user'] },
    enrichSafety: { enabled: true, sensitiveWords: [] },
};

// ============================================================
// 运行时状态
// ============================================================
const S = {
    enrichChapters: [],
    enrichFileMeta: null,
    enrichReport: null,
    enrichSelected: new Set(),
    characters: [],
    plots: { main: [], sub: [], pivot: [] },
};

let niAutosave = null;
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

function niTogglePanel(id, btnId) {
    const p = q(`#${id}`);
    const b = q(`#${btnId}`);
    b?.classList.toggle('active', p?.classList.toggle('on'));
}
window.niTogglePanel = niTogglePanel;

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

// ============================================================
// 设置加载与保存
// ============================================================
function niLoadSettings() {
    extension_settings[EXT_NAME] = extension_settings[EXT_NAME] || {};
    const saved = extension_settings[EXT_NAME];
    Object.keys(DEFAULT_SETTINGS).forEach(k => {
        if (saved[k] === undefined) saved[k] = DEFAULT_SETTINGS[k];
    });
    // 判定提示词迁移
    if (saved.judgePrompts?.template === LEGACY_JUDGE_PROMPT
        || saved.judgePrompts?.template === LEGACY_JUDGE_PROMPT_V2
        || saved.judgePrompts?.template === LEGACY_JUDGE_PROMPT_V3
        || saved.judgePrompts?.template === LEGACY_JUDGE_PROMPT_V4
        || saved.judgePrompts?.template === LEGACY_JUDGE_PROMPT_V5) {
        saved.judgePrompts.template = DEFAULT_JUDGE_PROMPT;
        saveSettingsDebounced();
    }
    if (saved.judgePrompts?.batchTemplate === LEGACY_BATCH_JUDGE_PROMPT
        || saved.judgePrompts?.batchTemplate === LEGACY_BATCH_JUDGE_PROMPT_V2
        || saved.judgePrompts?.batchTemplate === LEGACY_BATCH_JUDGE_PROMPT_V3
        || saved.judgePrompts?.batchTemplate === LEGACY_BATCH_JUDGE_PROMPT_V4) {
        saved.judgePrompts.batchTemplate = BATCH_JUDGE_PROMPT;
        saveSettingsDebounced();
    }
    niSyncPluginToggleUI();
    syncSettingsToUI();
}

function niSaveSettings({ scheduleAutosave = true } = {}) {
    const cfg = extension_settings[EXT_NAME];
    cfg.autoSaveEnabled = q('#ni-autosave-chk')?.checked ?? (cfg.autoSaveEnabled ?? DEFAULT_SETTINGS.autoSaveEnabled);
    saveSettingsDebounced();
    if (scheduleAutosave) niAutosave?.schedule();
}
window.niSaveSettings = niSaveSettings;

function syncSettingsToUI() {
    const cfg = extension_settings[EXT_NAME] || {};
    const autoSaveEl = q('#ni-autosave-chk');
    if (autoSaveEl) autoSaveEl.checked = cfg.autoSaveEnabled ?? DEFAULT_SETTINGS.autoSaveEnabled;
    niSyncThemeUI();
    niApplyCurrentTheme();
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

/**
 * 底栏导航切换（含页面附加刷新；独立于巨型初始化，任何一步失败都不影响切页）。
 */
function niNavSwitchPage(page, btn) {
    niSwitchPage(page, btn);
    try {
        if (page === 'enrich' || page === 'judge') niEnrichRenderList();
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
// 限速队列
// ============================================================
const _judgeQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:judge-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.judgeRateLimit,
});
const _enrichQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:enrich-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.enrichRateLimit,
});

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

async function niAcquireJudgeRateSlot(signal = null) {
    return niAcquireFromQueue(_judgeQueue, signal);
}

async function niAcquireEnrichRateSlot(signal = null) {
    return niAcquireFromQueue(_enrichQueue, signal);
}

// 判定/加料各自独立的并发信号量（容量动态读取设置，改后即时生效）
const JudgeSemaphore = new DynamicSemaphore(() =>
    Math.max(1, parseInt(extension_settings[EXT_NAME]?.judgeConcurrency, 10) || DEFAULT_SETTINGS.judgeConcurrency)
);
const EnrichSemaphore = new DynamicSemaphore(() =>
    Math.max(1, parseInt(extension_settings[EXT_NAME]?.enrichConcurrency, 10) || DEFAULT_SETTINGS.enrichConcurrency)
);

// ============================================================
// 主题
// ============================================================
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
// 插件总开关
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

function niTogglePlugin() {
    const cfg = extension_settings[EXT_NAME];
    const chk = q('#ni-plugin-chk');
    const enabled = chk ? chk.checked : cfg.pluginEnabled === false;
    cfg.pluginEnabled = enabled;
    niSyncPluginToggleUI();
    niSaveSettings();
}
window.niTogglePlugin = niTogglePlugin;

// ============================================================
// 数据导入/导出
// ============================================================
async function niExportData() {
    const cfg = extension_settings[EXT_NAME] || {};
    const exportObj = {
        _ni_export_version: 4,
        _ni_export_time: new Date().toISOString(),
        settings: { ...cfg },
        runtime: {
            _enrichChapters: Array.isArray(S.enrichChapters) ? S.enrichChapters : [],
            _enrichFileMeta: S.enrichFileMeta || null,
        }
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `novel-injector-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toastr?.success('数据已导出');
}

async function niImportData(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const obj = JSON.parse(text);
        if (!obj || typeof obj !== 'object') throw new Error('文件格式不正确');
        const cfg = obj.settings || obj;
        const saved = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        Object.keys(DEFAULT_SETTINGS).forEach(k => {
            if (cfg[k] !== undefined) saved[k] = cfg[k];
        });
        if (obj.runtime?._enrichChapters) {
            S.enrichChapters = obj.runtime._enrichChapters;
            S.enrichFileMeta = obj.runtime._enrichFileMeta || null;
        }
        saveSettingsDebounced();
        niLoadSettings();
        niEnrichRenderList();
        niEnrichRenderHistory();
        toastr?.success('数据已导入');
    } catch (e) {
        toastr?.error(`导入失败：${e?.message || e}`);
    }
}

// ============================================================
// 自动保存
// ============================================================
niAutosave = {
    _timer: null,
    _enabled: false,
    setEnabled(v) { this._enabled = !!v; if (!v && this._timer) { clearTimeout(this._timer); this._timer = null; } },
    schedule() {
        if (!this._enabled) return;
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => { saveSettingsDebounced(); }, 1200);
    },
};

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
    niJudgeRenderList();
    niEnrichPageRenderList();
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

/** 判定/加料页通用章节行（无勾选框，保留查看与单章加料动作）。 */
function niStatusRowHtml(ch, badgeHtml) {
    return `<div class="ni-e-row" data-id="${niEscAttr(ch.id)}">
        <span class="ni-e-title" data-id="${niEscAttr(ch.id)}" title="点击查看/编辑">${niEscHtml(ch.title)}</span>
        <span class="ni-e-meta">${ch.charCount} 字</span>
        ${badgeHtml}
        <span class="ni-e-acts">
            <button class="ni-e-act" data-act="view" data-id="${niEscAttr(ch.id)}" title="查看/编辑">✎</button>
            ${niEnrichRowAction(ch)}
        </span>
    </div>`;
}

/** 判定页：显示「可加料」章节（判定为「是/存疑」或标记「通过」）。 */
function niJudgeRenderList() {
    const list = q('#ni-j-list');
    if (!list) return;
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const eligible = chapters.filter(ch => !ch.filtered && canEnrichChapter(ch));
    const cap = q('#ni-j-list-cap');
    if (cap) cap.textContent = eligible.length ? `可加料章节：共 ${eligible.length} 章` : '';
    if (!eligible.length) {
        list.innerHTML = '<div class="ni-empty"><i class="ti ti-scan"></i>暂无「可加料」章节（判定为「是/存疑」或标记「通过」后显示在此）</div>';
        return;
    }
    list.innerHTML = eligible.map(ch => niStatusRowHtml(ch,
        `<span class="ni-e-stat ni-es-d" title="判定已通过，可进行 AI 加料">可加料</span>`
    )).join('');
}

/** 加料页：显示需要加料的章节，按状态区分 已加料 / 加料中 / 未加料 / 失败。 */
function niEnrichPageRenderList() {
    const list = q('#ni-e-chapters');
    if (!list) return;
    const chapters = Array.isArray(S.enrichChapters) ? S.enrichChapters : [];
    const rows = [];
    let enriched = 0, enriching = 0, pending = 0, failed = 0;
    for (const ch of chapters) {
        if (!ch || ch.filtered) continue;
        const st = ch.status;
        let badge = null;
        if (st === CHAPTER_STATUS.ENRICHING) {
            badge = `<span class="ni-e-stat ni-es-r">加料中</span>`;
            enriching++;
        } else if (st === CHAPTER_STATUS.FAILED) {
            badge = `<span class="ni-e-stat ni-es-e">失败</span>`;
            failed++;
        } else if (ch.enrich?.noContent) {
            badge = `<span class="ni-e-stat ni-es-s" title="AI 判定原文无可加料内容，已保留原文">无加料</span>`;
            enriched++;
        } else if (ch.enrich || st === CHAPTER_STATUS.ENRICHED) {
            badge = `<span class="ni-e-stat ni-es-d">已加料</span>`;
            enriched++;
        } else if (canEnrichChapter(ch) && st !== CHAPTER_STATUS.SKIPPED) {
            badge = `<span class="ni-e-stat ni-es-w" title="已判定可加料，尚未生成">未加料</span>`;
            pending++;
        } else {
            continue;
        }
        rows.push(niStatusRowHtml(ch, badge));
    }
    const cap = q('#ni-e-chapters-cap');
    if (cap) {
        const total = enriched + enriching + pending + failed;
        cap.textContent = total
            ? `共 ${total} 章 · 已加料 ${enriched} · 加料中 ${enriching} · 未加料 ${pending} · 失败 ${failed}`
            : '';
    }
    if (!rows.length) {
        list.innerHTML = '<div class="ni-empty"><i class="ti ti-heart"></i>暂无可加料章节（先在「判定」页判定，或人工标记「通过」）</div>';
        return;
    }
    list.innerHTML = rows.join('');
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

// 服务端文件读写轻量封装（原 storage-system.js createStorageController 内部逻辑，此处内联）
function niHeavyPartFileName(fileKey, part) {
    return `${niServerFileId(fileKey)}_${part}.json`;
}

function niPrepareServerJsonUpload(name, payload) {
    return JSON.stringify({ name, data: niB64(JSON.stringify(payload)) });
}

async function niServerUploadJson(name, payload) {
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: niPrepareServerJsonUpload(name, payload),
    });
    if (!res.ok) throw new Error(`服务端写入失败: ${res.status}`);
}

async function niServerLoadJsonByNames(names) {
    for (const name of names) {
        const res = await fetch(`/user/files/${name}`, {
            headers: getRequestHeaders(),
            cache: 'no-cache',
        });
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`服务端读取失败: ${res.status}`);
        return { name, payload: await res.json() };
    }
    return null;
}

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

// 响应解析工具（从 chat 补全流/对象里抽取正文、判断长度类结束原因）
const {
    niExtractChatCompletionText,
    niHasLengthFinishReason,
    niReadChatCompletionStream,
} = createChatCompletionResponseTools({ extractMessageFromData });

// 酒馆预设提示词拼接工具（加料可选跟随酒馆主预设文风/人设）
const {
    niBuildTavernPresetPromptMessages,
} = createTavernPresetMessageTools({
    getPromptManager: () => promptManager,
    getGlobalVariables: () => extension_settings?.variables?.global || {},
    substituteParams,
});

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

/** 本章情报（人物卡 + 前史卡，来自清洗管道角色表/主线节点；无数据返回 ''）。 */
function niChapterContextNotes(ch) {
    return buildEnrichContextNotes(ch?.text || '', {
        characters: Array.isArray(S.characters) ? S.characters : [],
        plotNodes: Array.isArray(S.plots?.main) ? S.plots.main : [],
    });
}

/** 识别「模型内容安全拦截」错误（Google Gemini 等对含敏感词的提示词直接 400 拒绝）。 */
function niIsSensitivePromptError(err) {
    const msg = String(err?.message || err || '');
    return /sensitive words|prohibited use policy|rephrasing the prompt|content.{0,10}(filter|safety|policy)|blocked.{0,10}prompt|unsafe.{0,10}prompt|prompt.{0,10}(blocked|filtered|unsafe)/i.test(msg);
}

/** 模型内容安全拦截的友好提示（换模型/改模板指引）。 */
function niSensitivePromptHint(msg) {
    const base = String(msg || '');
    if (!niIsSensitivePromptError(base)) return base;
    return `${base}\n【提示】当前模型拒绝了包含敏感词的判定提示词（Google Gemini 等模型的内容安全策略）。建议：1) 在「判定设置」换用其他模型（OpenAI 系/本地模型等）；2) 或修改判定/批量提示词模板，去掉露骨的词例（如口交/射精/强奸/轮奸等，改用委婉表述）；3) 或改用「仅关键词判定」模式（不经过 AI）。`;
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
        rulesSummary += `\n【关键词初筛的场景窗口分析（仅供参考，可核实或反驳）】\n${buildScenesText(scenes)}\n注意：初筛窗口只表示该区域命中了场景词，可能包含误报（如普通亲吻/拥抱/暧昧氛围、比喻用语、农田/战场等字面义隐喻词）。请按上方判定标准独立判断：只有确认为性爱情节且存在缺口才算「是」，普通亲密/纯爱互动一律「无缺口」。`;
    }
    // 本章情报（人物卡/前史卡）：让 AI 判定时掌握人物关系与剧情前史（如夫妻/恋人/敌对状态）
    const judgeNotes = niChapterContextNotes(ch);
    if (judgeNotes) {
        rulesSummary += `\n【本章人物与前史情报】\n${judgeNotes}`;
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
 * 写回每章 judge。**失败就失败，不降级**：AI 调用/解析失败整组标失败（错误写入每章 error）；
 * AI 未返回的章节标失败；本地安全否决（未成年/非自愿/多人男等词表直接命中）始终优先。
 * 标记「是/存疑」的章节后续单独走原 AI 加料流程。
 */
async function judgeChapterBatch(group, { signal = null } = {}) {
    const list = (Array.isArray(group) ? group : [group]).filter(ch => ch && ch.text);
    if (!list.length) return;
    const rules = niJudgeRules();
    const api = niJudgeApiCfg();
    if (!api.url || !api.model) throw new Error('请先在「判定设置」中填写 AI 模式需要的接口地址与模型');
    const sceneCfg = niSceneConfig();
    const bookProfile = niGetBookProfile().profile;
    const autoNames = niGetAutoNames();
    const aiThreshold = Number(rules.aiThreshold) || 0.6;

    // 本地场景引擎初筛：仅用于安全否决与场景窗口明细（不参与判定结论，失败也不回退）
    const scoredByIndex = new Map();
    for (const ch of list) scoredByIndex.set(ch.index, niScoreChapter(ch));

    const template = extension_settings[EXT_NAME]?.judgePrompts?.batchTemplate || BATCH_JUDGE_PROMPT;
    // 批量材料每章附带本章情报（人物卡/前史卡），AI 判定时掌握人物关系
    const listWithNotes = list.map(ch => ({ ...ch, contextNotes: niChapterContextNotes(ch) }));
    const chaptersText = buildBatchChaptersText(listWithNotes, {
        sceneConfig: sceneCfg,
        bookProfile,
        autoNames,
        maxCharsPerChapter: Number(sceneCfg.batch_max_chars_per_chapter) || 1200,
    });
    const messages = buildBatchJudgeMessages(template, {
        chaptersText,
        rulesSummary: buildJudgeRulesSummary(rules),
    });
    // 输出上限按 4000 起（10 章 evidence 常超 2000），截断自动放大到 8000
    const raw = await niJudgeCallRetry(messages, api, signal, { baseLength: 4000 });
    let byIndex;
    try {
        byIndex = parseBatchJudgeResponse(raw);
    } catch (parseErr) {
        // 解析失败（截断/围栏/模型乱输出）：追加「格式纠正」指令重试一次，输出上限直接拉满
        console.warn('[NI] 批量判定 JSON 解析失败，追加格式纠正重试:', parseErr?.message || parseErr);
        const retryMessages = [...messages, {
            role: 'user',
            content: `【格式纠正要求（必须遵守）】\n上一次输出不是有效的 JSON（原因：${parseErr?.message || parseErr}）。请重新输出：只输出一个 JSON 对象 {"chapters": [{"index": 编号, "has_gap": true或false, "confidence": 0到1的小数, "evidence": "..."}]}，不要输出任何解释、Markdown 代码围栏或其他文字；chapters 必须覆盖全部 ${list.length} 章，index 与材料章节编号一致。`,
        }];
        const raw2 = await niJudgeCallRetry(retryMessages, api, signal, { baseLength: 8000 });
        byIndex = parseBatchJudgeResponse(raw2); // 仍失败则抛出（错误信息已附原始响应片段）
    }

    for (const ch of list) {
        const scored = scoredByIndex.get(ch.index) || niScoreChapter(ch);
        // 本地安全否决优先（词表直接命中，比 AI 可靠；属安全拦截，非降级）
        if (scored.vetoed) {
            ch.judge = { ...keywordJudgeToStore(scored), result: 'vetoed', hybridPending: false, at: Date.now() };
            delete ch.error;
            transitionChapter(ch, CHAPTER_STATUS.JUDGED);
            continue;
        }
        const res = byIndex.get(ch.index);
        if (!res) {
            // AI 未返回该章：标记失败（不降级、不回退本地初筛）
            ch.error = '批量 AI 判定未返回该章节结果（可能输出被截断或格式不符），请重试或调小每批章数';
            transitionChapter(ch, CHAPTER_STATUS.FAILED);
            niEnrichScheduleSave();
            continue;
        }
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
        delete ch.error;
        transitionChapter(ch, CHAPTER_STATUS.JUDGED);
    }
    niEnrichScheduleSave();
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
        if (!ch.judge?.hybridPending) ch.error = niSensitivePromptHint(err?.message || String(err));
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
                    if (!ch.error) ch.error = niSensitivePromptHint(err?.message || '批量判定失败');
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
    // 安全否决开关
    const svEl = q('#ni-j-safety-veto');
    if (svEl) svEl.checked = niSceneConfig().safetyVetoEnabled !== false;
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
    // 资格检查：批量队列入队时已通过 isEligible 并把章节置为 ENRICHING；
    // canEnrichChapter 视 ENRICHING 为「进行中无资格」，此处需放行，
    // 否则队列每章都会在入口立即抛「无加料资格」而全部失败。
    // 直接调用（详情弹窗/行内加料）时状态非 ENRICHING，正常走资格检查。
    if (ch.status !== CHAPTER_STATUS.ENRICHING) {
        if (!canEnrichChapter(ch)) throw new Error('本章无加料资格（需判定为「是/存疑」或人工标记「通过」）');
        if (!transitionChapter(ch, CHAPTER_STATUS.ENRICHING)) ch.status = CHAPTER_STATUS.ENRICHING;
    }
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
        const enforceMin = params.enforceMinChars === true && minChars > 0;
        const preferredId = ch.enrich?.templateId || params.templateId || templates[0]?.id;
        const template = templates.find(t => t.id === preferredId) || templates[0];
        if (!template?.prompt) throw new Error('没有可用的加料模板，请先在「加料设置」中新建或恢复默认模板');
        // 本章情报（人物卡 + 前史卡）：来自清洗管道角色表/主线节点，按文本匹配注入；
        // 未跑清洗/无匹配时为空串，不影响消息结构。
        const contextNotes = niChapterContextNotes(ch);
        let messages = buildEnrichMessages(template.prompt, {
            chapterContent: ch.text,
            keywords: buildEnrichKeywordsSummary(ch.judge),
            style: template.style || template.name || '',
            intensity: `${enrichIntensityLabel(params.intensity)}\n${enrichIntensityGuide(params.intensity)}`,
            minChars,
            contextNotes,
        });
        // 预设模式：把酒馆当前预设（如「泉此方改加料」）启用的提示词拼进请求，
        // 复用项目「跟随酒馆预设」机制（createTavernPresetMessageTools）：
        // 正确筛选（排除上下文/标记占位提示词）+ 酒馆宏替换（{{setvar::}}/{{getvar::}}/{{user}} 等）；
        // 加料文风/人设跟随预设；任务模板与输出规范仍在最后一条生效。
        // 注意：预设只提供提示词/模型跟随，与「独立 API 连接」互不排斥（可同时勾选）。
        if (usePreset) {
            try {
                // 加料适配过滤：跳过对话开场/思维链引导/切镜头/加速类预设条目（诱导开场白或跑题），
                // 丢弃 role=assistant 预填条目；名单可在 加料设置 enrichParams.presetSkipNames 扩展。
                const presetMsgs = await niBuildTavernPresetPromptMessages({
                    skipNames: (Array.isArray(params.presetSkipNames) ? params.presetSkipNames : DEFAULT_SETTINGS.enrichParams.presetSkipNames),
                    dropAssistant: true,
                });
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
        // 最大输出长度：完全使用手动设定值
        const maxTokens = Math.min(65536, Math.max(256, Number(params.maxTokens) || 4000));
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
            ch.error = niSensitivePromptHint(err?.message || String(err));
            transitionChapter(ch, CHAPTER_STATUS.FAILED);
        } else {
            // 永久错误（资格/敏感词/限额）：恢复入队前状态；
            // 队列场景 prevStatus 为 ENRICHING（入队时已置），回退到 JUDGED 避免卡在"加料中"
            ch.status = prevStatus === CHAPTER_STATUS.ENRICHING ? CHAPTER_STATUS.JUDGED : prevStatus;
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
                if (ch.error) ch.error = niSensitivePromptHint(ch.error);
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
    sv('#ni-e-min-chars', params.minChars ?? ENRICH_MIN_CHARS);
    const enforceMinEl = q('#ni-e-enforce-min');
    if (enforceMinEl) enforceMinEl.checked = params.enforceMinChars === true;
    const safetyEl = q('#ni-e-safety-enabled');
    if (safetyEl) safetyEl.checked = safety.enabled !== false;
    const wordsEl = q('#ni-e-safety-words');
    if (wordsEl) wordsEl.value = (safety.sensitiveWords || []).join('\n');
    niEnrichRenderTemplateSelect();
}


jQuery(async () => {
  try {

    // ── 顶栏 Drawer───────────
    const settingsHtml = await renderExtensionTemplateAsync(EXT_FOLDER, 'template');

    // 插入顶栏抽屉
    const drawerHtml = `
      <div id="ni_drawer" class="drawer">
        <div class="drawer-toggle">
          <div id="ni_drawer_icon"
               class="drawer-icon fa-solid fa-book-open fa-fw closedIcon interactable"
               title="Novel Injector - 小说加料"
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

    // ── 用 jQuery 事件绑定 ──────────
    const $app = $('#ni-app');

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
    $app.on('change', '#ni-j-safety-veto', function () {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.sceneConfig = { ...niSceneConfig(), safetyVetoEnabled: this.checked };
        saveSettingsDebounced?.();
        toastr?.info(this.checked ? '安全否决已开启' : '安全否决已关闭（不做未成年/非自愿/多人男词法否决）');
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
        niEnrichSaveParams({ maxTokens: Math.min(65536, Math.max(256, parseInt(this.value, 10) || 4000)) });
    });
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

    // 加载设置
    niLoadSettings();
    niSyncTopbarIconVisibility();
    niEnsureExtensionsMenuTopbarToggle();

    // 插件总开关
        $app.on('change', '#ni-plugin-chk', () => niTogglePlugin());
    // 自动保存
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

    // 导入/导出
        $app.on('click', '#ni-export-btn', () => niExportData());
    $app.on('click', '#ni-import-btn', () => q('#ni-import-fi')?.click());
    $app.on('change', '#ni-import-fi', function() {
        const f = this.files?.[0];
        if (f) { niImportData(f); this.value = ''; }
    });

    console.log('[NI] 小说加料插件 加载完成');
  } catch (err) {
    console.error('[NI] 初始化异常（导航已由全局绑定兜底，其余功能可能部分失效）:', err);
    toastr?.error?.('[NI] 初始化异常：' + (err?.message || err));
  }
});

