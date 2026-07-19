import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import { AppLayout } from './components/layout/AppLayout'
import { ToastContainer } from './components/common/ToastContainer'
import {
  getDatabaseRuntimeState,
  initDatabase,
} from './services/database/db'
import { hydrateSettingsSecrets } from './services/settingsSecrets'
import { initAiClient, initEmbeddingClient, isLocalApi, validateAiStatus } from './services/ai/aiClient'
import { syncDocumentTheme, useSettingsStore } from './stores/settingsStore'
import { useAppStore } from './stores/appStore'
import { useExternalFileOpen } from './hooks/useExternalFileOpen'
import { Cursor } from 'animal-island-ui'
import { invoke } from '@tauri-apps/api/core'
import {
  getRestorablePersistedTabs,
  restorePersistedTabs,
} from './services/sessionRestore'
import { useEditorStore } from './stores/editorStore'
import { isTauri } from './hooks/useTauri'
import { GlobalTooltip } from './components/common/Tooltip'
import { migrateLegacyFileAccess } from './services/persistedFileAccess'
import { UpdateManager } from './components/update/UpdateManager'
import { toast } from './services/toast'
import { detectLegacyData, type LegacyDetectionResult } from './services/database/legacyDetector'
import { LegacyDataNoticeModal } from './components/legacy/LegacyDataNoticeModal'
import { scheduleIdleTask } from './services/idleScheduler'
import { singletonManager, SINGLETON_IDS } from './services/singletonPromise'

type CursorPhase = 'entering' | 'active' | 'exiting'

function logDuration(label: string, startedAt: number) {
  console.info(`[Perf] ${label}: ${Math.round(performance.now() - startedAt)}ms`)
}

/**
 * 恢复标签页（立即执行）
 */
async function restoreTabs(): Promise<void> {
  let openedFromFileAssociation = false
  if (isTauri()) {
    try {
      openedFromFileAssociation = await invoke<boolean>('has_pending_open_files')
    } catch (err) {
      console.warn('[App] Pending open file check failed:', err)
    }
  }

  if (openedFromFileAssociation) {
    useEditorStore.getState().resetTabsForExternalOpen()
    return
  }

  const restoreStartedAt = performance.now()
  const state = useEditorStore.getState()
  console.log('[App] Restoring tabs:', state.tabs.length, 'tabs')
  const restorableTabs = getRestorablePersistedTabs(state.tabs)
  const validIds = new Set(restorableTabs.map((tab) => tab.id))
  const activeTabId = state.activeTabId && validIds.has(state.activeTabId)
    ? state.activeTabId
    : restorableTabs[0]?.id ?? null
  const activeTab = restorableTabs.find((tab) => tab.id === activeTabId)
  const [restoredActiveTab] = activeTab
    ? await restorePersistedTabs([activeTab])
    : []
  const initialTabs = restorableTabs.map((tab) =>
    tab.id === activeTabId ? (restoredActiveTab ?? tab) : tab
  )
  state.restoreTabs(
    initialTabs,
    activeTabId,
    state.rightPaneTabId && validIds.has(state.rightPaneTabId) ? state.rightPaneTabId : null,
  )
  logDuration('active tab restore', restoreStartedAt)

  const backgroundTabs = restorableTabs.filter((tab) => tab.id !== activeTabId)
  void restorePersistedTabs(backgroundTabs, {
    concurrency: 3,
    onTabRestored(restoredTab, index) {
      const originalTab = backgroundTabs[index]
      useEditorStore.getState().mergeRestoredTab(originalTab, restoredTab)
    },
  }).then(() => {
    logDuration('background tab restore', restoreStartedAt)
  }).catch((error) => {
    console.warn('[App] Background tab restore failed:', error)
  })
}

/**
 * 注册闲时预热任务
 */
function scheduleIdleWarmup(): void {
  console.log('[App] 注册闲时预热任务')

  // 优先级 1: AI 客户端初始化
  scheduleIdleTask(
    SINGLETON_IDS.CHAT_AI,
    async () => {
      const { ai } = useSettingsStore.getState()
      if ((ai.apiKey || isLocalApi(ai.baseUrl)) && ai.baseUrl && ai.chatModel) {
        await singletonManager.init(SINGLETON_IDS.CHAT_AI, async () => {
          const startTime = performance.now()
          const provider = initAiClient(ai)
          logDuration('AI client init', startTime)
          return provider
        })
      }
    },
    1,
    'AI 客户端初始化'
  )

  // 优先级 2: Embedding 客户端初始化
  scheduleIdleTask(
    SINGLETON_IDS.EMBEDDING_AI,
    async () => {
      const { ai } = useSettingsStore.getState()
      if ((ai.embedding.apiKey || isLocalApi(ai.embedding.baseUrl)) && ai.embedding.baseUrl && ai.embedding.embeddingModel) {
        await singletonManager.init(SINGLETON_IDS.EMBEDDING_AI, async () => {
          const startTime = performance.now()
          const provider = initEmbeddingClient(ai.embedding)
          logDuration('Embedding client init', startTime)
          return provider
        })
      }
    },
    2,
    'Embedding 客户端初始化'
  )

  // 向量库延迟加载：不在启动时预热，首次使用 RAG 时才加载
  // RAG 全量向量仅在首次检索时由 Rust 后台索引服务按需加载

  // AI 状态校验：完全异步，不阻塞任何操作
  setTimeout(() => {
    const startTime = performance.now()
    validateAiStatus().then((status) => {
      useAppStore.getState().setAiStatus(status)
      logDuration('AI status validate', startTime)
    }).catch((err) => {
      console.warn('[App] AI status validation failed:', err)
    })
  }, 3000) // 延迟 3 秒，完全不阻塞

  // 优先级 7: 旧版文件访问迁移
  scheduleIdleTask(
    SINGLETON_IDS.LEGACY_FILE_ACCESS,
    async () => {
      if (isTauri()) {
        const startTime = performance.now()
        try {
          await migrateLegacyFileAccess()
          logDuration('legacy file access migration', startTime)
        } catch (err) {
          console.warn('[App] Legacy file access migration failed:', err)
        }
      }
    },
    7,
    '旧版文件访问迁移'
  )

  // 优先级 8: 旧版数据检测
  scheduleIdleTask(
    SINGLETON_IDS.LEGACY_DATA_DETECTION,
    async () => {
      if (isTauri()) {
        const startTime = performance.now()
        try {
          const detection = await detectLegacyData()
          if (detection.legacyDetected && !detection.userNoticed) {
            // 这里需要通过事件或回调更新 UI，暂时只记录日志
            console.log('[App] Legacy data detected:', detection)
          }
          logDuration('legacy data detection', startTime)
        } catch (err) {
          console.warn('[App] Legacy detection failed:', err)
        }
      }
    },
    8,
    '旧版数据检测'
  )
}

function CustomCursorFrame({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(enabled)
  const [phase, setPhase] = useState<CursorPhase>(enabled ? 'active' : 'exiting')
  const [showGhost, setShowGhost] = useState(false)
  const ghostRef = useRef<HTMLImageElement | null>(null)
  const pointerRef = useRef({ x: -32, y: -32 })
  const pointerFrameRef = useRef<number | null>(null)
  const exitTimer = useRef<number | null>(null)
  const enterTimer = useRef<number | null>(null)

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
      const target = event.target as HTMLElement | null
      const nextShowGhost = !target?.closest('input, textarea, [contenteditable="true"], .cm-editor, .gm-system-cursor')
      setShowGhost((current) => current === nextShowGhost ? current : nextShowGhost)
      if (pointerFrameRef.current === null) {
        pointerFrameRef.current = window.requestAnimationFrame(() => {
          pointerFrameRef.current = null
          const { x, y } = pointerRef.current
          if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
        })
      }
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (exitTimer.current) {
      window.clearTimeout(exitTimer.current)
      exitTimer.current = null
    }
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current)
      enterTimer.current = null
    }

    if (enabled) {
      setMounted(true)
      setPhase('entering')
      enterTimer.current = window.setTimeout(() => {
        setPhase('active')
        enterTimer.current = null
      }, 180)
      return
    }

    if (!mounted) return
    setPhase('exiting')
    exitTimer.current = window.setTimeout(() => {
      setMounted(false)
      exitTimer.current = null
    }, 180)
  }, [enabled, mounted])

  useEffect(() => {
    return () => {
      if (exitTimer.current) window.clearTimeout(exitTimer.current)
      if (enterTimer.current) window.clearTimeout(enterTimer.current)
    }
  }, [])

  if (!mounted) {
    return <div className="h-full gm-system-cursor gm-native-cursor-root">{children}</div>
  }

  const useNativeCustomCursor = phase === 'active'

  return (
    <Cursor
      className={`h-full gm-custom-cursor-frame gm-custom-cursor-frame--${phase}`}
      style={useNativeCustomCursor ? undefined : ({ '--animal-cursor': 'none' } as React.CSSProperties)}
    >
      {children}
      {phase !== 'active' && showGhost && (
        <img
          ref={ghostRef}
          className="gm-custom-cursor-ghost"
          src="/cursor-icon.png"
          alt=""
          aria-hidden="true"
          style={{ transform: 'translate3d(-32px, -32px, 0)' }}
        />
      )}
    </Cursor>
  )
}

function App() {
  const [dbError, setDbError] = useState<string | null>(null)
  const [appReady, setAppReady] = useState(false)
  const [legacyDetection, setLegacyDetection] = useState<LegacyDetectionResult | null>(null)
  const customCursorEnabled = useSettingsStore((s) => s.appearance.customCursorEnabled)
  const theme = useSettingsStore((s) => s.appearance.theme)
  const lightPalette = useSettingsStore((s) => s.appearance.lightPalette)
  useExternalFileOpen(appReady)

  // 调试用：控制台调用 __testLegacyModal() 唤起旧版数据检测弹窗
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__testLegacyModal = () => {
      setLegacyDetection({
        legacyDetected: true,
        userNoticed: false,
        detectedAt: Date.now(),
        noticedAt: null,
        detectedCounts: { documents: 3, chat_sessions: 5, chat_messages: 42, memories: 12 },
      })
    }
    return () => {
      delete (window as unknown as Record<string, unknown>).__testLegacyModal
    }
  }, [])

  useLayoutEffect(() => {
    syncDocumentTheme(theme, lightPalette)
  }, [lightPalette, theme])

  // 禁用浏览器默认右键菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      const appInitStartedAt = performance.now()

      try {
        // ==================== 启动阶段：只阻塞数据库和 UI 水合 ====================
        const secretsStartedAt = performance.now()
        await hydrateSettingsSecrets().catch((err) =>
          console.warn('[App] Settings secret hydration failed:', err)
        )
        logDuration('settings secret hydration', secretsStartedAt)

        const databaseStartedAt = performance.now()
        await initDatabase()
        logDuration('database init', databaseStartedAt)

        // 标记数据库就绪
        if (getDatabaseRuntimeState().status !== 'ready') {
          throw new Error('Database not ready after init')
        }

        // ==================== 首屏后：立即恢复标签页 ====================
        const restoreTabsStartedAt = performance.now()
        await restoreTabs()
        logDuration('tabs restored', restoreTabsStartedAt)

        // ==================== UI 就绪：立即显示界面 ====================
        if (!cancelled) {
          setAppReady(true)
        }
        logDuration('ui ready', appInitStartedAt)

        // ==================== 首屏后：注册闲时预热任务 ====================
        scheduleIdleWarmup()

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[App] Database init failed:', msg)
        if (!cancelled) {
          setDbError(msg)
        }
        logDuration('app init failed', appInitStartedAt)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      {dbError && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-100 text-yellow-800 text-caption px-4 py-1 text-center">
          数据库初始化失败: {dbError}（数据不会持久化）
        </div>
      )}
      <CustomCursorFrame enabled={customCursorEnabled}>
        <AppLayout />
      </CustomCursorFrame>
      <ToastContainer />
      <UpdateManager />
      <GlobalTooltip />
      {legacyDetection && (
        <LegacyDataNoticeModal
          detection={legacyDetection}
          onClose={() => setLegacyDetection(null)}
        />
      )}
    </>
  )
}

export default App
