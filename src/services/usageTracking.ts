/**
 * 使用时长统计服务。
 * 提供纯时间计算函数、基于 SQLite 的数据访问，以及窗口生命周期状态机。
 */

import { getDatabase } from '@/services/database/db'
import { isTauri } from '@/hooks/useTauri'
import { useSettingsStore } from '@/stores/settingsStore'

// ---------------------------------------------------------------------------
// 纯函数：本地日期、范围、拆分、格式化、等级
// ---------------------------------------------------------------------------

/**
 * 返回本地时间的 YYYY-MM-DD 日期键，不依赖 UTC `toISOString()`。
 */
export function getLocalDateKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 返回最近 12 个自然月的起止日期（从首月 1 日到今天）。
 */
export function getTwelveMonthRange(
  today: Date = new Date(),
): { start: string; end: string } {
  const end = getLocalDateKey(today)
  const startDate = new Date(today.getFullYear(), today.getMonth() - 11, 1)
  const start = getLocalDateKey(startDate)
  return { start, end }
}

/**
 * 将 [startMs, endMs] 区间按本地零点拆分到对应日期。
 * 返回每个日期对应的毫秒数。
 */
export function splitIntervalByMidnight(
  startMs: number,
  endMs: number,
): Array<{ date: string; ms: number }> {
  const normalizedStartMs = Number.isFinite(startMs) ? Math.trunc(startMs) : null
  const normalizedEndMs = Number.isFinite(endMs) ? Math.trunc(endMs) : null
  const maxDateMs = 8.64e15
  if (
    normalizedStartMs === null ||
    normalizedEndMs === null ||
    Math.abs(normalizedStartMs) > maxDateMs ||
    Math.abs(normalizedEndMs) > maxDateMs ||
    normalizedEndMs <= normalizedStartMs
  ) {
    return []
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000
  const maxSegments = 10_000
  const estimatedSegments =
    Math.ceil((normalizedEndMs - normalizedStartMs) / millisecondsPerDay) + 1
  if (estimatedSegments > maxSegments) {
    throw new RangeError(
      `splitIntervalByMidnight exceeded the maximum number of segments (${maxSegments})`,
    )
  }

  const result: Array<{ date: string; ms: number }> = []
  let cursorMs = normalizedStartMs
  let iterations = 0

  while (cursorMs < normalizedEndMs) {
    iterations += 1
    if (iterations > maxSegments) {
      throw new RangeError(
        `splitIntervalByMidnight exceeded the maximum number of segments (${maxSegments})`,
      )
    }

    const cursor = new Date(cursorMs)
    const date = getLocalDateKey(cursor)
    // 当天 24:00:00.000 的毫秒时间戳
    const nextMidnight = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
      0,
      0,
      0,
      0,
    ).getTime()
    const segmentEnd = Math.min(nextMidnight, normalizedEndMs)
    if (!Number.isFinite(segmentEnd) || segmentEnd <= cursorMs) {
      throw new RangeError('splitIntervalByMidnight cursor did not advance')
    }
    result.push({ date, ms: segmentEnd - cursorMs })
    cursorMs = segmentEnd
  }

  return result
}

/**
 * 将总秒数格式化为可读时长字符串。
 * - 小于 1 分钟：`少于 1 分钟`
 * - 小于 1 小时：`xx 分钟`
 * - 大于等于 1 小时：`x 小时 xx 分钟`
 * - 没有记录：`0 分钟`
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 分钟'
  if (totalSeconds < 60) return '少于 1 分钟'
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    return `${totalMinutes} 分钟`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours} 小时 ${minutes} 分钟`
}

/**
 * 按完整分钟计算热力等级（固定区间，不动态缩放）：
 * - 0 分钟       → 0
 * - 1～30 分钟   → 1
 * - 31～59 分钟  → 2
 * - 60～119 分钟 → 3
 * - 120 分钟及以上 → 4
 */
export function getHeatLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0
  if (minutes <= 30) return 1
  if (minutes <= 59) return 2
  if (minutes <= 119) return 3
  return 4
}

const MAX_INCREMENT_MS = 60_000

/**
 * 同时参考单调时钟和墙钟，并限制单次可计入的最长时段。
 */
export function limitUsageIncrementMs(
  monotonicElapsed: number,
  wallElapsed: number,
): number {
  if (monotonicElapsed < 0 || wallElapsed < 0) return 0
  return Math.min(monotonicElapsed, wallElapsed, MAX_INCREMENT_MS)
}

// ---------------------------------------------------------------------------
// 数据访问
// ---------------------------------------------------------------------------

interface UsageDailyRow {
  date: string
  foreground_seconds: number
  updated_at: number
}

/**
 * 参数化增量 UPSERT：向指定日期累加秒数。
 */
export async function upsertUsageSeconds(
  date: string,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return
  const db = getDatabase()
  const nowSec = Math.floor(Date.now() / 1000)
  await db.execute(
    `INSERT INTO usage_daily (date, foreground_seconds, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(date) DO UPDATE SET
       foreground_seconds = foreground_seconds + excluded.foreground_seconds,
       updated_at = excluded.updated_at`,
    [date, seconds, nowSec],
  )
}

/**
 * 查询全部累计使用秒数。
 */
export async function queryUsageTotal(): Promise<number> {
  try {
    const db = getDatabase()
    const rows = await db.select<{ total: number }>(
      `SELECT COALESCE(SUM(foreground_seconds), 0) AS total FROM usage_daily`,
    )
    const total = rows[0]?.total ?? 0
    clearTrackingError('database_read')
    return total
  } catch (error) {
    setTrackingError({ kind: 'database_read' })
    throw error
  }
}

/**
 * 查询今日使用秒数。
 */
export async function queryUsageToday(): Promise<number> {
  try {
    const db = getDatabase()
    const today = getLocalDateKey()
    const rows = await db.select<{ seconds: number }>(
      `SELECT foreground_seconds AS seconds FROM usage_daily WHERE date = $1`,
      [today],
    )
    const seconds = rows[0]?.seconds ?? 0
    clearTrackingError('database_read')
    return seconds
  } catch (error) {
    setTrackingError({ kind: 'database_read' })
    throw error
  }
}

/**
 * 查询日期范围内的每日秒数，返回 Map<date, seconds>。
 */
export async function queryUsageRange(
  start: string,
  end: string,
): Promise<Map<string, number>> {
  try {
    const db = getDatabase()
    const rows = await db.select<UsageDailyRow>(
      `SELECT date, foreground_seconds FROM usage_daily
       WHERE date >= $1 AND date <= $2
       ORDER BY date`,
      [start, end],
    )
    const result = new Map<string, number>()
    for (const row of rows) {
      result.set(row.date, row.foreground_seconds)
    }
    clearTrackingError('database_read')
    return result
  } catch (error) {
    setTrackingError({ kind: 'database_read' })
    throw error
  }
}

/**
 * 清空全部使用时长数据。
 */
export async function clearUsageData(): Promise<void> {
  try {
    const db = getDatabase()
    await db.execute(`DELETE FROM usage_daily`)
  } catch (error) {
    setTrackingError({ kind: 'database_write' })
    throw error
  }
}

// ---------------------------------------------------------------------------
// Pending 毫秒/整秒转换与逐日期确认
// ---------------------------------------------------------------------------

const pendingMs = new Map<string, number>()

/** 向指定日期累加待写毫秒数。 */
export function addPendingMs(date: string, ms: number): void {
  if (ms <= 0) return
  const current = pendingMs.get(date) ?? 0
  pendingMs.set(date, current + ms)
}

/** 返回指定日期当前待写毫秒数对应的整秒（向下取整）。 */
export function getPendingSeconds(date: string): number {
  const ms = pendingMs.get(date) ?? 0
  return Math.floor(ms / 1000)
}

/** 返回所有待写日期及其整秒数。 */
export function getPendingSnapshot(): Map<string, number> {
  const snapshot = new Map<string, number>()
  for (const [date, ms] of pendingMs) {
    const seconds = Math.floor(ms / 1000)
    if (seconds > 0) {
      snapshot.set(date, seconds)
    }
  }
  return snapshot
}

/**
 * 将 pending 中的整秒写入数据库，逐日期确认：
 * - 写入成功才扣除对应整秒；
 * - 写入失败保留该日增量，下次重试。
 */
async function flushPendingInternal(): Promise<void> {
  const entries = Array.from(pendingMs.entries())
  let attempted = false
  let failed = false
  for (const [date, ms] of entries) {
    const seconds = Math.floor(ms / 1000)
    if (seconds <= 0) continue
    attempted = true
    try {
      await upsertUsageSeconds(date, seconds)
      // 成功：扣除已写入的整秒，保留不足一秒余数
      // 写入期间可能发生失焦/关闭结算，并向同一天追加新毫秒。
      // 必须从当前值扣除本次已确认秒数，不能用 flush 开始时的旧快照覆盖新增量。
      const currentMs = pendingMs.get(date) ?? 0
      const remaining = currentMs - seconds * 1000
      if (remaining <= 0) {
        pendingMs.delete(date)
      } else {
        pendingMs.set(date, remaining)
      }
    } catch {
      failed = true
      // 失败：保留该日增量，下次重试；只暴露匿名错误类别。
      setTrackingError({ kind: 'database_write' })
    }
  }
  if (attempted && !failed) clearTrackingError('database_write')
}

/**
 * 串行执行 pending 写入，避免与生命周期结算或清空操作交错。
 */
export function flushPending(): Promise<void> {
  return enqueueLifecycle(() => flushPendingInternal())
}

/** 清空 pending map。 */
export function clearPending(): void {
  pendingMs.clear()
}

// ---------------------------------------------------------------------------
// 窗口生命周期状态机
// ---------------------------------------------------------------------------

const CHECKPOINT_INTERVAL_MS = 30_000

export type UsageWindowStateField = 'focused' | 'visible' | 'minimized'

export type UsageTrackingError =
  | { kind: 'startup' }
  | { kind: 'window_state'; fields: readonly UsageWindowStateField[] }
  | { kind: 'database_read' }
  | { kind: 'database_write' }

interface UsageSnapshot {
  enabled: boolean
  isActive: boolean
  todaySeconds: number
  totalSeconds: number
  capturedMsByDate: ReadonlyMap<string, number>
  reset: boolean
  error: UsageTrackingError | null
}

type SnapshotListener = (snapshot: UsageSnapshot) => void

type TrackingState = 'stopped' | 'inactive' | 'active' | 'stopping'

let trackingState: TrackingState = 'stopped'
let checkpointTimer: ReturnType<typeof setTimeout> | null = null
let wallClockBase = 0
let monotonicBase = 0
let generation = 0
let unlistenFocus: (() => void) | null = null
let unlistenVisibility: (() => void) | null = null
let trackingRequested = false
let trackingError: UsageTrackingError | null = null
let startupRetryTimer: ReturnType<typeof setTimeout> | null = null
let startupRetryAttempt = 0

const STARTUP_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const

const snapshotListeners = new Set<SnapshotListener>()

// 生命周期、结算和清空共用一条 Promise 链，避免状态转换和写入交错。
let lifecycleQueue: Promise<void> = Promise.resolve()

function enqueueLifecycle(fn: () => Promise<void>): Promise<void> {
  const task = lifecycleQueue.then(fn, fn)
  lifecycleQueue = task.catch(() => {})
  return task
}

function setTrackingError(error: UsageTrackingError): void {
  trackingError = error
  notifyListeners()
}

function clearTrackingError(kind: UsageTrackingError['kind']): void {
  if (trackingError?.kind !== kind) return
  trackingError = null
  notifyListeners()
}

function clearStartupRetry(): void {
  if (startupRetryTimer !== null) {
    clearTimeout(startupRetryTimer)
    startupRetryTimer = null
  }
}

function scheduleStartupRetry(): void {
  if (
    !trackingRequested ||
    startupRetryTimer !== null ||
    startupRetryAttempt >= STARTUP_RETRY_DELAYS_MS.length
  ) {
    return
  }

  const delay = STARTUP_RETRY_DELAYS_MS[startupRetryAttempt]
  startupRetryAttempt += 1
  startupRetryTimer = setTimeout(() => {
    startupRetryTimer = null
    void startUsageTracking().catch(() => {})
  }, delay)
}

interface WindowState {
  focused: boolean
  visible: boolean
  minimized: boolean
}

interface WindowStateResult {
  state: WindowState
  error: Extract<UsageTrackingError, { kind: 'window_state' }> | null
}

async function queryWindowState(): Promise<WindowStateResult> {
  if (!isTauri()) {
    return {
      state: { focused: false, visible: false, minimized: true },
      error: null,
    }
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const results = await Promise.allSettled([
      win.isFocused(),
      win.isVisible(),
      win.isMinimized(),
    ])
    const fields: UsageWindowStateField[] = []
    const values: boolean[] = []
    const fieldNames: UsageWindowStateField[] = ['focused', 'visible', 'minimized']

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        values[index] = result.value
      } else {
        values[index] = false
        fields.push(fieldNames[index])
      }
    })

    return {
      state: {
        focused: values[0],
        visible: values[1],
        minimized: values[2],
      },
      error: fields.length > 0 ? { kind: 'window_state', fields } : null,
    }
  } catch {
    return {
      state: { focused: false, visible: false, minimized: true },
      error: {
        kind: 'window_state',
        fields: ['focused', 'visible', 'minimized'],
      },
    }
  }
}

function shouldBeActive(focused: boolean, visible: boolean, minimized: boolean): boolean {
  const enabled = useSettingsStore.getState().usageTracking.enabled
  const started = trackingState === 'inactive' || trackingState === 'active'
  return trackingRequested && started && enabled && focused && visible && !minimized
}

function resetBases(): void {
  wallClockBase = Date.now()
  monotonicBase = performance.now()
}

function computeElapsed(): number {
  const monotonicElapsed = performance.now() - monotonicBase
  const wallElapsed = Date.now() - wallClockBase
  // 系统时间倒退或墙钟差值为负，放弃本次增量
  if (wallElapsed < 0 || monotonicElapsed < 0) {
    resetBases()
    return 0
  }
  return Math.floor(limitUsageIncrementMs(monotonicElapsed, wallElapsed))
}

function captureAndReset(): { wallBase: number; elapsed: number } {
  const wallBase = wallClockBase
  const elapsed = computeElapsed()
  resetBases()
  return { wallBase, elapsed }
}

async function doCheckpoint(): Promise<void> {
  const { wallBase, elapsed } = captureAndReset()
  if (elapsed <= 0) return

  const segments = splitIntervalByMidnight(wallBase, wallBase + elapsed)
  for (const seg of segments) {
    addPendingMs(seg.date, seg.ms)
  }
  await flushPendingInternal()
  notifyListeners(new Map(segments.map((segment) => [segment.date, segment.ms])))
}

function scheduleCheckpoint(): void {
  if (checkpointTimer !== null || trackingState !== 'active') return

  checkpointTimer = setTimeout(() => {
    checkpointTimer = null
    void enqueueLifecycle(async () => {
      if (trackingState !== 'active') return
      await doCheckpoint()
      if (trackingState === 'active') scheduleCheckpoint()
    })
  }, CHECKPOINT_INTERVAL_MS)
}

function startTimer(): void {
  if (checkpointTimer !== null) return
  trackingState = 'active'
  resetBases()
  scheduleCheckpoint()
  console.log('[UsageTracking] timer started (step4: checkpoint on)')
}

async function stopTimer(): Promise<void> {
  if (checkpointTimer !== null) {
    clearTimeout(checkpointTimer)
    checkpointTimer = null
  }
  // 结算当前时段
  const { wallBase, elapsed } = captureAndReset()
  const capturedMsByDate = new Map<string, number>()
  if (elapsed > 0) {
    const segments = splitIntervalByMidnight(wallBase, wallBase + elapsed)
    for (const seg of segments) {
      addPendingMs(seg.date, seg.ms)
      capturedMsByDate.set(seg.date, seg.ms)
    }
  }
  await flushPendingInternal()
  notifyListeners(capturedMsByDate)
}

async function activate(): Promise<void> {
  if (trackingState !== 'inactive') return
  startTimer()
  notifyListeners()
}

async function deactivate(): Promise<void> {
  if (trackingState !== 'active' && trackingState !== 'stopping') return
  trackingState = 'stopping'
  await stopTimer()
  trackingState = 'inactive'
  notifyListeners()
}

async function stopTrackingInternal(): Promise<void> {
  if (trackingState === 'stopped') return

  const shouldCapture = trackingState === 'active' || checkpointTimer !== null
  trackingState = 'stopping'
  if (shouldCapture) {
    await stopTimer()
  }
  trackingState = 'stopped'
  notifyListeners()
}

async function reevaluateState(): Promise<void> {
  const gen = ++generation
  const result = await queryWindowState()
  // 竞态保护：旧查询结果不得覆盖新事件
  if (gen !== generation) return

  if (result.error) {
    setTrackingError(result.error)
    if (trackingState === 'active') await deactivate()
    return
  }
  clearTrackingError('window_state')

  const state = result.state
  const shouldActivate = shouldBeActive(state.focused, state.visible, state.minimized)
  if (shouldActivate && trackingState === 'inactive') {
    await activate()
  } else if (!shouldActivate && trackingState === 'active') {
    await deactivate()
  }
}

function notifyListeners(
  capturedMsByDate: ReadonlyMap<string, number> = new Map(),
  reset = false,
): void {
  const snapshot = { ...getUsageSnapshot(), capturedMsByDate, reset }
  for (const listener of snapshotListeners) {
    try { listener(snapshot) } catch { /* swallow */ }
  }
}

async function registerWindowListeners(): Promise<void> {
  if (!isTauri()) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()

  // 焦点变化
  unlistenFocus = await win.onFocusChanged((event) => {
    const gen = ++generation
    const focused = event.payload
    if (!focused && trackingState === 'active') {
      trackingState = 'stopping'
      notifyListeners()
    }

    void enqueueLifecycle(async () => {
      if (
        !trackingRequested ||
        trackingState === 'stopped' ||
        (trackingState === 'stopping' && focused)
      ) {
        return
      }

      // 失焦是确定状态，不等待额外的窗口状态查询。
      if (!focused) {
        await deactivate()
        return
      }

      const result = await queryWindowState()
      if (gen !== generation || !trackingRequested) return
      if (result.error) {
        setTrackingError(result.error)
        if (trackingState === 'active') await deactivate()
        return
      }
      clearTrackingError('window_state')

      const state = result.state
      const shouldActivate = shouldBeActive(focused, state.visible, state.minimized)
      if (shouldActivate && trackingState === 'inactive') {
        await activate()
      } else if (!shouldActivate && trackingState === 'active') {
        await deactivate()
      }
    })
  })

  // 页面可见性
  const handleVisibility = (): void => {
    void enqueueLifecycle(() => reevaluateState())
  }
  document.addEventListener('visibilitychange', handleVisibility)
  unlistenVisibility = () => {
    document.removeEventListener('visibilitychange', handleVisibility)
  }
}

function unregisterWindowListeners(): void {
  unlistenFocus?.()
  unlistenFocus = null
  unlistenVisibility?.()
  unlistenVisibility = null
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 启动使用时长统计服务。
 * 仅在 Tauri 环境下生效；Web 端调用无副作用。
 */
export function startUsageTracking(): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  trackingRequested = true

  return enqueueLifecycle(async () => {
    if (!trackingRequested || trackingState !== 'stopped') return

    // Schema 只在桌面数据库初始化时创建。开发模式热更新若仍连接旧进程，
    // 先做一次轻量探测并停止启动，避免每 30 秒重复查询缺失表。
    try {
      await queryUsageToday()
    } catch (err) {
      trackingState = 'stopped'
      unregisterWindowListeners()
      scheduleStartupRetry()
      throw err
    }

    if (!trackingRequested) return

    try {
      trackingState = 'inactive'
      await registerWindowListeners()
      if (!trackingRequested) {
        trackingState = 'stopped'
        unregisterWindowListeners()
        return
      }
      await reevaluateState()
      startupRetryAttempt = 0
      clearStartupRetry()
      clearTrackingError('startup')
      clearTrackingError('database_read')
      console.log('[UsageTracking] started (step3: listeners on, checkpoint off)')
    } catch (err) {
      trackingState = 'stopped'
      unregisterWindowListeners()
      setTrackingError({ kind: 'startup' })
      scheduleStartupRetry()
      throw err
    }
  })
}

/**
 * 停止使用时长统计服务。
 * 会结算当前时段、保存、移除监听器。
 */
export function stopUsageTracking(): Promise<void> {
  trackingRequested = false
  clearStartupRetry()
  // 立即让所有尚未返回的窗口状态查询失效，避免停止/关闭后重新激活定时器。
  generation += 1

  return enqueueLifecycle(async () => {
    // StrictMode 的紧邻重启会覆盖前一个 cleanup，不应把新实例停掉。
    if (trackingRequested) return
    if (trackingState === 'stopped') {
      unregisterWindowListeners()
      return
    }
    await stopTrackingInternal()
    unregisterWindowListeners()
  })
}

/**
 * 启用或禁用使用时长统计。
 * 关闭时立即结算并保存；开启时重新评估窗口状态。
 */
export async function setUsageTrackingEnabled(enabled: boolean): Promise<void> {
  useSettingsStore.getState().updateUsageTrackingSettings({ enabled })

  if (trackingState === 'stopped') return

  await enqueueLifecycle(async () => {
    if (!trackingRequested || trackingState === 'stopped' || trackingState === 'stopping') {
      return
    }
    if (enabled) {
      await reevaluateState()
    } else {
      await deactivate()
    }
  })
}

/**
 * 获取当前使用统计快照。
 */
export function getUsageSnapshot(): UsageSnapshot {
  const enabled = useSettingsStore.getState().usageTracking.enabled
  const pendingSnapshot = getPendingSnapshot()
  const today = getLocalDateKey()
  const todaySeconds = pendingSnapshot.get(today) ?? 0
  let totalSeconds = 0
  for (const seconds of pendingSnapshot.values()) {
    totalSeconds += seconds
  }
  return {
    enabled,
    isActive: trackingState === 'active',
    todaySeconds,
    totalSeconds,
    capturedMsByDate: new Map(),
    reset: false,
    error: trackingError,
  }
}

/**
 * 立即结算当前前台时段，供设置页手动刷新使用。
 */
export async function checkpointUsageTracking(): Promise<void> {
  if (trackingState !== 'active') return
  await enqueueLifecycle(async () => {
    if (trackingState === 'active') await doCheckpoint()
  })
}

/**
 * 订阅快照变更。
 */
export function subscribeUsageSnapshot(listener: SnapshotListener): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/**
 * 清空全部使用时长数据。
 * 先停止结算当前时段，再清空数据库和内存，最后重置基准。
 */
export async function clearUsageDataWithLifecycle(): Promise<void> {
  await enqueueLifecycle(async () => {
    if (trackingState === 'active') {
      const { wallBase, elapsed } = captureAndReset()
      if (elapsed > 0) {
        const segments = splitIntervalByMidnight(wallBase, wallBase + elapsed)
        for (const seg of segments) {
          addPendingMs(seg.date, seg.ms)
        }
      }
      // 先结算再清空
      await flushPendingInternal()
    }
    await clearUsageData()
    clearPending()
    clearTrackingError('database_write')
    resetBases()
    notifyListeners(new Map(), true)
  })
}

// ---------------------------------------------------------------------------
// 按需加载活动数据
// ---------------------------------------------------------------------------

/**
 * 加载日期范围内的使用活动数据，合并数据库值与内存 pending。
 */
export async function loadUsageActivity(
  rangeStart: string,
  rangeEnd: string,
): Promise<Map<string, number>> {
  const dbData = await queryUsageRange(rangeStart, rangeEnd)
  // 合并 pending 中的整秒
  const pendingSnapshot = getPendingSnapshot()
  for (const [date, seconds] of pendingSnapshot) {
    if (date >= rangeStart && date <= rangeEnd) {
      const existing = dbData.get(date) ?? 0
      dbData.set(date, existing + seconds)
    }
  }
  return dbData
}
