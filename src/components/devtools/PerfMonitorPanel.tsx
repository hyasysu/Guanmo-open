import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { usePerfMonitor } from '@/hooks/usePerfMonitor'
import { saveFileDialog, writeFile } from '@/hooks/useTauri'
import { eventMarker, type PerfEvent } from '@/services/eventMarker'
import { perfCollector } from '@/services/perfCollector'
import { PERF_SCHEMA_VERSION, withLegacyPerfFields, type PerfData } from '@/services/perfTypes'
import { getPerfHistory, usePerfStore, type PerfBaseline, type SampleIntervalMs } from '@/stores/perfStore'
import { toast } from '@/services/toast'

type PanelSection = 'overview' | 'processes' | 'resources' | 'context' | 'events'

const EMPTY: PerfData = {
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
  fps: 0,
  jsHeapUsedMb: 0,
  jsHeapTotalMb: 0,
  domNodeCount: 0,
  detachedDomNodes: 0,
  activeTimeoutCount: 0,
  activeIntervalCount: 0,
  activeRafCount: 0,
  eventListenerCount: 0,
  eventListenerWindowCount: 0,
  eventListenerDocumentCount: 0,
  eventListenerDomCount: 0,
  eventListenerUnknownCount: 0,
  mutationObserverCount: 0,
  resizeObserverCount: 0,
  intersectionObserverCount: 0,
  activeObjectUrlCount: 0,
  longTaskCount: 0,
  longTaskTotalDurationMs: 0,
  longTaskMaxDurationMs: 0,
  lastLongTaskAt: null,
  lastLongTaskMode: null,
  lastLongTaskUserAction: null,
  monacoModelCount: 0,
  monacoModelTotalChars: 0,
  monacoEditorInstanceCount: 0,
  monacoDiffEditorInstanceCount: 0,
  monacoDecorationCount: 0,
  monacoMarkerCount: 0,
  monacoModels: [],
  currentMode: 'edit',
  docCharCount: 0,
  activeDocumentCount: 0,
  activeDocumentCharCount: 0,
  totalOpenDocumentCharCount: 0,
  activeDocumentLineCount: 0,
  previewInstanceCount: 0,
  editorInstanceCount: 0,
  aiPanelOpen: false,
  isFullscreen: false,
  totalCollectDurationMs: 0,
  processQueryDurationMs: 0,
  jsMetricDurationMs: 0,
  storeUpdateDurationMs: 0,
  panelRenderDurationMs: 0,
}
const EVENT_LABELS: Record<PerfEvent['type'], string> = {
  'app-start': '应用启动',
  'app-ready': '应用就绪',
  'open-file-start': '开始打开文件',
  'open-file-complete': '文件打开完成',
  'close-file': '关闭文件',
  'switch-document': '切换文档',
  'document-size-change': '文档大小变化',
  'switch-tab': '切换标签',
  'switch-mode-start': '开始切换模式',
  'switch-mode-complete': '模式切换完成',
  'mode-settled': '模式稳定',
  'preview-render-start': '开始渲染预览',
  'preview-render-complete': '预览渲染完成',
  'editor-create': '创建编辑器',
  'editor-dispose': '释放编辑器',
  'model-create': '创建模型',
  'model-dispose': '释放模型',
  'diff-create': '创建 Diff',
  'diff-dispose': '释放 Diff',
  'ai-panel-open': '打开 AI 面板',
  'ai-panel-close': '关闭 AI 面板',
  'enter-fullscreen': '进入全屏',
  'exit-fullscreen': '退出全屏',
  'baseline-set': '设置基线',
  'memory-snapshot': '内存快照',
}

function formatKb(kb: number) {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(2)} GB` : `${(kb / 1024).toFixed(1)} MB`
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

function delta(current: number, baseline: number) {
  const value = current - baseline
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function safeData(data: PerfData) {
  return {
    ...withLegacyPerfFields(data),
    lastLongTaskUserAction: data.lastLongTaskUserAction && /^(click|keydown|pointerdown):[a-z0-9-]+$/.test(data.lastLongTaskUserAction)
      ? data.lastLongTaskUserAction
      : data.lastLongTaskUserAction ? '[redacted-action]' : null,
    monacoModels: data.monacoModels.map((model) => ({ ...model, uri: '[redacted-uri]' })),
  }
}

function extractWebViewVersion() {
  return navigator.userAgent.match(/Edg(?:A|iOS)?\/([\d.]+)/)?.[1] ?? 'unknown'
}

async function exportReport() {
  const state = usePerfStore.getState()
  const current = state.current
  const logicalCpuCount = navigator.hardwareConcurrency || 1
  const report = {
    schemaVersion: PERF_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    environment: {
      platform: navigator.platform,
      language: navigator.language,
    },
    buildMode: document.querySelector('meta[name="guanmo-build-mode"]')?.getAttribute('content') ?? 'unknown',
    appVersion: await getVersion().catch(() => 'unknown'),
    webview2Version: extractWebViewVersion(),
    osVersion: navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] ?? navigator.platform,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    logicalCpuCount,
    cpuNormalization: {
      logicalCpuCount,
      formula: 'cpuNormalizedPercent = cpuRawPercent ÷ logicalCpuCount',
      description: '归一化 CPU 百分比，与 Windows 任务管理器口径一致',
    },
    monitorSettings: state.settings,
    experimentalMetrics: ['eventListenerCount', 'detachedDomNodes'],
    baseline: state.baseline
      ? {
          kind: state.baseline.kind,
          setAt: state.baseline.setAt,
          snapshot: safeData(state.baseline.snapshot),
        }
      : null,
    processBreakdown: current?.processBreakdown ?? [],
    cpuMetrics: current ? {
      cpuRawPercent: current.cpuPercent,
      cpuNormalizedPercent: current.cpuNormalizedPercent,
      cpuCoreEquivalent: current.cpuCoreEquivalent,
      systemCpuPercent: current.systemCpuPercent,
    } : null,
    collectorOverhead: current ? {
      totalCollectDurationMs: current.totalCollectDurationMs,
      processQueryDurationMs: current.processQueryDurationMs,
      jsMetricDurationMs: current.jsMetricDurationMs,
      storeUpdateDurationMs: current.storeUpdateDurationMs,
      panelRenderDurationMs: current.panelRenderDurationMs,
    } : null,
    events: eventMarker.exportEvents(),
    history: getPerfHistory().map(safeData),
  }

  const path = await saveFileDialog(`perf-report-${Date.now()}.json`, [{ name: 'JSON', extensions: ['json'] }])
  if (!path) return false
  await writeFile(path, JSON.stringify(report, null, 2))
  return true
}

function MetricCard({
  label,
  value,
  numeric,
  baseline,
  peak,
  format = (item) => item.toFixed(1),
}: {
  label: string
  value: string
  numeric?: number
  baseline?: number
  peak?: number
  format?: (value: number) => string
}) {
  return (
    <div className="rounded border border-gray-700 bg-gray-800/60 p-2">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="text-sm text-white">{value}</div>
      {numeric !== undefined && baseline !== undefined && (
        <div className="mt-1 grid grid-cols-2 gap-x-2 text-[9px] text-gray-400">
          <span>基线 {format(baseline)}</span><span>变化 {delta(numeric, baseline)}</span>
          <span>峰值 {format(peak ?? numeric)}</span><span>残留 {delta(numeric, baseline)}</span>
        </div>
      )}
    </div>
  )
}

function Overhead({ data }: { data: PerfData }) {
  const level = data.totalCollectDurationMs > 50 ? 'text-red-400' : data.totalCollectDurationMs > 16 ? 'text-yellow-400' : 'text-green-400'
  return (
    <div className={`mt-2 rounded border border-gray-700 p-2 ${level}`}>
      监测开销 {data.totalCollectDurationMs.toFixed(1)}ms
      <span className="ml-2 text-[9px] text-gray-400">
        进程 {data.processQueryDurationMs.toFixed(1)} / JS {data.jsMetricDurationMs.toFixed(1)} /
        Store {data.storeUpdateDurationMs.toFixed(1)} / 面板 {data.panelRenderDurationMs.toFixed(1)}ms
      </span>
    </div>
  )
}

function Overview({ data, baseline, peaks }: { data: PerfData; baseline: PerfBaseline | null; peaks: Partial<Record<keyof PerfData, number>> }) {
  const base = baseline?.snapshot
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      <MetricCard label="应用私有内存" value={formatKb(data.appPrivateWorkingSetKb)} numeric={data.appPrivateWorkingSetKb} baseline={base?.appPrivateWorkingSetKb} peak={peaks.appPrivateWorkingSetKb} format={formatKb} />
      <MetricCard label="WebView 私有内存" value={formatKb(data.webviewPrivateWorkingSetKb)} numeric={data.webviewPrivateWorkingSetKb} baseline={base?.webviewPrivateWorkingSetKb} peak={peaks.webviewPrivateWorkingSetKb} format={formatKb} />
      <MetricCard label="Rust 私有内存" value={formatKb(data.rustPrivateWorkingSetKb)} numeric={data.rustPrivateWorkingSetKb} baseline={base?.rustPrivateWorkingSetKb} peak={peaks.rustPrivateWorkingSetKb} format={formatKb} />
      <div className="col-span-1 rounded border border-gray-700 bg-gray-800/60 p-2">
        <div className="text-[10px] text-gray-400">CPU 占用</div>
        <div className="mt-1 flex items-baseline gap-3">
          <div>
            <div className="text-[9px] text-gray-500">观墨</div>
            <div className="text-sm text-white">{data.cpuNormalizedPercent.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500">系统</div>
            <div className="text-sm text-gray-400">{data.systemCpuPercent.toFixed(1)}%</div>
          </div>
        </div>
        {base?.cpuNormalizedPercent !== undefined && (
          <div className="mt-1 grid grid-cols-2 gap-x-2 text-[9px] text-gray-400">
            <span>基线 {base.cpuNormalizedPercent.toFixed(1)}%</span><span>变化 {delta(data.cpuNormalizedPercent, base.cpuNormalizedPercent)}</span>
            <span>峰值 {peaks.cpuNormalizedPercent?.toFixed(1) ?? data.cpuNormalizedPercent.toFixed(1)}%</span><span></span>
          </div>
        )}
      </div>
      <MetricCard label="FPS" value={String(data.fps)} />
      <MetricCard label="Long Task" value={`${data.longTaskCount} / max ${data.longTaskMaxDurationMs.toFixed(1)}ms`} />
      <div className="col-span-3"><Overhead data={data} /></div>
    </div>
  )
}

function Processes({ data }: { data: PerfData }) {
  const rows = data.processBreakdown.filter((process) => process.processType !== 'rust-main')
  return (
    <div className="max-h-80 overflow-auto p-3">
      <div className="mb-2 text-gray-400">WebView2 进程 {data.webviewProcessCount}：renderer {data.rendererProcessCount} / GPU {data.gpuProcessCount} / utility {data.utilityProcessCount}</div>
      <table className="w-full text-left text-[10px]">
        <thead className="sticky top-0 bg-gray-900 text-gray-400"><tr><th>PID</th><th>类型</th><th>WS</th><th>私有 WS</th><th>Private</th><th>Commit</th><th>CPU</th><th>线程</th><th>Handle</th></tr></thead>
        <tbody>{rows.map((process) => <tr key={process.pid} className="border-t border-gray-800">
          <td>{process.pid}</td><td>{process.processType}</td><td>{formatKb(process.workingSetKb)}</td><td>{formatKb(process.privateWorkingSetKb)}</td><td>{formatKb(process.privateBytesKb)}</td><td>{formatKb(process.commitSizeKb)}</td><td>{process.cpuPercent.toFixed(1)}%</td><td>{process.threadCount}</td><td>{process.handleCount}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <div className="py-8 text-center text-gray-500">暂无 WebView2 子进程数据</div>}
    </div>
  )
}

function Resources({ data }: { data: PerfData }) {
  const entries: Array<[string, string | number]> = [
    ['JS Heap', `${data.jsHeapUsedMb.toFixed(1)} / ${data.jsHeapTotalMb.toFixed(1)} MB`],
    ['DOM', data.domNodeCount], ['Detached DOM（实验性）', data.detachedDomNodes],
    ['Monaco Model', data.monacoModelCount], ['Monaco 字符', data.monacoModelTotalChars],
    ['Monaco Editor', data.monacoEditorInstanceCount], ['Monaco Diff', data.monacoDiffEditorInstanceCount],
    ['Decoration', data.monacoDecorationCount], ['Marker', data.monacoMarkerCount],
    ['Timeout', data.activeTimeoutCount], ['Interval', data.activeIntervalCount], ['RAF', data.activeRafCount],
    ['监听器（实验性·总）', data.eventListenerCount],
    ['监听器（实验性·window）', data.eventListenerWindowCount],
    ['监听器（实验性·document）', data.eventListenerDocumentCount],
    ['监听器（实验性·DOM）', data.eventListenerDomCount],
    ['监听器（实验性·unknown）', data.eventListenerUnknownCount],
    ['MutationObserver', data.mutationObserverCount],
    ['ResizeObserver', data.resizeObserverCount], ['IntersectionObserver', data.intersectionObserverCount],
    ['Object URL', data.activeObjectUrlCount],
  ]
  return <div className="grid grid-cols-4 gap-2 p-3">{entries.map(([label, value]) => <MetricCard key={label} label={label} value={String(value)} />)}</div>
}

function DocumentContext({ data }: { data: PerfData }) {
  const entries: Array<[string, string | number]> = [
    ['活动文档数', data.activeDocumentCount],
    ['活动文档字符', data.activeDocumentCharCount.toLocaleString()],
    ['活动文档行数', data.activeDocumentLineCount.toLocaleString()],
    ['打开文档总字符', data.totalOpenDocumentCharCount.toLocaleString()],
    ['预览实例', data.previewInstanceCount],
    ['编辑器实例', data.editorInstanceCount],
    ['模式', data.currentMode],
    ['AI 面板', data.aiPanelOpen ? '打开' : '关闭'],
    ['全屏', data.isFullscreen ? '是' : '否'],
  ]
  return <div className="grid grid-cols-3 gap-2 p-3">{entries.map(([label, value]) => <MetricCard key={label} label={label} value={String(value)} />)}</div>
}

function Timeline({ events }: { events: PerfEvent[] }) {
  return <div className="max-h-80 overflow-auto p-3">
    {events.slice().reverse().map((event) => {
      const memoryDelta = event.before && event.after
        ? event.after.appPrivateWorkingSetKb - event.before.appPrivateWorkingSetKb
        : null
      return <div key={event.id} className="grid grid-cols-[64px_150px_1fr] gap-2 border-b border-gray-800 py-1">
        <span className="text-gray-500">{formatTime(event.timestamp)}</span>
        <span>{EVENT_LABELS[event.type] ?? event.type}</span>
        <span className="text-gray-400">{event.durationMs !== undefined ? `${event.durationMs.toFixed(1)}ms` : ''}{memoryDelta !== null ? ` · 内存 ${memoryDelta >= 0 ? '+' : ''}${formatKb(memoryDelta)}` : ''}</span>
      </div>
    })}
    {!events.length && <div className="py-8 text-center text-gray-500">暂无事件</div>}
  </div>
}

export function PerfMonitorPanel() {
  const renderStartedAt = performance.now()
  usePerfMonitor()
  const current = usePerfStore((state) => state.current)
  const events = usePerfStore((state) => state.events)
  const baseline = usePerfStore((state) => state.baseline)
  const peaks = usePerfStore((state) => state.testPeaks)
  const settings = usePerfStore((state) => state.settings)
  const isCollapsed = usePerfStore((state) => state.isCollapsed)
  const isPaused = usePerfStore((state) => state.isPaused)
  const [section, setSection] = useState<PanelSection>('overview')
  const data = current ?? EMPTY
  const tabs = useMemo<Array<[PanelSection, string]>>(() => [['overview', '概览'], ['processes', 'WebView2 进程'], ['resources', '前端资源'], ['context', '文档负载'], ['events', '事件时间线']], [])

  useLayoutEffect(() => {
    perfCollector.recordPanelRenderDuration(performance.now() - renderStartedAt)
  })

  const setBaseline = useCallback((kind: PerfBaseline['kind']) => {
    const snapshot = usePerfStore.getState().current
    if (snapshot) {
      usePerfStore.getState().setBaseline(kind)
      eventMarker.mark('baseline-set', { kind })
    }
  }, [])
  const handleExport = useCallback(async () => {
    try {
      if (await exportReport()) toast.success('性能报告已导出')
    } catch (error) {
      toast.error(error instanceof Error ? `导出失败：${error.message}` : '导出失败')
    }
  }, [])

  if (!import.meta.env.DEV) return null
  if (isCollapsed) return <button className="fixed bottom-4 right-4 z-[9999] rounded border border-gray-700 bg-gray-900/95 px-3 py-2 font-mono text-xs text-white" onClick={usePerfStore.getState().toggleCollapsed}>性能 {formatKb(data.appPrivateWorkingSetKb)} · {data.cpuNormalizedPercent.toFixed(1)}%</button>

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-[760px] rounded-lg border border-gray-700 bg-gray-900/95 font-mono text-xs text-gray-200 shadow-2xl" style={{ userSelect: 'none' }}>
      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
        <strong className="mr-auto text-white">性能实时监测</strong>
        <select aria-label="采样频率" className="rounded bg-gray-800 px-1 py-0.5" value={settings.sampleIntervalMs} onChange={(event) => usePerfStore.getState().setSampleInterval(Number(event.target.value) as SampleIntervalMs)}>
          <option value={5000}>5s</option><option value={1000}>1s（60秒）</option><option value={500}>500ms（60秒）</option><option value={250}>250ms（60秒）</option>
        </select>
        <button className="rounded bg-gray-700 px-2 py-1" onClick={usePerfStore.getState().togglePaused}>{isPaused ? '继续' : '暂停'}</button>
        <button className="rounded bg-gray-700 px-2 py-1" onClick={usePerfStore.getState().toggleCollapsed}>收起</button>
      </div>
      <div className="flex border-b border-gray-700">{tabs.map(([key, label]) => <button key={key} className={`px-3 py-2 ${section === key ? 'border-b-2 border-blue-400 text-white' : 'text-gray-400'}`} onClick={() => setSection(key)}>{label}</button>)}</div>
      {section === 'overview' && <Overview data={data} baseline={baseline} peaks={peaks} />}
      {section === 'processes' && <Processes data={data} />}
      {section === 'resources' && <Resources data={data} />}
      {section === 'context' && <DocumentContext data={data} />}
      {section === 'events' && <Timeline events={events} />}
      <div className="flex gap-1 border-t border-gray-700 p-2">
        <button className="rounded bg-gray-700 px-2 py-1" onClick={() => setBaseline('idle')}>设置空闲基线</button>
        <button className="rounded bg-gray-700 px-2 py-1" onClick={() => setBaseline('document')}>设置当前文档基线</button>
        <button className="rounded bg-gray-700 px-2 py-1" onClick={usePerfStore.getState().clearBaseline}>清除基线</button>
        <button className="rounded bg-gray-700 px-2 py-1" onClick={usePerfStore.getState().startTest}>开始操作测试</button>
        <button className="rounded bg-gray-700 px-2 py-1" onClick={() => { eventMarker.mark('memory-snapshot'); void handleExport() }}>导出 JSON</button>
        <button className="ml-auto rounded bg-gray-700 px-2 py-1" onClick={() => { eventMarker.clearEvents(); usePerfStore.getState().clearHistory() }}>清空记录</button>
      </div>
    </div>
  )
}
