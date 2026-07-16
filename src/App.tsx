import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ToastContainer } from './components/common/ToastContainer'
import {
  getDatabaseRuntimeState,
  initDatabase,
  subscribeDatabaseRuntimeState,
} from './services/database/db'
import { loadAllMemories, loadChatSessions } from './services/database/persistence'
import { vectorStore } from './services/rag/vectorStore'
import { hydrateSettingsSecrets } from './services/settingsSecrets'
import { initAiClient, initEmbeddingClient, isLocalApi, validateAiStatus } from './services/ai/aiClient'
import { syncDocumentTheme, useSettingsStore } from './stores/settingsStore'
import { useAppStore } from './stores/appStore'
import { useExternalFileOpen } from './hooks/useExternalFileOpen'
import { Cursor } from 'animal-island-ui'
import { invoke } from '@tauri-apps/api/core'
import { restorePersistedTabs } from './services/sessionRestore'
import { useEditorStore } from './stores/editorStore'
import { isTauri } from './hooks/useTauri'
import { GlobalTooltip } from './components/common/Tooltip'
import { migrateLegacyFileAccess } from './services/persistedFileAccess'
import { UpdateManager } from './components/update/UpdateManager'
import { toast } from './services/toast'
import { detectLegacyData, type LegacyDetectionResult } from './services/database/legacyDetector'
import { LegacyDataNoticeModal } from './components/legacy/LegacyDataNoticeModal'
type CursorPhase = 'entering' | 'active' | 'exiting'

function logDuration(label: string, startedAt: number) {
  console.info(`[Perf] ${label}: ${Math.round(performance.now() - startedAt)}ms`)
}

let businessDataHydration: Promise<void> | null = null

function hydrateBusinessData(): Promise<void> {
  if (businessDataHydration) return businessDataHydration
  businessDataHydration = (async () => {
    console.log('[App] hydrateBusinessData started')
    let openedFromFileAssociation = false
    if (isTauri()) {
      try {
        openedFromFileAssociation = await invoke<boolean>('has_pending_open_files')
      } catch (err) {
        console.warn('[App] Pending open file check failed:', err)
      }
    }
    if (openedFromFileAssociation) {
      useEditorStore.setState({ tabs: [], activeTabId: null, rightPaneTabId: null, viewMode: 'edit' })
    } else {
      const restoreStartedAt = performance.now()
      const state = useEditorStore.getState()
      console.log('[App] Restoring tabs:', state.tabs.length, 'tabs')
      const tabs = await restorePersistedTabs(state.tabs)
      console.log('[App] Restored tabs:', tabs.map(t => ({ id: t.id, title: t.title, hasContent: !!t.content, contentLength: t.content?.length })))
      const validIds = new Set(tabs.map((tab) => tab.id))
      useEditorStore.setState({
        tabs,
        activeTabId: state.activeTabId && validIds.has(state.activeTabId) ? state.activeTabId : tabs[0]?.id ?? null,
        rightPaneTabId: state.rightPaneTabId && validIds.has(state.rightPaneTabId) ? state.rightPaneTabId : null,
      })
      logDuration('session restore', restoreStartedAt)
    }

    const databaseHydrationStartedAt = performance.now()
    await Promise.all([
      loadChatSessions(0, 50),
      loadAllMemories(),
      vectorStore.loadFromDatabase(),
    ])
    logDuration('database business hydration', databaseHydrationStartedAt)
  })().catch((error) => {
    businessDataHydration = null
    console.warn('[App] Database business hydration failed:', error)
  })
  return businessDataHydration
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
    let bootstrapComplete = false
    const unsubscribeDatabase = subscribeDatabaseRuntimeState((state) => {
      if (!bootstrapComplete) return
      if (state.status === 'ready') void hydrateBusinessData()
    })
    async function init() {
      const appInitStartedAt = performance.now()
      try {
        const secretsStartedAt = performance.now()
        await hydrateSettingsSecrets().catch((err) =>
          console.warn('[App] Settings secret hydration failed:', err)
        )
        logDuration('settings secret hydration', secretsStartedAt)

        const databaseStartedAt = performance.now()
        await initDatabase()
        logDuration('database init', databaseStartedAt)

        if (isTauri()) {
          try {
            await migrateLegacyFileAccess()
          } catch (err) {
            console.warn('[App] Legacy file access migration failed:', err)
          }
        }

        bootstrapComplete = true
        if (getDatabaseRuntimeState().status === 'ready') await hydrateBusinessData()

        // 初始化 AI 客户端（对话 + Embedding，本地 API 无需 apiKey）
        const { ai } = useSettingsStore.getState()
        if ((ai.apiKey || isLocalApi(ai.baseUrl)) && ai.baseUrl && ai.chatModel) {
          try { initAiClient(ai) } catch (err) { console.warn('[App] Chat client init failed:', err) }
        }
        if ((ai.embedding.apiKey || isLocalApi(ai.embedding.baseUrl)) && ai.embedding.baseUrl && ai.embedding.embeddingModel) {
          try { initEmbeddingClient(ai.embedding) } catch (err) { console.warn('[App] Embedding client init failed:', err) }
        }

        // 校验 AI 服务连通性
        validateAiStatus().then((status) => {
          useAppStore.getState().setAiStatus(status)
        }).catch(() => {})

        // 检测旧版 IndexedDB 数据（仅桌面端）
        if (isTauri()) {
          try {
            const detection = await detectLegacyData()
            if (!cancelled && detection.legacyDetected && !detection.userNoticed) {
              setLegacyDetection(detection)
            }
          } catch (err) {
            console.warn('[App] Legacy detection failed:', err)
          }
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[App] Database init failed:', msg)
        if (!cancelled) {
          setDbError(msg)
        }
      } finally {
        if (!cancelled) {
          setAppReady(true)
        }
        logDuration('app init to ready', appInitStartedAt)
      }
    }
    init()
    return () => {
      cancelled = true
      unsubscribeDatabase()
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
