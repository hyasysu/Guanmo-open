import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { perfCollector, type PerfSnapshot } from '@/services/perfCollector'
import { migratePerfReport } from '@/services/perfTypes'

const SYSTEM_SNAPSHOT: PerfSnapshot = {
  timestamp: 1,
  appWorkingSetKb: 1024,
  appPrivateWorkingSetKb: 900,
  appPrivateBytesKb: 1000,
  rustWorkingSetKb: 512,
  rustPrivateWorkingSetKb: 450,
  rustPrivateBytesKb: 500,
  webviewWorkingSetKb: 512,
  webviewPrivateWorkingSetKb: 450,
  webviewPrivateBytesKb: 500,
  webviewProcessCount: 1,
  rendererProcessCount: 1,
  gpuProcessCount: 0,
  utilityProcessCount: 0,
  cpuPercent: 2,
  cpuNormalizedPercent: 0.5,
  cpuCoreEquivalent: 0.02,
  systemCpuPercent: 15.3,
  processBreakdown: [],
}

describe('perfCollector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
    invoke.mockResolvedValue(SYSTEM_SNAPSHOT)
  })

  afterEach(() => {
    perfCollector.dispose()
    vi.useRealTimers()
  })

  it('默认按调用方间隔串行采样，不产生重叠任务', async () => {
    const onData = vi.fn()
    perfCollector.start(5000, onData)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onData).toHaveBeenCalledTimes(1)
    expect(onData.mock.calls[0][0]).toMatchObject(SYSTEM_SNAPSHOT)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onData).toHaveBeenCalledTimes(2)
  })

  it('读取旧报告时迁移旧字段语义', () => {
    const report = migratePerfReport({ history: [{ appMemoryKb: 10, webviewCount: 2, jsHeapUsed: 3 }] })
    expect(report.history[0]).toMatchObject({ appWorkingSetKb: 10, webviewProcessCount: 2, jsHeapUsedMb: 3 })
  })
})
