import type { ViewMode } from '@/stores/editorStore'

export const PERF_SCHEMA_VERSION = 2

export type WebViewProcessType =
  | 'browser'
  | 'renderer'
  | 'gpu-process'
  | 'utility'
  | 'network-service'
  | 'crashpad'
  | 'unknown'

export interface ProcessMetric {
  pid: number
  processType: WebViewProcessType | 'rust-main'
  workingSetKb: number
  privateWorkingSetKb: number
  privateBytesKb: number
  commitSizeKb: number
  cpuPercent: number
  threadCount: number
  handleCount: number
}

export interface ProcessSnapshot {
  timestamp: number
  appWorkingSetKb: number
  appPrivateWorkingSetKb: number
  appPrivateBytesKb: number
  webviewWorkingSetKb: number
  webviewPrivateWorkingSetKb: number
  webviewPrivateBytesKb: number
  rustWorkingSetKb: number
  rustPrivateWorkingSetKb: number
  rustPrivateBytesKb: number
  webviewProcessCount: number
  rendererProcessCount: number
  gpuProcessCount: number
  utilityProcessCount: number
  /** 原始累计值：所有进程 cpu_usage() 之和，多核时可超过 100%（如 8 核满载 ≈ 800%） */
  cpuPercent: number
  /** 归一化 CPU：cpuPercent ÷ logicalCpuCount，0-100%，与 Windows 任务管理器口径一致 */
  cpuNormalizedPercent: number
  /** 等效核心数：cpuPercent ÷ 100，表示占用几个核心的满载算力 */
  cpuCoreEquivalent: number
  /** 系统整体 CPU 占用（0-100%），整机归一化 */
  systemCpuPercent: number
  processBreakdown: ProcessMetric[]
}

export interface MonacoModelMetric {
  uri: string
  charCount: number
  lineCount: number
  disposed: boolean
  attachedEditorCount: number
}

export interface RuntimeMetric {
  fps: number
  jsHeapUsedMb: number
  jsHeapTotalMb: number
  domNodeCount: number
  detachedDomNodes: number
  activeTimeoutCount: number
  activeIntervalCount: number
  activeRafCount: number
  eventListenerCount: number
  eventListenerWindowCount: number
  eventListenerDocumentCount: number
  eventListenerDomCount: number
  eventListenerUnknownCount: number
  mutationObserverCount: number
  resizeObserverCount: number
  intersectionObserverCount: number
  activeObjectUrlCount: number
  longTaskCount: number
  longTaskTotalDurationMs: number
  longTaskMaxDurationMs: number
  lastLongTaskAt: number | null
  lastLongTaskMode: ViewMode | null
  lastLongTaskUserAction: string | null
  monacoModelCount: number
  monacoModelTotalChars: number
  monacoEditorInstanceCount: number
  monacoDiffEditorInstanceCount: number
  monacoDecorationCount: number
  monacoMarkerCount: number
  monacoModels: MonacoModelMetric[]
  currentMode: ViewMode
  docCharCount: number
  // Document load context (anonymous IDs only)
  activeDocumentCount: number
  activeDocumentCharCount: number
  totalOpenDocumentCharCount: number
  activeDocumentLineCount: number
  previewInstanceCount: number
  editorInstanceCount: number
  aiPanelOpen: boolean
  isFullscreen: boolean
}

export interface CollectorOverhead {
  totalCollectDurationMs: number
  processQueryDurationMs: number
  jsMetricDurationMs: number
  storeUpdateDurationMs: number
  panelRenderDurationMs: number
}

export interface PerfData extends ProcessSnapshot, RuntimeMetric, CollectorOverhead {}

export interface LegacyPerfData {
  appMemoryKb?: number
  rustMemoryKb?: number
  webviewMemoryKb?: number
  webviewCount?: number
  jsHeapUsed?: number
  jsHeapTotal?: number
}

export function migratePerfData<T extends Record<string, unknown>>(raw: T): T & Partial<PerfData> {
  const legacy = raw as T & LegacyPerfData
  const cpuPercent = Number(raw.cpuPercent ?? 0)
  const logicalCpuCount = Number((raw as Record<string, unknown>).logicalCpuCount ?? 4)
  return {
    ...raw,
    appWorkingSetKb: Number(raw.appWorkingSetKb ?? legacy.appMemoryKb ?? 0),
    rustWorkingSetKb: Number(raw.rustWorkingSetKb ?? legacy.rustMemoryKb ?? 0),
    webviewWorkingSetKb: Number(raw.webviewWorkingSetKb ?? legacy.webviewMemoryKb ?? 0),
    webviewProcessCount: Number(raw.webviewProcessCount ?? legacy.webviewCount ?? 0),
    jsHeapUsedMb: Number(raw.jsHeapUsedMb ?? legacy.jsHeapUsed ?? 0),
    jsHeapTotalMb: Number(raw.jsHeapTotalMb ?? legacy.jsHeapTotal ?? 0),
    cpuPercent,
    cpuNormalizedPercent: Number(raw.cpuNormalizedPercent ?? cpuPercent / logicalCpuCount),
    cpuCoreEquivalent: Number(raw.cpuCoreEquivalent ?? cpuPercent / 100),
    systemCpuPercent: Number(raw.systemCpuPercent ?? 0),
  }
}

export function migratePerfReport(raw: Record<string, unknown>) {
  const history = Array.isArray(raw.history)
    ? raw.history.map((item) => migratePerfData(item as Record<string, unknown>))
    : []
  const baseline = raw.baseline && typeof raw.baseline === 'object'
    ? migratePerfData(raw.baseline as Record<string, unknown>)
    : null
  const current = raw.current && typeof raw.current === 'object'
    ? migratePerfData(raw.current as Record<string, unknown>)
    : history[history.length - 1] ?? null
  return { ...raw, schemaVersion: Number(raw.schemaVersion ?? 1), current, baseline, history }
}

/** 旧字段仅用于兼容旧导出消费者，新代码统一读取明确语义的新字段。 */
export function withLegacyPerfFields(data: PerfData) {
  return {
    ...data,
    appMemoryKb: data.appWorkingSetKb,
    rustMemoryKb: data.rustWorkingSetKb,
    webviewMemoryKb: data.webviewWorkingSetKb,
    webviewCount: data.webviewProcessCount,
    jsHeapUsed: data.jsHeapUsedMb,
    jsHeapTotal: data.jsHeapTotalMb,
  }
}
