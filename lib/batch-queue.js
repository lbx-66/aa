// ============================================================
// 通用批量队列控制器（判定/加料共用）
// 从清洗控制器（createCleaningController）提炼的队列骨架：
// 开始 / 暂停 / 继续（重新收集未完成）/ 跳过当前 / 取消全部 / 进度回调 / 持久化回调。
// 状态由调用方保存在 item 上（章节 status），队列只负责编排与中止。
//
// 约定：
//  - isEligible(item) 为 true 的项会进入队列（如 status === 'undetected'）；
//  - processItem 成功时自行写入终态（judged/enriched），失败时自行写入 failed；
//  - 被中止（暂停/跳过）时队列负责调用 resetStatus / setSkippedStatus。
// ============================================================

export function createBatchQueueController({
    getItems = () => [],
    isEligible = () => true,
    processItem = async () => {},
    setProcessingStatus = () => {},
    setSkippedStatus = () => {},
    setFailedStatus = () => {},
    resetStatus = () => {},
    concurrency = () => 1,
    acquireSlot = null,
    onProgress = null,
    persist = () => {},
    AbortControllerClass = globalThis.AbortController,
    logger = console,
} = {}) {
    const state = {
        running: false,
        stop: false,
        skipIds: new Set(),
        controllers: new Map(),
        startedAt: 0,
    };
    let runPromise = null;

    const keyOf = (item, index) =>
        item && typeof item.id !== 'undefined' ? String(item.id) : String(index);

    function isRunning() {
        return state.running;
    }

    function collectQueue() {
        const items = Array.isArray(getItems()) ? getItems() : [];
        const queue = [];
        items.forEach((item, index) => {
            if (isEligible(item)) queue.push({ item, index });
        });
        return queue;
    }

    async function _run() {
        const queue = collectQueue();
        if (!queue.length) {
            onProgress?.({ running: false, done: 0, total: 0, note: '没有可处理的章节（队列为空）' });
            return false;
        }
        state.running = true;
        state.stop = false;
        state.skipIds = new Set();
        state.controllers = new Map();
        state.startedAt = Date.now();

        const total = queue.length;
        const workers = Math.max(1, Math.min(concurrency(), total));
        let cursor = 0;
        let completed = 0;

        const emit = (extra = {}) => onProgress?.({
            running: true,
            done: completed,
            total,
            current: null,
            note: `并发 ${workers} · 已完成 ${completed}/${total}`,
            ...extra,
        });

        emit({ note: `开始处理 · 并发 ${workers} · 共 ${total} 项` });

        await Promise.all(Array.from({ length: workers }, async () => {
            while (!state.stop) {
                const qi = cursor++;
                if (qi >= queue.length) break;
                const { item, index } = queue[qi];
                const key = keyOf(item, index);
                if (!isEligible(item)) { completed++; continue; } // 运行中被外部改状态
                const controller = new AbortControllerClass();
                state.controllers.set(key, controller);
                setProcessingStatus(item, index);
                emit({
                    current: item,
                    note: `处理中：${item?.title ?? item?.name ?? `第 ${index + 1} 项`} · ${completed}/${total}`,
                });
                try {
                    if (typeof acquireSlot === 'function') await acquireSlot(item, index, controller.signal);
                    await processItem(item, index, { signal: controller.signal });
                } catch (err) {
                    const wasSkipped = state.skipIds.has(key);
                    state.skipIds.delete(key);
                    if (wasSkipped) {
                        setSkippedStatus(item, index);
                    } else if (state.stop) {
                        resetStatus(item, index);
                    } else {
                        logger.warn?.('[BatchQueue] 处理失败:', err?.message || err);
                        setFailedStatus(item, index, err);
                    }
                } finally {
                    state.controllers.delete(key);
                    completed++;
                }
            }
        }));

        state.running = false;
        state.controllers.clear();
        const stopped = state.stop;
        onProgress?.({
            running: false,
            done: completed,
            total,
            note: stopped ? `已暂停 · ${completed}/${total} 完成` : `完成 · ${completed}/${total}`,
            paused: stopped,
            elapsedMs: Date.now() - state.startedAt,
        });
        try { persist(); } catch (e) { logger.warn?.('[BatchQueue] 持久化回调失败:', e); }
        return true;
    }

    /** 开始（或继续）：重新收集所有仍未完成的项。 */
    async function run(opts = {}) {
        if (state.running) return false;
        runPromise = _run();
        return runPromise;
    }

    /** 暂停：停止发起新任务，正在进行的请求中止；进行中项复位，未开始项保持待处理。 */
    function pause() {
        if (!state.running) return;
        state.stop = true;
        state.controllers.forEach(controller => controller.abort());
        try { persist(); } catch (_) {}
    }

    /** 跳过当前：终止进行中的最早一项并标记为跳过，立即继续下一项。 */
    function skipCurrent() {
        if (!state.running) return;
        const active = [...state.controllers.keys()];
        if (active.length) {
            state.skipIds.add(active[0]);
            state.controllers.get(active[0])?.abort();
        }
    }

    /** 取消全部：暂停 + 复位所有未开始项；已完成保留，等待 run() 重新开始。 */
    async function cancelAll() {
        if (!state.running) return;
        pause();
        await (runPromise?.catch?.(() => {}) ?? Promise.resolve());
        const queue = collectQueue();
        queue.forEach(({ item, index }) => resetStatus(item, index));
        try { persist(); } catch (_) {}
    }

    return { run, pause, skipCurrent, cancelAll, isRunning, collectQueue };
}
