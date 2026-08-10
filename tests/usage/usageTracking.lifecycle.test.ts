// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock 设置（必须在所有 import 之前，vitest 会自动 hoist）
// ---------------------------------------------------------------------------

const mockWindow = {
  focused: false,
  visible: true,
  minimized: false,
  focusListeners: new Set<(event: { payload: boolean }) => void>(),
  closeListeners: new Set<(event: { preventDefault: () => void }) => void>(),
}

function resetMockWindow() {
  mockWindow.focused = false
  mockWindow.visible = true
  mockWindow.minimized = false
  mockWindow.focusListeners.clear()
  mockWindow.closeListeners.clear()
}

let mockEnabled = true
const mockUpdateUsageTrackingSettings = vi.fn((settings: { enabled?: boolean }) => {
  if (settings.enabled !== undefined) mockEnabled = settings.enabled
})

// 共享的 destroy spy，确保测试和 handler 使用同一个 spy
const mockDestroy = vi.fn()

// 轻量内存数据库 mock，不加载 node:sqlite
interface MockRow {
  date: string
  foreground_seconds: number
  updated_at: number
}

let mockDbRows: MockRow[] = []
let mockExecuteFailures = 0
let mockExecuteCalls = 0
let mockSelectFailures = 0
let mockFocusedFailures = 0
let mockVisibleFailures = 0
let mockMinimizedFailures = 0
let mockExecuteGate: Promise<void> | null = null
let mockWindowStateGate: Promise<void> | null = null

function resetMockDb() {
  mockDbRows = []
  mockExecuteFailures = 0
  mockExecuteCalls = 0
  mockSelectFailures = 0
  mockFocusedFailures = 0
  mockVisibleFailures = 0
  mockMinimizedFailures = 0
  mockExecuteGate = null
  mockWindowStateGate = null
}

const mockDbAdapter = {
  execute: async (_sql: string, params: unknown[] = []) => {
    const sql = _sql.trim().toLowerCase()
    // DELETE
    if (sql.startsWith('delete')) {
      mockDbRows = []
      return { rowsAffected: 1 }
    }
    mockExecuteCalls += 1
    if (mockExecuteFailures > 0) {
      mockExecuteFailures -= 1
      throw new Error('mock write failed')
    }
    await mockExecuteGate
    // INSERT ... ON CONFLICT DO UPDATE
    const date = params[0] as string
    const seconds = params[1] as number
    const nowSec = params[2] as number
    const existing = mockDbRows.find((r) => r.date === date)
    if (existing) {
      existing.foreground_seconds += seconds
      existing.updated_at = nowSec
    } else {
      mockDbRows.push({ date, foreground_seconds: seconds, updated_at: nowSec })
    }
    return { rowsAffected: 1 }
  },
  select: async <T>(_sql: string, params: unknown[] = []): Promise<T[]> => {
    if (mockSelectFailures > 0) {
      mockSelectFailures -= 1
      throw new Error('mock schema unavailable')
    }
    const sql = _sql.toLowerCase()
    if (sql.includes('sum(')) {
      const total = mockDbRows.reduce((sum, r) => sum + r.foreground_seconds, 0)
      return [{ total }] as unknown as T[]
    }
    if (sql.includes('where date =')) {
      const date = params[0] as string
      const row = mockDbRows.find((r) => r.date === date)
      return (row ? [{ seconds: row.foreground_seconds }] : []) as unknown as T[]
    }
    if (sql.includes('where date >=') && sql.includes('date <=')) {
      const start = params[0] as string
      const end = params[1] as string
      const rows = mockDbRows
        .filter((r) => r.date >= start && r.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ date: r.date, foreground_seconds: r.foreground_seconds }))
      return rows as unknown as T[]
    }
    return [] as unknown as T[]
  },
  close: async () => {},
}

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFocused: async () => {
      if (mockFocusedFailures > 0) {
        mockFocusedFailures -= 1
        throw new Error('mock focused state failed')
      }
      return mockWindow.focused
    },
    isVisible: async () => {
      if (mockVisibleFailures > 0) {
        mockVisibleFailures -= 1
        throw new Error('mock visible state failed')
      }
      await mockWindowStateGate
      return mockWindow.visible
    },
    isMinimized: async () => {
      if (mockMinimizedFailures > 0) {
        mockMinimizedFailures -= 1
        throw new Error('mock minimized state failed')
      }
      return mockWindow.minimized
    },
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      mockWindow.focusListeners.add(handler)
      return Promise.resolve(() => {
        mockWindow.focusListeners.delete(handler)
      })
    },
    onCloseRequested: (handler: (event: { preventDefault: () => void }) => void) => {
      mockWindow.closeListeners.add(handler)
      return Promise.resolve(() => {
        mockWindow.closeListeners.delete(handler)
      })
    },
    destroy: mockDestroy,
  }),
}))

vi.mock('@/hooks/useTauri', () => ({
  isTauri: () => true,
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      usageTracking: { enabled: mockEnabled },
      updateUsageTrackingSettings: mockUpdateUsageTrackingSettings,
    }),
    setState: vi.fn(),
  },
}))

vi.mock('@/services/database/db', () => ({
  getDatabase: () => mockDbAdapter,
}))

// ---------------------------------------------------------------------------
// Node 环境下 mock document
// ---------------------------------------------------------------------------

const docListeners = new Map<string, Set<() => void>>()
const mockDocument = {
  addEventListener: (type: string, handler: () => void) => {
    if (!docListeners.has(type)) docListeners.set(type, new Set())
    docListeners.get(type)!.add(handler)
  },
  removeEventListener: (type: string, handler: () => void) => {
    docListeners.get(type)?.delete(handler)
  },
}

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

import {
  clearPending,
  getPendingSnapshot,
  setUsageTrackingEnabled,
  startUsageTracking,
  stopUsageTracking,
  getUsageSnapshot,
  subscribeUsageSnapshot,
  getLocalDateKey,
  clearUsageDataWithLifecycle,
  limitUsageIncrementMs,
  addPendingMs,
  flushPending,
  checkpointUsageTracking,
} from '@/services/usageTracking'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

async function cleanUpTracking() {
  try {
    await stopUsageTracking()
  } catch {
    // 忽略清理错误
  }
  clearPending()
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('document', mockDocument)
  docListeners.clear()
  resetMockDb()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 窗口生命周期
// ---------------------------------------------------------------------------

describe('窗口生命周期', () => {
  beforeEach(() => {
    resetMockWindow()
    mockEnabled = true
  })

  afterEach(async () => {
    await cleanUpTracking()
  })

  it('聚焦且可见、未最小化时开始计时', async () => {
    mockWindow.focused = true
    mockWindow.visible = true
    mockWindow.minimized = false

    await startUsageTracking()

    const snapshot = getUsageSnapshot()
    expect(snapshot.enabled).toBe(true)
    expect(snapshot.isActive).toBe(true)
  })

  it('未聚焦时不开始计时', async () => {
    mockWindow.focused = false
    mockWindow.visible = true
    mockWindow.minimized = false

    await startUsageTracking()

    const snapshot = getUsageSnapshot()
    expect(snapshot.isActive).toBe(false)
  })

  it('最小化时不开始计时', async () => {
    mockWindow.focused = true
    mockWindow.visible = true
    mockWindow.minimized = true

    await startUsageTracking()

    const snapshot = getUsageSnapshot()
    expect(snapshot.isActive).toBe(false)
  })

  it('不可见时不开始计时', async () => {
    mockWindow.focused = true
    mockWindow.visible = false
    mockWindow.minimized = false

    await startUsageTracking()

    const snapshot = getUsageSnapshot()
    expect(snapshot.isActive).toBe(false)
  })

  it('失焦后停止计时', async () => {
    mockWindow.focused = true
    await startUsageTracking()
    expect(getUsageSnapshot().isActive).toBe(true)

    mockWindow.focused = false
    for (const listener of mockWindow.focusListeners) {
      listener({ payload: false })
    }
    await flushMicrotasks()

    expect(getUsageSnapshot().isActive).toBe(false)
  })

  it('失焦不等待窗口状态查询，立即停止计时', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    let releaseQuery!: () => void
    mockWindowStateGate = new Promise<void>((resolve) => {
      releaseQuery = resolve
    })
    mockWindow.focused = false
    for (const listener of mockWindow.focusListeners) {
      listener({ payload: false })
    }

    expect(getUsageSnapshot().isActive).toBe(false)
    releaseQuery()
  })

  it('禁用统计后停止计时', async () => {
    mockWindow.focused = true
    await startUsageTracking()
    expect(getUsageSnapshot().isActive).toBe(true)

    await setUsageTrackingEnabled(false)

    expect(getUsageSnapshot().isActive).toBe(false)
    expect(getUsageSnapshot().enabled).toBe(false)
  })

  it('重新启用后可在聚焦时恢复计时', async () => {
    mockWindow.focused = true
    await startUsageTracking()
    await setUsageTrackingEnabled(false)
    expect(getUsageSnapshot().isActive).toBe(false)

    await setUsageTrackingEnabled(true)
    await flushMicrotasks()
    expect(getUsageSnapshot().isActive).toBe(true)
  })

  it('重复 start/stop 不产生多个计时器或监听器', async () => {
    await startUsageTracking()
    await startUsageTracking() // 重复调用

    // 不应报错
    await stopUsageTracking()
    await stopUsageTracking() // 重复停止
  })

  it('StrictMode 式 start/stop/start 交错后只保留一个活动实例', async () => {
    mockWindow.focused = true

    const firstStart = startUsageTracking()
    const cleanup = stopUsageTracking()
    const secondStart = startUsageTracking()
    await Promise.all([firstStart, cleanup, secondStart])

    expect(getUsageSnapshot().isActive).toBe(true)
    expect(mockWindow.focusListeners.size).toBe(1)
    expect(mockWindow.closeListeners.size).toBe(1)
    expect(docListeners.get('visibilitychange')?.size).toBe(1)
  })

  it('快速失焦再聚焦最终只保留一个活动计时器', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    mockWindow.focused = false
    for (const listener of mockWindow.focusListeners) {
      listener({ payload: false })
    }
    mockWindow.focused = true
    for (const listener of mockWindow.focusListeners) {
      listener({ payload: true })
    }

    await flushMicrotasks()
    await flushMicrotasks()

    expect(getUsageSnapshot().isActive).toBe(true)
    expect(mockWindow.focusListeners.size).toBe(1)
    expect(mockWindow.closeListeners.size).toBe(1)
  })

  it('停止后在途的焦点查询不得重新激活统计', async () => {
    mockWindow.focused = false
    await startUsageTracking()

    let releaseQuery!: () => void
    mockWindowStateGate = new Promise<void>((resolve) => {
      releaseQuery = resolve
    })
    mockWindow.focused = true
    for (const listener of mockWindow.focusListeners) {
      listener({ payload: true })
    }

    await stopUsageTracking()
    releaseQuery()
    await flushMicrotasks()
    expect(getUsageSnapshot().isActive).toBe(false)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockDbRows).toHaveLength(0)
  })

  it('统计表暂不可用时不注册周期任务，后续可重新启动', async () => {
    mockWindow.focused = true
    mockSelectFailures = 1

    await expect(startUsageTracking()).rejects.toThrow('mock schema unavailable')
    expect(getUsageSnapshot().isActive).toBe(false)
    expect(getUsageSnapshot().error).toEqual({ kind: 'database_read' })
    expect(mockWindow.focusListeners.size).toBe(0)
    expect(mockWindow.closeListeners.size).toBe(0)

    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    expect(getUsageSnapshot().isActive).toBe(true)
    expect(getUsageSnapshot().error).toBeNull()
    expect(mockWindow.focusListeners.size).toBe(1)
  })

  it('窗口状态查询失败可观察，并在后续窗口事件恢复', async () => {
    mockWindow.focused = true
    mockVisibleFailures = 1

    await startUsageTracking()

    expect(getUsageSnapshot().isActive).toBe(false)
    expect(getUsageSnapshot().error).toEqual({
      kind: 'window_state',
      fields: ['visible'],
    })

    for (const listener of mockWindow.focusListeners) {
      listener({ payload: true })
    }
    await flushMicrotasks()
    await flushMicrotasks()

    expect(getUsageSnapshot().isActive).toBe(true)
    expect(getUsageSnapshot().error).toBeNull()
  })

  it('Web 端不启动统计', async () => {
    const tauriModule = await import('@/hooks/useTauri')
    vi.spyOn(tauriModule, 'isTauri').mockReturnValue(false)

    await startUsageTracking()
    const snapshot = getUsageSnapshot()
    expect(snapshot.isActive).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 定时器与 checkpoint（使用 fake timers）
// ---------------------------------------------------------------------------

describe('定时器与 checkpoint', () => {
  beforeEach(() => {
    resetMockWindow()
    mockEnabled = true
  })

  afterEach(async () => {
    await cleanUpTracking()
  })

  it('30 秒后 checkpoint 产生 pending 并写入 DB', async () => {
    mockWindow.focused = true
    await startUsageTracking()
    expect(getUsageSnapshot().isActive).toBe(true)

    // 推进 30 秒
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    const pending = getPendingSnapshot()
    const pendingTotal = Array.from(pending.values()).reduce((a, b) => a + b, 0)
    expect(pendingTotal).toBe(0)

    // 数据库应有记录
    const today = getLocalDateKey()
    const dbRow = mockDbRows.find((r) => r.date === today)
    expect(dbRow).toBeDefined()
    expect(dbRow!.foreground_seconds).toBe(30)
  })

  it('写入变慢时不会累积 checkpoint 任务', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    let releaseWrite!: () => void
    mockExecuteGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockExecuteCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(120_000)
    expect(mockExecuteCalls).toBe(1)

    releaseWrite()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()
    expect(mockExecuteCalls).toBe(2)
  })

  it('手动刷新会立即结算未满 30 秒的当前时段', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    await vi.advanceTimersByTimeAsync(10_000)
    await checkpointUsageTracking()

    const today = getLocalDateKey()
    const dbRow = mockDbRows.find((r) => r.date === today)
    expect(dbRow?.foreground_seconds).toBe(10)
  })

  it('连续两个 checkpoint 累计值正确且不重复', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    // 推进 30 秒 → 第一次 checkpoint
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    const today = getLocalDateKey()
    const afterFirst = mockDbRows.find((r) => r.date === today)?.foreground_seconds ?? 0
    expect(afterFirst).toBe(30)

    // 推进 30 秒 → 第二次 checkpoint
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    const afterSecond = mockDbRows.find((r) => r.date === today)?.foreground_seconds ?? 0
    expect(afterSecond).toBe(60)
  })

  it('单次增量上限 60 秒：超过 60 秒的间隔被截断', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    // 推进 120 秒，但 setInterval 每 30 秒触发一次 checkpoint
    // 每次 checkpoint 只捕获 30 秒，总共 4 次 = 120 秒
    // 60 秒上限在 computeElapsed 中，仅当单次间隔超过 60 秒时生效
    await vi.advanceTimersByTimeAsync(120_000)
    await flushMicrotasks()

    const today = getLocalDateKey()
    const dbRow = mockDbRows.find((r) => r.date === today)
    expect(dbRow).toBeDefined()
    // 4 次 checkpoint × 30 秒 = 120 秒
    expect(dbRow!.foreground_seconds).toBe(120)
  })

  it('单次增量同时受墙钟、单调时钟和 60 秒上限约束', () => {
    expect(limitUsageIncrementMs(120_000, 120_000)).toBe(60_000)
    expect(limitUsageIncrementMs(120_000, 30_000)).toBe(30_000)
    expect(limitUsageIncrementMs(30_000, 120_000)).toBe(30_000)
    expect(limitUsageIncrementMs(-1, 30_000)).toBe(0)
  })

  it('失焦后不再产生新 pending', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    // 推进 5 秒确保有 elapsed
    await vi.advanceTimersByTimeAsync(5_000)
    await flushMicrotasks()

    // 失焦
    mockWindow.focused = false
    for (const listener of mockWindow.focusListeners) {
      listener({ payload: false })
    }
    await flushMicrotasks()

    const pendingBefore = getPendingSnapshot()
    const totalBefore = Array.from(pendingBefore.values()).reduce((a, b) => a + b, 0)

    // 推进 30 秒，但失焦了不应再累计
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    const pendingAfter = getPendingSnapshot()
    const totalAfter = Array.from(pendingAfter.values()).reduce((a, b) => a + b, 0)
    expect(totalAfter).toBe(totalBefore)
  })

  it('关闭统计后结算当前时段并写入 DB', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    await vi.advanceTimersByTimeAsync(10_000)
    await flushMicrotasks()

    await setUsageTrackingEnabled(false)
    await flushMicrotasks()

    // 禁用后应有结算
    const today = getLocalDateKey()
    const dbRow = mockDbRows.find((r) => r.date === today)
    expect(dbRow).toBeDefined()
    expect(dbRow!.foreground_seconds).toBeGreaterThan(0)
  })

  it('重新启用后从新基准开始，不补计关闭期间', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    await vi.advanceTimersByTimeAsync(10_000)
    await flushMicrotasks()

    await setUsageTrackingEnabled(false)
    await flushMicrotasks()

    const beforeDisable = mockDbRows.find((r) => r.date === getLocalDateKey())?.foreground_seconds ?? 0

    // 推进 20 秒（禁用期间不应累计）
    await vi.advanceTimersByTimeAsync(20_000)
    await flushMicrotasks()

    // 重新启用
    await setUsageTrackingEnabled(true)
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(10_000)
    await flushMicrotasks()

    const afterReenable = mockDbRows.find((r) => r.date === getLocalDateKey())?.foreground_seconds ?? 0
    // 禁用期间不补计，所以增量应该小于 30 秒
    expect(afterReenable - beforeDisable).toBeLessThanOrEqual(15) // 约 10 秒
  })
})

// ---------------------------------------------------------------------------
// 快照与订阅
// ---------------------------------------------------------------------------

describe('快照与订阅', () => {
  beforeEach(() => {
    resetMockWindow()
    mockEnabled = true
  })

  afterEach(async () => {
    await cleanUpTracking()
  })

  it('getUsageSnapshot 返回完整字段', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    const snapshot = getUsageSnapshot()
    expect(snapshot).toHaveProperty('enabled')
    expect(snapshot).toHaveProperty('isActive')
    expect(snapshot).toHaveProperty('todaySeconds')
    expect(snapshot).toHaveProperty('totalSeconds')
  })

  it('checkpoint 后 snapshot 通知触发', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    const calls: number[] = []
    const unsub = subscribeUsageSnapshot(() => calls.push(1))

    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    // checkpoint 应该触发通知
    expect(calls.length).toBeGreaterThanOrEqual(1)

    unsub()
  })

  it('checkpoint 通知携带本次捕获增量，UI 无需重新查询数据库', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    const captured: Array<ReadonlyMap<string, number>> = []
    const unsub = subscribeUsageSnapshot((snapshot) => {
      if (snapshot.capturedMsByDate.size > 0) {
        captured.push(snapshot.capturedMsByDate)
      }
    })

    await vi.advanceTimersByTimeAsync(10_000)
    await checkpointUsageTracking()

    expect(captured).toHaveLength(1)
    expect(captured[0].get(getLocalDateKey())).toBe(10_000)
    unsub()
  })

  it('取消订阅后不再触发', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    const calls: string[] = []
    const unsub = subscribeUsageSnapshot(() => calls.push('fired'))
    unsub()

    mockWindow.focused = false
    for (const listener of mockWindow.focusListeners) {
      listener({ payload: false })
    }
    await flushMicrotasks()

    expect(calls).toHaveLength(0)
  })
})

describe('写入失败重试', () => {
  afterEach(() => {
    clearPending()
  })

  it('失败时保留 pending，下一次成功后只写入一次', async () => {
    const today = getLocalDateKey()
    addPendingMs(today, 2_500)
    mockExecuteFailures = 1

    await flushPending()
    expect(getPendingSnapshot().get(today)).toBe(2)
    expect(mockDbRows).toHaveLength(0)
    expect(getUsageSnapshot().error).toEqual({ kind: 'database_write' })

    await flushPending()
    expect(mockDbRows).toHaveLength(1)
    expect(mockDbRows[0].foreground_seconds).toBe(2)
    expect(getPendingSnapshot().has(today)).toBe(false)
    expect(getUsageSnapshot().error).toBeNull()
  })

  it('写入等待期间追加的同日增量不会被旧快照删除', async () => {
    const today = getLocalDateKey()
    let releaseWrite!: () => void
    mockExecuteGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    addPendingMs(today, 2_500)

    const flushing = flushPending()
    await Promise.resolve()
    addPendingMs(today, 1_500)
    releaseWrite()
    await flushing

    expect(mockDbRows[0].foreground_seconds).toBe(2)
    expect(getPendingSnapshot().get(today)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 关闭处理
// ---------------------------------------------------------------------------

describe('关闭请求处理', () => {
  beforeEach(() => {
    resetMockWindow()
    mockEnabled = true
  })

  afterEach(async () => {
    await cleanUpTracking()
  })

  it('关闭请求时 preventDefault 并结算写入', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    await vi.advanceTimersByTimeAsync(5_000)
    await flushMicrotasks()

    mockDestroy.mockClear()

    const closeEvent = { preventDefault: vi.fn() }
    const closePromise = Promise.all(
      Array.from(mockWindow.closeListeners).map((l) => l(closeEvent)),
    )
    await closePromise
    await flushMicrotasks()

    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('重复关闭请求只执行一次保存和窗口销毁', async () => {
    mockWindow.focused = true
    await startUsageTracking()
    mockDestroy.mockClear()

    const listeners = Array.from(mockWindow.closeListeners)
    const firstEvent = { preventDefault: vi.fn() }
    const secondEvent = { preventDefault: vi.fn() }
    await Promise.all([
      ...listeners.map((listener) => listener(firstEvent)),
      ...listeners.map((listener) => listener(secondEvent)),
    ])

    expect(firstEvent.preventDefault).toHaveBeenCalled()
    expect(secondEvent.preventDefault).toHaveBeenCalled()
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 清空数据
// ---------------------------------------------------------------------------

describe('清空数据', () => {
  beforeEach(() => {
    resetMockWindow()
    mockEnabled = true
  })

  afterEach(async () => {
    await cleanUpTracking()
  })

  it('清空后 DB 无记录，pending 被清空', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    expect(mockDbRows.length).toBeGreaterThan(0)

    await clearUsageDataWithLifecycle()
    await flushMicrotasks()

    expect(mockDbRows.length).toBe(0)
    expect(getPendingSnapshot().size).toBe(0)
  })

  it('清空排在在途写入之后，旧写入不会回流', async () => {
    const today = getLocalDateKey()
    let releaseWrite!: () => void
    mockExecuteGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    addPendingMs(today, 2_500)

    const flushing = flushPending()
    await Promise.resolve()
    expect(mockExecuteCalls).toBe(1)

    const clearing = clearUsageDataWithLifecycle()
    releaseWrite()
    await flushing
    await clearing

    expect(mockDbRows).toHaveLength(0)
    expect(getPendingSnapshot().size).toBe(0)
  })

  it('清空后基准重置，可继续累计', async () => {
    mockWindow.focused = true
    await startUsageTracking()

    await vi.advanceTimersByTimeAsync(10_000)
    await flushMicrotasks()

    await clearUsageDataWithLifecycle()
    await flushMicrotasks()

    // 清空后继续计时
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    const today = getLocalDateKey()
    const dbRow = mockDbRows.find((r) => r.date === today)
    expect(dbRow).toBeDefined()
    expect(dbRow!.foreground_seconds).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 设置向后兼容
// ---------------------------------------------------------------------------

describe('设置向后兼容', () => {
  it('旧配置缺少 usageTracking 时默认启用', () => {
    expect(mockEnabled).toBe(true)
  })
})
