import { invoke } from '@tauri-apps/api/core'
import { runtimeResourceTracker } from '@/services/runtimeResourceTracker'
import type { PerfData, ProcessSnapshot } from '@/services/perfTypes'
import type { ViewMode } from '@/stores/editorStore'

export type { PerfData, ProcessSnapshot as PerfSnapshot } from '@/services/perfTypes'

const EMPTY_PROCESS_SNAPSHOT: ProcessSnapshot = {
  timestamp: 0,
  appWorkingSetKb: 0,
  appPrivateWorkingSetKb: 0,
  appPrivateBytesKb: 0,
  webviewWorkingSetKb: 0,
  webviewPrivateWorkingSetKb: 0,
  webviewPrivateBytesKb: 0,
  rustWorkingSetKb: 0,
  rustPrivateWorkingSetKb: 0,
  rustPrivateBytesKb: 0,
  webviewProcessCount: 0,
  rendererProcessCount: 0,
  gpuProcessCount: 0,
  utilityProcessCount: 0,
  cpuPercent: 0,
  cpuNormalizedPercent: 0,
  cpuCoreEquivalent: 0,
  systemCpuPercent: 0,
  processBreakdown: [],
}

class PerfCollector {
  private timeoutId: number | null = null
  private highPrecisionTimeoutId: number | null = null
  private collectionRun = 0
  private panelRenderDurationMs = 0
  private getCurrentMode: () => ViewMode = () => 'edit'
  private getDocCharCount: () => number = () => 0

  setSources(sources: { getCurrentMode: () => ViewMode; getDocCharCount: () => number }) {
    this.getCurrentMode = sources.getCurrentMode
    this.getDocCharCount = sources.getDocCharCount
    runtimeResourceTracker.install(sources.getCurrentMode)
  }

  setDocumentContextSources(sources: {
    getActiveDocumentCount: () => number
    getActiveDocumentCharCount: () => number
    getTotalOpenDocumentCharCount: () => number
    getActiveDocumentLineCount: () => number
    getPreviewInstanceCount: () => number
    getEditorInstanceCount: () => number
    getAiPanelOpen: () => boolean
    getIsFullscreen: () => boolean
  }) {
    runtimeResourceTracker.setDocumentContextSources(sources)
  }

  recordPanelRenderDuration(durationMs: number) {
    this.panelRenderDurationMs = durationMs
  }

  private async getSystemPerf(): Promise<ProcessSnapshot> {
    try {
      const raw = await invoke<ProcessSnapshot>('get_perf_snapshot')
      const logicalCpuCount = navigator.hardwareConcurrency || 1
      return {
        ...raw,
        cpuNormalizedPercent: raw.cpuPercent / logicalCpuCount,
        cpuCoreEquivalent: raw.cpuPercent / 100,
      }
    } catch (error) {
      console.warn('[PerfCollector] process query failed:', error)
      return { ...EMPTY_PROCESS_SNAPSHOT, timestamp: Date.now() }
    }
  }

  async collect(): Promise<PerfData> {
    const collectStartedAt = performance.now()
    const processStartedAt = performance.now()
    const process = await this.getSystemPerf()
    const processQueryDurationMs = performance.now() - processStartedAt
    const jsStartedAt = performance.now()
    const runtime = runtimeResourceTracker.snapshot(
      this.getCurrentMode(),
      this.getDocCharCount(),
      document.visibilityState !== 'hidden',
    )
    const jsMetricDurationMs = performance.now() - jsStartedAt
    return {
      ...process,
      ...runtime,
      totalCollectDurationMs: performance.now() - collectStartedAt,
      processQueryDurationMs,
      jsMetricDurationMs,
      storeUpdateDurationMs: 0,
      panelRenderDurationMs: this.panelRenderDurationMs,
    }
  }

  start(
    intervalMs = 5000,
    onData: (data: PerfData) => void,
    onHighPrecisionExpired?: () => void,
  ) {
    this.stop()
    const run = this.collectionRun
    const collectNext = async () => {
      const data = await this.collect()
      if (run !== this.collectionRun) return
      const storeStartedAt = performance.now()
      onData(data)
      data.storeUpdateDurationMs = performance.now() - storeStartedAt
      data.totalCollectDurationMs += data.storeUpdateDurationMs
      this.timeoutId = window.setTimeout(collectNext, intervalMs)
    }
    this.timeoutId = window.setTimeout(collectNext, intervalMs)
    if (intervalMs < 5000) {
      this.highPrecisionTimeoutId = window.setTimeout(() => {
        onHighPrecisionExpired?.()
      }, 60_000)
    }
  }

  stop() {
    this.collectionRun += 1
    if (this.timeoutId !== null) window.clearTimeout(this.timeoutId)
    if (this.highPrecisionTimeoutId !== null) window.clearTimeout(this.highPrecisionTimeoutId)
    this.timeoutId = null
    this.highPrecisionTimeoutId = null
  }

  dispose() {
    this.stop()
  }
}

export const perfCollector = new PerfCollector()
