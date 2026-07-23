import type { PerfData } from '@/services/perfTypes'

export type PerfEventType =
  | 'app-start'
  | 'app-ready'
  | 'open-file-start'
  | 'open-file-complete'
  | 'close-file'
  | 'switch-document'
  | 'document-size-change'
  | 'switch-tab'
  | 'switch-mode-start'
  | 'switch-mode-complete'
  | 'mode-settled'
  | 'preview-render-start'
  | 'preview-render-complete'
  | 'editor-create'
  | 'editor-dispose'
  | 'model-create'
  | 'model-dispose'
  | 'diff-create'
  | 'diff-dispose'
  | 'ai-panel-open'
  | 'ai-panel-close'
  | 'enter-fullscreen'
  | 'exit-fullscreen'
  | 'baseline-set'
  | 'memory-snapshot'
  | 'policy-change'
  | 'prewarm-schedule'
  | 'prewarm-create'
  | 'prewarm-cancel'
  | 'resource-release'

export interface EventMetricSnapshot {
  appPrivateWorkingSetKb: number
  webviewPrivateWorkingSetKb: number
  rustPrivateWorkingSetKb: number
  jsHeapUsedMb: number
  domNodeCount: number
  detachedDomNodes: number
  eventListenerCount: number
}

export interface PerfEvent {
  id: string
  type: PerfEventType
  timestamp: number
  durationMs?: number
  before?: EventMetricSnapshot
  after?: EventMetricSnapshot
  metadata?: Record<string, string | number | boolean | null>
}

function pickSnapshot(data: PerfData | null): EventMetricSnapshot | undefined {
  if (!data) return undefined
  return {
    appPrivateWorkingSetKb: data.appPrivateWorkingSetKb,
    webviewPrivateWorkingSetKb: data.webviewPrivateWorkingSetKb,
    rustPrivateWorkingSetKb: data.rustPrivateWorkingSetKb,
    jsHeapUsedMb: data.jsHeapUsedMb,
    domNodeCount: data.domNodeCount,
    detachedDomNodes: data.detachedDomNodes,
    eventListenerCount: data.eventListenerCount,
  }
}

function sanitizeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (/path|content|key|token|secret|user|conversation/i.test(key)) continue
    if (typeof value === 'string') safe[key] = value.slice(0, 120)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) safe[key] = value
  }
  return safe
}

function snapshotsAreSame(a: EventMetricSnapshot, b: EventMetricSnapshot): boolean {
  return (
    a.appPrivateWorkingSetKb === b.appPrivateWorkingSetKb &&
    a.webviewPrivateWorkingSetKb === b.webviewPrivateWorkingSetKb &&
    a.rustPrivateWorkingSetKb === b.rustPrivateWorkingSetKb &&
    a.jsHeapUsedMb === b.jsHeapUsedMb &&
    a.domNodeCount === b.domNodeCount &&
    a.detachedDomNodes === b.detachedDomNodes &&
    a.eventListenerCount === b.eventListenerCount
  )
}

class EventMarker {
  private events: PerfEvent[] = []
  private listeners = new Set<(event: PerfEvent) => void>()
  private getSnapshot: () => PerfData | null = () => null
  private getFreshSnapshot: (() => Promise<PerfData>) | null = null
  private pendingStarts = new Map<string, { startedAt: number; before?: EventMetricSnapshot }>()

  setSnapshotSource(source: () => PerfData | null) {
    this.getSnapshot = source
  }

  setFreshSnapshotSource(source: () => Promise<PerfData>) {
    this.getFreshSnapshot = source
  }

  start(type: PerfEventType, metadata?: Record<string, unknown>) {
    if (!import.meta.env.DEV) return
    const before = pickSnapshot(this.getSnapshot())
    const group = type.replace(/-(start|complete)$/, '')
    this.pendingStarts.set(group, { startedAt: performance.now(), before })
    this.emit({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: Date.now(),
      before,
      metadata: sanitizeMetadata(metadata),
    })
  }

  mark(type: PerfEventType, metadata?: Record<string, unknown>, before?: EventMetricSnapshot) {
    if (!import.meta.env.DEV) return
    if (type.endsWith('-start')) {
      this.start(type, metadata)
      return
    }
    const snapshot = pickSnapshot(this.getSnapshot())
    const group = type.replace(/-(start|complete)$/, '')
    const pending = type.endsWith('-complete') ? this.pendingStarts.get(group) : undefined
    if (pending) this.pendingStarts.delete(group)

    if (pending && this.getFreshSnapshot) {
      const timestamp = Date.now()
      const durationMs = performance.now() - pending.startedAt
      void this.getFreshSnapshot().then((fresh) => {
        this.emit({
          id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          timestamp,
          durationMs,
          before: pending.before,
          after: pickSnapshot(fresh),
          metadata: sanitizeMetadata(metadata),
        })
      })
      return
    }

    this.emit({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: Date.now(),
      durationMs: pending ? performance.now() - pending.startedAt : undefined,
      before: pending?.before ?? before ?? snapshot,
      after: pending?.before && snapshot && !snapshotsAreSame(pending.before, snapshot)
        ? snapshot
        : undefined,
      metadata: sanitizeMetadata(metadata),
    })
  }

  begin(type: PerfEventType, metadata?: Record<string, unknown>) {
    this.start(type, metadata)
    return (completeType: PerfEventType = type, completeMetadata?: Record<string, unknown>) => {
      this.mark(completeType, { ...metadata, ...completeMetadata })
    }
  }

  markPoint(type: PerfEventType, snapshot: PerfData, metadata?: Record<string, unknown>) {
    if (!import.meta.env.DEV) return
    this.emit({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: Date.now(),
      after: pickSnapshot(snapshot),
      metadata: sanitizeMetadata(metadata),
    })
  }

  private emit(event: PerfEvent) {
    this.events.push(event)
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500)
    for (const listener of this.listeners) listener(event)
  }

  getEvents() {
    return this.events.slice()
  }

  clearEvents() {
    this.events.length = 0
    this.pendingStarts.clear()
  }

  addListener(listener: (event: PerfEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  exportEvents() {
    return this.getEvents()
  }
}

export const eventMarker = new EventMarker()
