import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorStore } from '@/stores/editorStore'
import { loadRagStatsAggregate } from '@/services/database/persistence'
import { getNativeRagIndexState, initializeNativeRagIndex } from './nativeIndex'
import { decideRagWarmup } from './warmupPolicy'

const RECENT_RAG_USE_MS = 7 * 24 * 60 * 60 * 1000

function wasRagRecentlyUsed(): boolean {
  try {
    const value = Number(localStorage.getItem('guanmo-rag-last-used-at'))
    return Number.isFinite(value) && Date.now() - value <= RECENT_RAG_USE_MS
  } catch {
    return false
  }
}

function availableMemoryMb(): number | undefined {
  const memory = performance as Performance & { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number } }
  if (!memory.memory) return undefined
  return Math.max(0, (memory.memory.jsHeapSizeLimit - memory.memory.usedJSHeapSize) / 1024 / 1024)
}

export async function warmNativeRagIndexWhileIdle(signal?: AbortSignal): Promise<'skipped' | 'ready' | 'cancelled'> {
  const stats = await loadRagStatsAggregate()
  const decision = decideRagWarmup({
    policy: useSettingsStore.getState().editor.modePerformancePolicy,
    documentCount: stats.documents,
    availableMemoryMb: availableMemoryMb(),
    recentlyUsed: wasRagRecentlyUsed(),
    userActive: signal?.aborted ?? false,
    memoryPressure: false,
  })
  if (decision !== 'idle-warmup') return decision === 'cancel' ? 'cancelled' : 'skipped'
  const state = await getNativeRagIndexState()
  if (state.status === 'ready') return 'ready'

  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const userEvents = ['pointerdown', 'keydown'] as const
  userEvents.forEach((event) => window.addEventListener(event, cancel, { once: true, capture: true }))
  let activeTabId = useEditorStore.getState().activeTabId
  const unsubscribe = useEditorStore.subscribe((state) => {
    if (state.activeTabId !== activeTabId) {
      activeTabId = state.activeTabId
      cancel()
    }
  })
  const memoryTimer = window.setInterval(() => {
    const available = availableMemoryMb()
    if (available !== undefined && available < 256) cancel()
  }, 500)
  try {
    await initializeNativeRagIndex(controller.signal)
    return 'ready'
  } catch (error) {
    if (controller.signal.aborted) return 'cancelled'
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
    userEvents.forEach((event) => window.removeEventListener(event, cancel, { capture: true }))
    unsubscribe()
    window.clearInterval(memoryTimer)
  }
}
