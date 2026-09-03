import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { EditorView } from '@codemirror/view'
import { useAppStore } from '@/stores/appStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { AiShortcutMenuItems } from './AiShortcutMenuItems'
import { useFileOperations } from '@/hooks/useFileOperations'
import { useActiveHeading, type ActiveHeadingGeometry } from '@/hooks/useActiveHeading'
import { saveFile, saveFileAs } from '@/services/fileSystem'
import { scheduleMarkdownDocumentIndex } from '@/services/rag/indexer'
import { extractToc, type TocItem } from '@/services/markdownToc'
import { toggleMarkdownTaskAtLine } from '@/services/markdownTasks'
import { saveExternalImageForMarkdown, saveImageFileForMarkdown } from '@/services/markdownImages'
import { toast } from '@/services/toast'
import { describeFileOperationError } from '@/services/fileOperationErrors'
import { openFileDialog } from '@/hooks/useTauri'
import { addSelectionContextTag, setAiShortcutPrompt } from '@/services/aiContext'
import { eventMarker } from '@/services/eventMarker'
import { markStartupPoint } from '@/services/startupPerformance'
import { hasBootSnapshotContent } from '@/services/bootSnapshot'
import { OPEN_EDITOR_SEARCH_EVENT } from '@/services/editorEvents'
import { startHeadingScroll } from '@/services/headingScroll'
import { EditorContextMenu } from './EditorContextMenu'
import { MarkdownToc } from './MarkdownToc'
import type { MarkdownBlockCommitRequest, MarkdownPreviewHandle } from './markdownPreviewTypes'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { SearchOverlay } from './SearchOverlay'
import { TabBar } from './TabBar'
import { ContextMenu, ContextMenuGroupTitle, ContextMenuItem, ContextMenuSeparator } from '@/components/common/ContextMenu'
import {
  MODE_PREWARM_ACTIVITY_PAUSE,
  MODE_PREWARM_IDLE_DELAY,
  ReadingPositionSession,
  ScrollSyncSession,
  getNextPrewarmTarget,
  scheduleIdlePrewarm,
  decideResource,
  mapPerformancePolicy,
  type ReadingPosition,
  type PrewarmTargetMode,
  type PrewarmedModeKeys,
  type InstanceType,
} from '@/services/editorSession'

const LazyMarkdownPreview = lazy(() => import('./MarkdownPreview').then(({ MarkdownPreview }) => ({ default: MarkdownPreview })))
const LazyMarkdownDiffView = lazy(() => import('./MarkdownDiffView').then(({ MarkdownDiffView }) => ({ default: MarkdownDiffView })))

function PreviewSuspenseFallback() {
  return <div className="h-full min-h-0 w-full bg-gm-surface" aria-hidden="true" />
}

interface PreviewMenuState {
  x: number
  y: number
  selectedText: string
  startLine?: number
  endLine?: number
  pane: 'left' | 'right'
  /** 统一 Range 快照的精确源码 offset（接管选区时存在） */
  selectionFrom?: number
  selectionTo?: number
}

interface PreviewSelectionSource {
  title: string
  filePath?: string | null
  text: string
  startLine?: number
  endLine?: number
  selectionFrom?: number
  selectionTo?: number
}

/** 编辑器被动平滑跟随状态（预览滚动驱动编辑器）。独立于源端 scroll 事件节流 ref。 */
interface EditorScrollFollowerState {
  frameId: number | null
  active: boolean
  /** 同步 effect 生命周期代数：effect 重挂载 / cleanup 后旧帧在下一帧自杀 */
  generation: number
  view: EditorView | null
  /** 目标行起始 offset：每帧动态读取 lineBlockAt(pos).top，避免固化估算高度 */
  pos: number | null
  /** 上一次实际写入后读回的 scrollTop（兼容浏览器夹取与像素舍入） */
  lastWrite: number | null
  lastTime: number | null
  lastTarget: number | null
  stableFrames: number
}

/** 预览被动平滑跟随状态（编辑器滚动驱动预览）。 */
interface PreviewScrollFollowerState {
  frameId: number | null
  active: boolean
  generation: number
  container: HTMLElement | null
  /** 静态目标：每次同步事件只更新目标，不重启动画 */
  target: number | null
  lastWrite: number | null
  lastTime: number | null
  lastTarget: number | null
  stableFrames: number
}

const PREVIEW_CONTEXT_HIGHLIGHT = 'preview-context-selection'
const DROP_IMAGES_EVENT = 'guanmo:drop-image-paths'
const PREVIEW_UPDATE_DELAY = 300
const LARGE_PREVIEW_UPDATE_DELAY = 650
const HUGE_PREVIEW_UPDATE_DELAY = 900
const SCROLL_SYNC_TOP_OFFSET = 32
const SCROLL_SYNC_INPUT_PAUSE_MS = 700
/** 预览→编辑器反向滚动同步只接受“用户主动滚动预览”产生的 scroll 事件；
 *  渲染补偿（内容更新锚点补偿、scrollTop 夹取、位置恢复、异步图片/KaTeX 高度变化）
 *  产生的 scroll 事件一律不得反向移动编辑器。该窗口覆盖滚轮惯性滚动与平滑滚动时长。 */
const PREVIEW_SYNC_GESTURE_WINDOW_MS = 800
/** 同步滚动平滑跟随时间常数：每帧按 1 - exp(-dt / τ) 向目标插值 */
const SCROLL_SYNC_FOLLOW_TAU_MS = 80
/** 单帧 dt 上限：窗口后台恢复后避免单帧跨越 */
const SCROLL_SYNC_FOLLOW_MAX_DT_MS = 40
/** 收敛阈值：实际 scrollTop 与目标误差小于该值视为已收敛 */
const SCROLL_SYNC_FOLLOW_EPSILON_PX = 0.5
/** 目标连续稳定帧数要求：动态测量刚变化时不提前退出 */
const SCROLL_SYNC_FOLLOW_STABLE_FRAMES = 2
/** 实际 scrollTop 与上一次写入值偏差超过该值视为外部修改（渲染补偿 / CodeMirror 测量校正） */
const SCROLL_SYNC_EXTERNAL_DRIFT_PX = 1
const PREVIEW_SWITCH_MARK_PREFIX = 'guanmo:preview-switch'

interface ScheduledPreviewContent {
  content: string
  version: number
  pending: boolean
}

function getPreviewUpdateDelay(content: string) {
  if (content.length >= 80000) return HUGE_PREVIEW_UPDATE_DELAY
  if (content.length >= 30000) return LARGE_PREVIEW_UPDATE_DELAY
  return PREVIEW_UPDATE_DELAY
}

function useScheduledPreviewContent(
  content: string,
  documentKey: string | null | undefined,
  enabled = true
) {
  const [preview, setPreview] = useState<ScheduledPreviewContent>({
    content,
    version: 0,
    pending: false,
  })
  const previousKeyRef = useRef(documentKey)
  const previousEnabledRef = useRef(enabled)
  const versionRef = useRef(0)
  const switchedDocument = previousKeyRef.current !== documentKey
  const becameEnabled = enabled && !previousEnabledRef.current
  let visiblePreview = preview

  if (switchedDocument || becameEnabled) {
    previousKeyRef.current = documentKey
    previousEnabledRef.current = enabled
    versionRef.current += 1
    visiblePreview = { content, version: versionRef.current, pending: false }
  }

  useLayoutEffect(() => {
    previousEnabledRef.current = enabled
    if (!enabled) {
      if (preview.content) {
        versionRef.current += 1
        setPreview({ content: '', version: versionRef.current, pending: false })
      }
      return
    }
    if (switchedDocument || becameEnabled) {
      setPreview({ content, version: versionRef.current, pending: false })
      return
    }

    if (preview.content === content) {
      return
    }

    const version = versionRef.current + 1
    const timer = setTimeout(() => {
      versionRef.current = version
      setPreview({ content, version, pending: false })
    }, getPreviewUpdateDelay(content))

    return () => clearTimeout(timer)
  }, [becameEnabled, content, documentKey, enabled, preview.content, switchedDocument])

  return enabled
    ? { ...visiblePreview, pending: visiblePreview.content !== content }
    : visiblePreview
}

function seedReadingPositionsFromStore(): ReadingPositionSession {
  const session = new ReadingPositionSession()
  const stored = useEditorStore.getState().readingPositions
  for (const [key, pos] of Object.entries(stored)) {
    if (key.includes(':')) {
      const [tabId, pane] = key.split(':') as [string, 'left' | 'right']
      session.saveForPane(tabId, pane, pos)
    } else {
      session.save(key, pos)
    }
  }
  return session
}

export function EditorArea() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const updateTabContent = useEditorStore((s) => s.updateTabContent)
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  const rightPaneTabId = useEditorStore((s) => s.rightPaneTabId)
  const rightPaneUserSelected = useEditorStore((s) => s.rightPaneUserSelected)
  const setRightPaneTabId = useEditorStore((s) => s.setRightPaneTabId)
  const previewSwitchingTabId = useEditorStore((s) => s.previewSwitchingTabId)
  const clearPreviewSwitching = useEditorStore((s) => s.clearPreviewSwitching)
  const flushReadingPositions = useEditorStore((s) => s.flushReadingPositions)
  const editorFontSize = useSettingsStore((s) => s.editor.fontSize)
  const editorLineHeight = useSettingsStore((s) => s.editor.lineHeight)
  const editorFontFamily = useSettingsStore((s) => s.editor.fontFamily)
  const previewFontFamily = useSettingsStore((s) => s.editor.previewFontFamily)
  const editorWordWrap = useSettingsStore((s) => s.editor.wordWrap)
  const editorLineNumbers = useSettingsStore((s) => s.editor.lineNumbers)
  const syncScroll = useSettingsStore((s) => s.editor.syncScroll)
  const inlinePreviewEdit = useSettingsStore((s) => s.editor.inlinePreviewEdit)
  const modePerformancePolicy = useSettingsStore((s) => s.editor.modePerformancePolicy)
  const { prewarm: modePrewarm, resource: modeResourcePolicy } = useMemo(
    () => mapPerformancePolicy(modePerformancePolicy),
    [modePerformancePolicy],
  )
  const fullscreenContentPadding = useSettingsStore((s) => s.editor.fullscreenContentPadding)
  const viewModeUsage = useEditorStore((s) => s.viewModeUsage)
  const isFullscreen = useAppStore((s) => s.isFullscreen)
  const editorViewRef = useRef<EditorView | null>(null)
  const readingPositionsRef = useRef<ReadingPositionSession>(seedReadingPositionsFromStore())
  const leftPreviewRef = useRef<HTMLDivElement>(null)
  const rightPreviewRef = useRef<HTMLDivElement>(null)
  const leftMarkdownPreviewRef = useRef<MarkdownPreviewHandle>(null)
  const rightMarkdownPreviewRef = useRef<MarkdownPreviewHandle>(null)
  const isRestoringScrollRef = useRef(false)
  const restoreScrollFrameRef = useRef<number | null>(null)
  const editorRestoreFrameRef = useRef<number | null>(null)

  const restoredPreviewKeysRef = useRef<{ left: string | null; right: string | null }>({ left: null, right: null })
  const scrollSyncSessionRef = useRef(new ScrollSyncSession())
  const editorScrollFrameRef = useRef<number | null>(null)
  const editorTocFrameRef = useRef<number | null>(null)
  const editorHeadingJumpCancelRef = useRef<(() => void) | null>(null)
  const previewScrollFrameRef = useRef<number | null>(null)
  const lastEditorInputAtRef = useRef(0)
  /** 预览 pane 上最近一次用户滚动手势（wheel / pointerdown）时间戳 */
  const previewGestureAtRef = useRef(0)
  /** 指针当前是否按在预览 pane 上（覆盖滚动条拖拽、触控拖拽的长时滚动） */
  const previewPointerDownRef = useRef(false)
  /** 同步滚动 follower 生命周期代数（独立于源端 scroll 节流的 editorScrollFrameRef / previewScrollFrameRef） */
  const scrollFollowerGenerationRef = useRef(0)
  const editorFollowerRef = useRef<EditorScrollFollowerState>({
    frameId: null,
    active: false,
    generation: 0,
    view: null,
    pos: null,
    lastWrite: null,
    lastTime: null,
    lastTarget: null,
    stableFrames: 0,
  })
  const previewFollowerRef = useRef<PreviewScrollFollowerState>({
    frameId: null,
    active: false,
    generation: 0,
    container: null,
    target: null,
    lastWrite: null,
    lastTime: null,
    lastTarget: null,
    stableFrames: 0,
  })
  const [, setPreviewRestoreTick] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [rightPaneDragOver, setRightPaneDragOver] = useState(false)
  const [tocCollapsed, setTocCollapsed] = useState(false)
  const [activeEditorHeading, setActiveEditorHeading] = useState<string | null>(null)
  const [tocFocus, setTocFocus] = useState<'editor' | 'preview'>('editor')
  const [previewMenu, setPreviewMenu] = useState<PreviewMenuState | null>(null)
  const [prewarmedModeKeys, setPrewarmedModeKeys] = useState<PrewarmedModeKeys>({})
  const [activeDocumentFirstScreenReady, setActiveDocumentFirstScreenReady] = useState(false)
  const activeDocumentFirstScreenReadyRef = useRef(false)
  const firstScreenDocumentIdRef = useRef<string | null>(activeTabId)
  const prewarmedModeKeysRef = useRef<PrewarmedModeKeys>({})
  prewarmedModeKeysRef.current = prewarmedModeKeys
  const warmedModeKeysRef = useRef<Set<string>>(new Set())
  const warmScopeRef = useRef<string | null>(null)
  const prewarmCancelRef = useRef(0)
  const idlePrewarmCancelRef = useRef<(() => void) | null>(null)
  const pendingPrewarmRef = useRef<{ scheduleId: string; target: PrewarmTargetMode } | null>(null)
  const prewarmScheduleSequenceRef = useRef(0)
  const requestedPrewarmScheduleIdsRef = useRef<Partial<Record<PrewarmTargetMode, string>>>({})
  const lastUserActivityAtRef = useRef(Date.now())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousActiveTabIdRef = useRef<string | null>(activeTabId)

  useEffect(() => {
    if (isFullscreen) setTocCollapsed(true)
  }, [isFullscreen])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const selectedRightTab = rightPaneTabId ? tabs.find((t) => t.id === rightPaneTabId) : null
  const dualRightTab = !rightPaneUserSelected
    ? activeTab
    : selectedRightTab
  const retainedRightTabRef = useRef<(typeof tabs)[number] | null>(null)
  const leftPreviewDraftRef = useRef(false)
  const rightPreviewDraftRef = useRef(false)
  if (viewMode === 'dual-preview') {
    if (!rightPreviewDraftRef.current || retainedRightTabRef.current?.id === dualRightTab?.id) {
      retainedRightTabRef.current = dualRightTab ?? null
    }
  }
  const rightTab = retainedRightTabRef.current
  const leftPreviewVisible = viewMode === 'preview' || viewMode === 'edit-preview' || viewMode === 'dual-preview'
  const editorVisible = viewMode === 'edit' || viewMode === 'edit-preview'
  const previewContentReady = Boolean(activeTab && (
    !activeTab.filePath || activeTab.modified || activeTab.content.length > 0 || hasBootSnapshotContent(activeTab)
  ))

  const [leftPreviewMounted, setLeftPreviewMounted] = useState(false)
  const [rightPreviewMounted, setRightPreviewMounted] = useState(false)
  const [editorMounted, setEditorMounted] = useState(false)
  const [diffMounted, setDiffMounted] = useState(false)
  const [draftDecisionVersion, setDraftDecisionVersion] = useState(0)
  const leftPreviewMountedRef = useRef(leftPreviewMounted)
  const rightPreviewMountedRef = useRef(rightPreviewMounted)
  const editorMountedRef = useRef(editorMounted)
  const diffMountedRef = useRef(diffMounted)
  leftPreviewMountedRef.current = leftPreviewMounted
  rightPreviewMountedRef.current = rightPreviewMounted
  editorMountedRef.current = editorMounted
  diffMountedRef.current = diffMounted
  const leftPreviewTtlRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rightPreviewTtlRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorTtlRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diffReleaseFrameRef = useRef<number | null>(null)
  const lastInstanceUseRef = useRef<Record<string, number>>({})
  const instanceDocumentRef = useRef<Record<string, string | null>>({})
  const forceDraftReleaseRef = useRef({ left: false, right: false })
  const resourcePolicyRef = useRef(modeResourcePolicy)
  resourcePolicyRef.current = modeResourcePolicy
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const previousVisibilityRef = useRef({
    editor: editorVisible,
    left: leftPreviewVisible,
    right: viewMode === 'dual-preview',
  })

  const setResourceMounted = useCallback((
    resource: 'editor' | 'left-preview' | 'right-preview' | 'diff',
    mounted: boolean,
    documentKey: string | null = null,
  ) => {
    instanceDocumentRef.current[resource] = mounted ? documentKey : null
    if (resource === 'editor') {
      editorMountedRef.current = mounted
      setEditorMounted(mounted)
    } else if (resource === 'left-preview') {
      leftPreviewMountedRef.current = mounted
      setLeftPreviewMounted(mounted)
    } else if (resource === 'right-preview') {
      rightPreviewMountedRef.current = mounted
      setRightPreviewMounted(mounted)
    } else {
      diffMountedRef.current = mounted
      setDiffMounted(mounted)
    }
  }, [])

  // Resource policy: clean up stale TTL timers and manage instance lifecycle
  const clearTtl = useCallback((ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current !== null) {
      clearTimeout(ref.current)
      ref.current = null
    }
  }, [])

  const clearAllTtls = useCallback(() => {
    clearTtl(leftPreviewTtlRef)
    clearTtl(rightPreviewTtlRef)
    clearTtl(editorTtlRef)
  }, [clearTtl])

  const isInstanceVisible = useCallback((instanceKey: 'editor' | 'left-preview' | 'right-preview' | 'diff') => {
    const currentMode = viewModeRef.current
    if (instanceKey === 'editor') return currentMode === 'edit' || currentMode === 'edit-preview'
    if (instanceKey === 'left-preview') return currentMode === 'preview' || currentMode === 'edit-preview' || currentMode === 'dual-preview'
    if (instanceKey === 'right-preview') return currentMode === 'dual-preview'
    return currentMode === 'diff-preview'
  }, [])

  const decideHiddenResource = useCallback((
    instanceKey: 'editor' | 'left-preview' | 'right-preview' | 'diff',
    instanceType: InstanceType,
    candidateDocId: string | null,
    docCharCount: number,
    draftRef?: React.MutableRefObject<boolean>,
  ) => {
    const now = Date.now()
    return decideResource({
      policy: resourcePolicyRef.current,
      docId: candidateDocId,
      candidateDocId,
      docCharCount,
      instanceType,
      isCurrentlyVisible: false,
      lastUsedAt: lastInstanceUseRef.current[instanceKey] ?? now,
      now,
      hasUncommittedDraft: draftRef?.current ?? false,
    })
  }, [])

  const scheduleRelease = useCallback((
    ttlRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    instanceKey: 'editor' | 'left-preview' | 'right-preview',
    instanceType: InstanceType,
    candidateDocId: string | null,
    docCharCount: number,
    releaseFn: () => void,
    draftRef?: React.MutableRefObject<boolean>
  ) => {
    clearTtl(ttlRef)
    const now = Date.now()
    const hasDraft = draftRef?.current ?? false
    const decision = decideHiddenResource(instanceKey, instanceType, candidateDocId, docCharCount, draftRef)
    if (decision.action === 'release') {
      if (!hasDraft && !isInstanceVisible(instanceKey) && instanceDocumentRef.current[instanceKey] === candidateDocId) {
        if (import.meta.env.DEV) {
          eventMarker.mark('resource-release', { resource: instanceKey, reason: 'immediate', phase: 'requested' })
        }
        releaseFn()
      }
    } else if (decision.action === 'keepUntil') {
      const timer = setTimeout(() => {
        if (ttlRef.current !== timer) return
        ttlRef.current = null
        if (isInstanceVisible(instanceKey)) return
        if (instanceDocumentRef.current[instanceKey] !== candidateDocId) return
        const currentDecision = decideResource({
          policy: resourcePolicyRef.current,
          docId: candidateDocId,
          candidateDocId,
          docCharCount,
          instanceType,
          isCurrentlyVisible: false,
          lastUsedAt: lastInstanceUseRef.current[instanceKey] ?? now,
          now: Date.now(),
          hasUncommittedDraft: draftRef?.current ?? false,
        })
        if (currentDecision.action === 'release') {
          if (import.meta.env.DEV) {
            eventMarker.mark('resource-release', { resource: instanceKey, reason: 'ttl-expired', phase: 'requested' })
          }
          releaseFn()
        }
      }, Math.max(0, decision.deadline - now))
      ttlRef.current = timer
    }
  }, [clearTtl, decideHiddenResource, isInstanceVisible])

  const cancelPendingPrewarm = useCallback((reason: 'user-activity' | 'mode-change' | 'context-change' | 'policy-change' | 'schedule-replaced') => {
    const pending = pendingPrewarmRef.current
    if (pending) {
      if (import.meta.env.DEV) {
        eventMarker.mark('prewarm-cancel', {
          reason,
          scheduleId: pending.scheduleId,
          target: pending.target,
        })
      }
      pendingPrewarmRef.current = null
    }
    if (idlePrewarmCancelRef.current) {
      idlePrewarmCancelRef.current()
      idlePrewarmCancelRef.current = null
    }
  }, [])

  const cancelModePrewarm = useCallback((reason: 'user-activity' | 'mode-change' | 'context-change' | 'policy-change') => {
    prewarmCancelRef.current += 1
    lastUserActivityAtRef.current = Date.now()
    cancelPendingPrewarm(reason)
  }, [cancelPendingPrewarm])

  const previousModePrewarmRef = useRef(modePrewarm)

  // Detect policy changes for performance monitor
  const previousPerformancePolicyRef = useRef(modePerformancePolicy)
  useEffect(() => {
    const prev = previousPerformancePolicyRef.current
    previousPerformancePolicyRef.current = modePerformancePolicy
    if (import.meta.env.DEV && prev !== modePerformancePolicy) {
      eventMarker.mark('policy-change', { policy: modePerformancePolicy, prewarm: modePrewarm, resource: modeResourcePolicy })
    }
  }, [modePerformancePolicy, modePrewarm, modeResourcePolicy])

  useEffect(() => {
    const previous = previousModePrewarmRef.current
    previousModePrewarmRef.current = modePrewarm
    if (previous !== 'off' && modePrewarm === 'off') {
      cancelModePrewarm('policy-change')
      clearAllTtls()
      if (!editorVisible) {
        setResourceMounted('editor', false)
      }
      if (!leftPreviewVisible) {
        if (leftPreviewDraftRef.current) forceDraftReleaseRef.current.left = true
        else {
          leftPreviewRenderRef.current = { content: '', filePath: undefined }
          setResourceMounted('left-preview', false)
        }
      }
      if (viewMode !== 'dual-preview') {
        if (rightPreviewDraftRef.current) forceDraftReleaseRef.current.right = true
        else {
          retainedRightTabRef.current = null
          setResourceMounted('right-preview', false)
        }
      }
      if (diffReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(diffReleaseFrameRef.current)
        diffReleaseFrameRef.current = null
      }
      if (viewMode !== 'diff-preview') {
        setResourceMounted('diff', false)
      }
      setPrewarmedModeKeys({})
    }
  }, [modePrewarm, editorVisible, leftPreviewVisible, viewMode, cancelModePrewarm, clearAllTtls, setResourceMounted])

  const handlePreviewDraftStateChange = useCallback((pane: 'left' | 'right', hasDraft: boolean) => {
    const draftRef = pane === 'left' ? leftPreviewDraftRef : rightPreviewDraftRef
    draftRef.current = hasDraft
    if (hasDraft) {
      if (pane === 'right') {
        retainedRightTabRef.current = !useEditorStore.getState().rightPaneUserSelected
          ? useEditorStore.getState().tabs.find((tab) => tab.id === activeTabIdRef.current) ?? null
          : useEditorStore.getState().tabs.find((tab) => tab.id === useEditorStore.getState().rightPaneTabId) ?? null
      }
    } else {
      if (pane === 'right' && viewModeRef.current === 'dual-preview') {
        retainedRightTabRef.current = !useEditorStore.getState().rightPaneUserSelected
          ? useEditorStore.getState().tabs.find((tab) => tab.id === activeTabIdRef.current) ?? null
          : useEditorStore.getState().tabs.find((tab) => tab.id === useEditorStore.getState().rightPaneTabId) ?? null
      }
      setDraftDecisionVersion((version) => version + 1)
    }
  }, [])

  const handleLeftDraftStateChange = useCallback(
    (hasDraft: boolean) => handlePreviewDraftStateChange('left', hasDraft),
    [handlePreviewDraftStateChange],
  )
  const handleRightDraftStateChange = useCallback(
    (hasDraft: boolean) => handlePreviewDraftStateChange('right', hasDraft),
    [handlePreviewDraftStateChange],
  )

  // Visible, retained, and draft-blocked instances share the same policy decision.
  useEffect(() => {
    const now = Date.now()
    const previousVisibility = previousVisibilityRef.current
    if (previousVisibility.left && !leftPreviewVisible) lastInstanceUseRef.current['left-preview'] = now
    if (previousVisibility.right && viewMode !== 'dual-preview') lastInstanceUseRef.current['right-preview'] = now
    if (previousVisibility.editor && !editorVisible) lastInstanceUseRef.current.editor = now
    previousVisibilityRef.current = {
      editor: editorVisible,
      left: leftPreviewVisible,
      right: viewMode === 'dual-preview',
    }
    if (leftPreviewVisible) {
      clearTtl(leftPreviewTtlRef)
      lastInstanceUseRef.current['left-preview'] = now
      setResourceMounted('left-preview', true, activeTab?.id ?? null)
      forceDraftReleaseRef.current.left = false
    } else if (leftPreviewMountedRef.current) {
      if (forceDraftReleaseRef.current.left && !leftPreviewDraftRef.current) {
        forceDraftReleaseRef.current.left = false
        leftPreviewRenderRef.current = { content: '', filePath: undefined }
        setResourceMounted('left-preview', false)
      } else {
        scheduleRelease(leftPreviewTtlRef, 'left-preview', 'preview', instanceDocumentRef.current['left-preview'] ?? activeTab?.id ?? null, activeTab?.content.length ?? 0, () => {
          leftPreviewRenderRef.current = { content: '', filePath: undefined }
          setResourceMounted('left-preview', false)
        }, leftPreviewDraftRef)
      }
    }

    if (viewMode === 'dual-preview') {
      clearTtl(rightPreviewTtlRef)
      lastInstanceUseRef.current['right-preview'] = now
      setResourceMounted('right-preview', true, rightTab?.id ?? null)
      forceDraftReleaseRef.current.right = false
    } else if (rightPreviewMountedRef.current) {
      const retained = retainedRightTabRef.current
      if (forceDraftReleaseRef.current.right && !rightPreviewDraftRef.current) {
        forceDraftReleaseRef.current.right = false
        retainedRightTabRef.current = null
        setResourceMounted('right-preview', false)
      } else {
        scheduleRelease(rightPreviewTtlRef, 'right-preview', 'preview', retained?.id ?? null, retained?.content.length ?? 0, () => {
          retainedRightTabRef.current = null
          setResourceMounted('right-preview', false)
        }, rightPreviewDraftRef)
      }
    }

    if (editorVisible) {
      clearTtl(editorTtlRef)
      lastInstanceUseRef.current.editor = now
      setResourceMounted('editor', true, activeTab?.id ?? null)
    } else if (editorMountedRef.current) {
      instanceDocumentRef.current.editor = activeTab?.id ?? null
      scheduleRelease(editorTtlRef, 'editor', 'editor', instanceDocumentRef.current.editor, activeTab?.content.length ?? 0, () => {
          setResourceMounted('editor', false)
      })
    }

    if (viewMode === 'diff-preview') {
      if (diffReleaseFrameRef.current !== null) window.cancelAnimationFrame(diffReleaseFrameRef.current)
      diffReleaseFrameRef.current = null
      lastInstanceUseRef.current.diff = now
      setResourceMounted('diff', true, activeTab?.id ?? null)
    } else if (diffMountedRef.current) {
      setResourceMounted('diff', false)
    }
  }, [viewMode, modeResourcePolicy, leftPreviewVisible, editorVisible, activeTab?.id, draftDecisionVersion, editorMounted, leftPreviewMounted, rightPreviewMounted]) // eslint-disable-line react-hooks/exhaustive-deps

  // Emit first-visible events after DOM commit (requestAnimationFrame)
  const editorBecameVisibleRef = useRef(false)
  const markActiveDocumentFirstScreenReady = useCallback((documentId: string) => {
    if (activeTabIdRef.current !== documentId) return false
    if (firstScreenDocumentIdRef.current !== documentId) {
      firstScreenDocumentIdRef.current = documentId
      activeDocumentFirstScreenReadyRef.current = false
    }
    if (activeDocumentFirstScreenReadyRef.current) return true
    activeDocumentFirstScreenReadyRef.current = true
    setActiveDocumentFirstScreenReady(true)
    return true
  }, [])

  useEffect(() => {
    if (firstScreenDocumentIdRef.current === activeTabId) return
    firstScreenDocumentIdRef.current = activeTabId
    activeDocumentFirstScreenReadyRef.current = false
    editorBecameVisibleRef.current = false
    setActiveDocumentFirstScreenReady(false)
  }, [activeTabId])

  useEffect(() => {
    const contentReady = activeTab && (
      !activeTab.filePath || activeTab.modified || activeTab.content.length > 0 || hasBootSnapshotContent(activeTab)
    )
    if (editorVisible && editorMounted && !editorBecameVisibleRef.current && activeTab?.id && contentReady) {
      editorBecameVisibleRef.current = true
      const documentId = activeTab.id
      const raf = requestAnimationFrame(() => {
        if (!markActiveDocumentFirstScreenReady(documentId)) return
        markStartupPoint('active-document-first-visible', {
          surface: 'editor',
          charCount: activeTab.content.length,
        })
        markStartupPoint('editor-first-visible', {
          charCount: activeTab.content.length,
          mode: viewMode,
          policy: modePerformancePolicy,
        })
        if (import.meta.env.DEV) {
          eventMarker.mark('editor-first-visible', {
            charCount: activeTab.content.length,
            mode: viewMode,
            policy: modePerformancePolicy,
          })
        }
      })
      return () => cancelAnimationFrame(raf)
    }
    if (!editorVisible && !editorMounted) {
      editorBecameVisibleRef.current = false
    }
  }, [activeTab?.content.length, activeTab?.id, editorMounted, editorVisible, markActiveDocumentFirstScreenReady, modePerformancePolicy, viewMode])

  // Document switch: always release old document instances
  const prevActiveTabIdRef = useRef(activeTabId)
  useEffect(() => {
    const prev = prevActiveTabIdRef.current
    prevActiveTabIdRef.current = activeTabId
    if (prev && activeTabId && prev !== activeTabId) {
      // Cancel all TTLs before switching
      clearAllTtls()
      // Clear strong references
      if (!rightPreviewDraftRef.current) retainedRightTabRef.current = null
      leftPreviewRenderRef.current = { content: '', filePath: undefined }
      // Preserve restore marks for visible panes — the restore useLayoutEffect
      // already set them for the new tab, and clearing would cause
      // leftPreviewMasked to re-evaluate to true on the next render (if the
      // target tab has a saved non-zero scroll position) with no mechanism to
      // unmask, leaving the preview permanently blank.
      restoredPreviewKeysRef.current = {
        left: leftPreviewVisible ? restoredPreviewKeysRef.current.left : null,
        right: viewMode === 'dual-preview' ? restoredPreviewKeysRef.current.right : null,
      }
      setPrewarmedModeKeys({})
      warmedModeKeysRef.current.clear()
      // Re-mount visible instances for new doc
      setResourceMounted('editor', editorVisible, activeTabId)
      setResourceMounted('left-preview', leftPreviewVisible, activeTabId)
      if (!rightPreviewDraftRef.current) setResourceMounted('right-preview', viewMode === 'dual-preview', rightTab?.id ?? null)
    }
  }, [activeTabId, editorVisible, leftPreviewVisible, viewMode, clearAllTtls, rightTab?.id, setResourceMounted])

  const leftPreviewWorkEnabled = leftPreviewVisible || leftPreviewMounted
  const rightPreviewWorkEnabled = viewMode === 'dual-preview' || rightPreviewMounted
  const activePreview = useScheduledPreviewContent(activeTab?.content || '', activeTab?.id, leftPreviewWorkEnabled)
  const rightPreview = useScheduledPreviewContent(rightTab?.content || '', rightTab?.id, rightPreviewWorkEnabled)
  const leftPreviewRenderRef = useRef({
    content: activePreview.content,
    filePath: activeTab?.filePath,
  })
  if (leftPreviewWorkEnabled) {
    leftPreviewRenderRef.current = {
      content: activePreview.content,
      filePath: activeTab?.filePath,
    }
  }

  useEffect(() => {
    if (!leftPreviewMounted && !leftPreviewVisible) {
      leftPreviewRenderRef.current = { content: '', filePath: undefined }
    }
  }, [leftPreviewMounted, leftPreviewVisible])

  // 编辑模式的 TOC 直接从编辑器内容提取：预览实例未挂载（预热失败或尚未预热）时
  // activePreview.content 为空，若统一走预览管道会导致编辑模式目录永不出现。
  const editorToc = useMemo(() => extractToc(activeTab?.content || ''), [activeTab?.content])
  const previewToc = useMemo(() => extractToc(activePreview.content), [activePreview.content])
  const toc = viewMode === 'edit' ? editorToc : previewToc
  const rightToc = useMemo(() => extractToc(rightPreview.content), [rightPreview.content])
  const modeDerivationsEnabled = viewMode !== 'edit'
  const activeContentSignature = useMemo(
    () => modeDerivationsEnabled ? getContentSignature(activePreview.content) : 'edit',
    [activePreview.content, modeDerivationsEnabled]
  )
  const activeOriginalSignature = useMemo(
    () => modeDerivationsEnabled ? getContentSignature(activeTab?.originalContent || '') : 'edit',
    [activeTab?.originalContent, modeDerivationsEnabled]
  )
  const activeDiffLineCount = useMemo(
    () => modeDerivationsEnabled ? Math.max(
      countMarkdownLines(activeTab?.originalContent || ''),
      countMarkdownLines(activePreview.content)
    ) : 1,
    [activePreview.content, activeTab?.originalContent, modeDerivationsEnabled]
  )

  const getModeRenderKey = useCallback((mode: PrewarmTargetMode) => {
    if (!activeTab?.id) return null
    const base = `${activeTab.id}:${activeContentSignature}`
    return mode === 'diff-preview'
      ? `${mode}:${base}:${activeOriginalSignature}`
      : `${mode}:${base}`
  }, [activeContentSignature, activeOriginalSignature, activeTab?.id])

  const warmScope = modeDerivationsEnabled && activeTab?.id
    ? `${activeTab.id}:${activeContentSignature}:${activeOriginalSignature}`
    : null
  if (warmScopeRef.current !== warmScope) {
    warmScopeRef.current = warmScope
    warmedModeKeysRef.current.clear()
  }

  const rememberWarmMode = (mode: PrewarmTargetMode) => {
    const key = getModeRenderKey(mode)
    if (key) warmedModeKeysRef.current.add(key)
  }
  if (leftPreviewVisible) {
    rememberWarmMode('preview')
    if (viewMode === 'edit-preview') rememberWarmMode('edit-preview')
    if (viewMode === 'dual-preview') rememberWarmMode('dual-preview')
  }
  if (viewMode === 'diff-preview') {
    rememberWarmMode('diff-preview')
  }

  const updateEditorHeading = useCallback((view: EditorView) => {
    const line = getEditorTopLine(view)
    if (typeof line !== 'number') return
    const headingId = getHeadingIdAtLine(toc, line)
    setActiveEditorHeading((current) => current === headingId ? current : headingId)
  }, [toc])

  // 目录当前项按"滚动位置之前最后一个标题"计算：由预览实例的全文行号映射
  // （getLineForTop：模型 + 实测高度）驱动，不依赖标题 DOM 是否仍在虚拟窗口内，
  // 长章节中标题块卸载后目录项不再变空；左右预览各自绑定自身的 handle 与 toc。
  const resolveLeftActiveHeading = useCallback(({ scrollTop, viewportHeight }: ActiveHeadingGeometry): string | null => {
    const handle = leftMarkdownPreviewRef.current
    if (!handle) return null
    return resolveActiveHeadingByScroll(handle, previewToc, scrollTop, viewportHeight)
  }, [previewToc])

  const resolveRightActiveHeading = useCallback(({ scrollTop, viewportHeight }: ActiveHeadingGeometry): string | null => {
    const handle = rightMarkdownPreviewRef.current
    if (!handle) return null
    return resolveActiveHeadingByScroll(handle, rightToc, scrollTop, viewportHeight)
  }, [rightToc])

  const activeHeading = useActiveHeading(
    leftPreviewRef,
    resolveLeftActiveHeading,
    `${viewMode}:${activeTab?.id ?? ''}:${activePreview.version}`,
    leftPreviewVisible,
    SCROLL_SYNC_TOP_OFFSET,
  )
  const activeRightHeading = useActiveHeading(
    rightPreviewRef,
    resolveRightActiveHeading,
    `${viewMode}:${rightTab?.id ?? ''}:${rightPreview.version}`,
    viewMode === 'dual-preview',
    SCROLL_SYNC_TOP_OFFSET,
  )

  useEffect(() => {
    const handleActivity = () => cancelModePrewarm('user-activity')
    window.addEventListener('keydown', handleActivity, true)
    window.addEventListener('pointerdown', handleActivity, true)
    window.addEventListener('wheel', handleActivity, { capture: true, passive: true })
    window.addEventListener('scroll', handleActivity, { capture: true, passive: true })
    return () => {
      window.removeEventListener('keydown', handleActivity, true)
      window.removeEventListener('pointerdown', handleActivity, true)
      window.removeEventListener('wheel', handleActivity, { capture: true })
      window.removeEventListener('scroll', handleActivity, { capture: true })
    }
  }, [cancelModePrewarm])

  useEffect(() => {
    cancelModePrewarm('mode-change')
  }, [viewMode, cancelModePrewarm])

  useEffect(() => {
    if (modePrewarm === 'off') setPrewarmedModeKeys({})
  }, [modePrewarm])

  useEffect(() => {
    cancelModePrewarm('context-change')
    setPrewarmedModeKeys({})
  }, [activeTab?.id, activeTab?.content, activeTab?.originalContent, cancelModePrewarm, viewMode])

  useEffect(() => {
    const canPrewarm = modePrewarm !== 'off' && modeResourcePolicy !== 'memory'
    if (!activeTab?.id || !canPrewarm) return
    if (!activeDocumentFirstScreenReadyRef.current || !activeDocumentFirstScreenReady) return
    if (activePreview.pending || rightPreview.pending) return

    const target = getNextPrewarmTarget({
      activeMode: viewMode,
      contentLength: activeTab.content.length,
      diffLineCount: activeDiffLineCount,
      level: modePrewarm,
      resolveKey: getModeRenderKey,
      warmedKeys: new Set([
        ...warmedModeKeysRef.current,
        ...Object.values(prewarmedModeKeysRef.current).filter((key): key is string => Boolean(key)),
      ]),
      usage: viewModeUsage,
    })
    if (!target) return

    cancelPendingPrewarm('schedule-replaced')
    const scheduleId = `prewarm-${++prewarmScheduleSequenceRef.current}`
    pendingPrewarmRef.current = { scheduleId, target }
    const token = prewarmCancelRef.current
    const timer = window.setTimeout(() => {
      const idleSince = Date.now() - lastUserActivityAtRef.current
      if (prewarmCancelRef.current !== token || idleSince < MODE_PREWARM_ACTIVITY_PAUSE) return
      // Cancel previous idle callback before scheduling new one
      if (idlePrewarmCancelRef.current) {
        idlePrewarmCancelRef.current()
        idlePrewarmCancelRef.current = null
      }
      idlePrewarmCancelRef.current = scheduleIdlePrewarm(() => {
        idlePrewarmCancelRef.current = null
        if (prewarmCancelRef.current !== token) return
        const key = getModeRenderKey(target)
        if (!key) return
        if (pendingPrewarmRef.current?.scheduleId === scheduleId) {
          pendingPrewarmRef.current = null
        }
        requestedPrewarmScheduleIdsRef.current[target] = scheduleId
        setPrewarmedModeKeys((current) => (
          current[target] === key
            ? current
            : { ...current, [target]: key }
        ))
      })
    }, Math.max(MODE_PREWARM_IDLE_DELAY, MODE_PREWARM_ACTIVITY_PAUSE))

    if (import.meta.env.DEV) {
      eventMarker.mark('prewarm-schedule', {
        target,
        scheduleId,
        delayMs: Math.max(MODE_PREWARM_IDLE_DELAY, MODE_PREWARM_ACTIVITY_PAUSE),
      })
    }

    return () => window.clearTimeout(timer)
  }, [
    activeDiffLineCount,
    activeDocumentFirstScreenReady,
    activePreview.pending,
    activeTab?.content.length,
    activeTab?.id,
    getModeRenderKey,
    modePrewarm,
    modeResourcePolicy,
    cancelPendingPrewarm,
    prewarmedModeKeys,
    rightPreview.pending,
    viewMode,
    viewModeUsage,
  ])

  useEffect(() => {
    const canPrewarm = modePrewarm !== 'off' && modeResourcePolicy !== 'memory'
    if (!activeTab?.id || !canPrewarm) return
    if (!activeDocumentFirstScreenReadyRef.current || !activeDocumentFirstScreenReady) return
    const requestedModes = Object.keys(prewarmedModeKeys) as PrewarmTargetMode[]
    if (requestedModes.length === 0) return
    const now = Date.now()
    const wantsLeft = requestedModes.some((mode) => mode === 'preview' || mode === 'edit-preview' || mode === 'dual-preview')
    const wantsEditor = requestedModes.includes('edit-preview')
    const wantsRight = requestedModes.includes('dual-preview')
    const wantsDiff = requestedModes.includes('diff-preview')

    if (wantsLeft && !leftPreviewVisible && !leftPreviewMountedRef.current) {
      lastInstanceUseRef.current['left-preview'] = now
      setResourceMounted('left-preview', true, activeTab.id)
      const target = requestedModes.find((mode) => mode === 'preview' || mode === 'edit-preview' || mode === 'dual-preview')
      if (import.meta.env.DEV) {
        eventMarker.mark('prewarm-create', {
          resource: 'left-preview',
          target: target ?? null,
          scheduleId: target ? requestedPrewarmScheduleIdsRef.current[target] ?? null : null,
          phase: 'requested',
        })
      }
    }

    if (wantsEditor && !editorVisible && !editorMountedRef.current) {
      lastInstanceUseRef.current.editor = now
      setResourceMounted('editor', true, activeTab.id)
      if (import.meta.env.DEV) {
        eventMarker.mark('prewarm-create', {
          resource: 'editor',
          target: 'edit-preview',
          scheduleId: requestedPrewarmScheduleIdsRef.current['edit-preview'] ?? null,
          phase: 'requested',
        })
      }
    }

    if (wantsRight && viewMode !== 'dual-preview' && !rightPreviewMountedRef.current) {
      const candidate = dualRightTab ?? activeTab
      retainedRightTabRef.current = candidate
      lastInstanceUseRef.current['right-preview'] = now
      setResourceMounted('right-preview', true, candidate.id)
      if (import.meta.env.DEV) {
        eventMarker.mark('prewarm-create', {
          resource: 'right-preview',
          target: 'dual-preview',
          scheduleId: requestedPrewarmScheduleIdsRef.current['dual-preview'] ?? null,
          phase: 'requested',
        })
      }
    }

    if (wantsDiff && viewMode !== 'diff-preview' && !diffMountedRef.current) {
      lastInstanceUseRef.current.diff = now
      setResourceMounted('diff', true, activeTab.id)
      if (import.meta.env.DEV) {
        eventMarker.mark('prewarm-create', {
          resource: 'diff',
          target: 'diff-preview',
          scheduleId: requestedPrewarmScheduleIdsRef.current['diff-preview'] ?? null,
          phase: 'requested',
        })
      }
      const decision = decideHiddenResource('diff', 'diff', activeTab.id, activeTab.content.length)
      if (decision.action !== 'release') return
      if (diffReleaseFrameRef.current !== null) window.cancelAnimationFrame(diffReleaseFrameRef.current)
      diffReleaseFrameRef.current = window.requestAnimationFrame(() => {
        diffReleaseFrameRef.current = null
        if (viewModeRef.current === 'diff-preview' || instanceDocumentRef.current.diff !== activeTab.id) return
        setResourceMounted('diff', false)
      })
    }
  }, [activeDocumentFirstScreenReady, activeTab?.id, modePrewarm, prewarmedModeKeys, decideHiddenResource, setResourceMounted]) // eslint-disable-line react-hooks/exhaustive-deps

  const getStoredPreviewTop = useCallback((tabId: string | null | undefined, pane: 'left' | 'right' = 'left') => {
    if (!tabId) return 0
    const position = useEditorStore.getState().viewMode === 'dual-preview'
      ? readingPositionsRef.current.getForPane(tabId, pane)
      : readingPositionsRef.current.get(tabId)
    return position?.previewScrollTop ?? 0
  }, [])

  const getStoredEditorTop = useCallback((tabId: string | null | undefined) => {
    if (!tabId) return 0
    return readingPositionsRef.current.get(tabId)?.editorScrollTop ?? 0
  }, [])

  const leftPreviewMasked = Boolean(
    activeTab?.id
    && (
      previewSwitchingTabId === activeTab.id
      || (
        restoredPreviewKeysRef.current.left !== activeTab.id
        && getStoredPreviewTop(activeTab.id) > 0
      )
    )
  )

  const rightPreviewMasked = Boolean(
    rightTab?.id
    && restoredPreviewKeysRef.current.right !== rightTab.id
    && getStoredPreviewTop(rightTab.id, 'right') > 0
  )

  const saveEditorPositionForTab = useCallback((tabId: string | null | undefined, view = editorViewRef.current) => {
    if (!tabId || !view) return
    const mainIndex = view.state.selection.ranges.indexOf(view.state.selection.main)
    const ranges = view.state.selection.ranges.map((r) => ({
      anchor: r.anchor,
      head: r.head,
    }))
    readingPositionsRef.current.save(tabId, {
      editorScrollTop: view.scrollDOM.scrollTop,
      topLine: getEditorTopLine(view),
      cursor: view.state.selection.main.head,
      selection: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
      ranges: ranges.length > 1 ? ranges : undefined,
      mainIndex: ranges.length > 1 ? mainIndex : undefined,
    })
  }, [])

  const savePreviewReadingPosition = useCallback((
    tabId: string,
    container: HTMLElement | null,
    previewHandle: MarkdownPreviewHandle | null,
    pane: 'left' | 'right' = 'left'
  ) => {
    if (isRestoringScrollRef.current) return
    if (!container) return
    const position = {
      previewScrollTop: container.scrollTop,
      topLine: previewHandle?.getLineForTop(container.scrollTop + SCROLL_SYNC_TOP_OFFSET),
    }
    if (viewModeRef.current === 'dual-preview') {
      readingPositionsRef.current.saveForPane(tabId, pane, position)
    } else {
      readingPositionsRef.current.save(tabId, position)
    }
  }, [])

  const withRestoreLock = useCallback((restore: () => void) => {
    isRestoringScrollRef.current = true
    restore()
    if (restoreScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreScrollFrameRef.current)
    }
    restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
      isRestoringScrollRef.current = false
      restoreScrollFrameRef.current = null
    })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (isRestoringScrollRef.current) return
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      if (isRestoringScrollRef.current) return
      const positions = readingPositionsRef.current
      // 从 ReadingPositionSession 提取所有位置
      const all: Record<string, ReadingPosition> = {}
      const activeId = activeTab?.id
      if (activeId) {
        const editorPos = positions.get(activeId)
        if (editorPos) all[activeId] = editorPos
        const leftPos = positions.getForPane(activeId, 'left')
        if (leftPos) all[`${activeId}:left`] = leftPos
        const rightPos = positions.getForPane(activeId, 'right')
        if (rightPos) all[`${activeId}:right`] = rightPos
      }
      if (Object.keys(all).length > 0) {
        flushReadingPositions(all)
      }
    }, 500)
  }, [activeTab?.id, flushReadingPositions])

  const schedulePreviewReveal = useCallback((tabId?: string) => {
    if (tabId) { clearPreviewSwitching(tabId) }
    setPreviewRestoreTick((tick) => tick + 1)
  }, [clearPreviewSwitching])

  const restoreEditorReadingPosition = useCallback((tabId: string) => {
    const view = editorViewRef.current
    const position = readingPositionsRef.current.get(tabId)
    if (!view || !position) return

    if (editorRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(editorRestoreFrameRef.current)
    }
    editorRestoreFrameRef.current = window.requestAnimationFrame(() => {
      editorRestoreFrameRef.current = null
      const currentMode = useEditorStore.getState().viewMode
      if (editorViewRef.current !== view || (currentMode !== 'edit' && currentMode !== 'edit-preview')) return
      // 优先使用 editorScrollTop 直接恢复，比 topLine + scrollIntoView 更精确
      if (typeof position.editorScrollTop === 'number') {
        view.scrollDOM.scrollTop = position.editorScrollTop
      } else if (typeof position.topLine === 'number' && position.topLine <= view.state.doc.lines) {
        const pos = view.state.doc.line(position.topLine).from
        view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(pos).top - SCROLL_SYNC_TOP_OFFSET)
      }
    })
  }, [])

  const restorePreviewReadingPosition = useCallback((
    tabId: string,
    container: HTMLElement | null,
    pane: 'left' | 'right'
  ) => {
    const position = useEditorStore.getState().viewMode === 'dual-preview'
      ? readingPositionsRef.current.getForPane(tabId, pane)
      : readingPositionsRef.current.get(tabId)
    if (!container) return
    const previewHandle = pane === 'left' ? leftMarkdownPreviewRef.current : rightMarkdownPreviewRef.current
    const lineTop = position?.previewScrollTop == null && position?.topLine != null
      ? getPreviewTopForLine(container, position.topLine, previewHandle?.getTopForLine(position.topLine))
      : undefined
    const nextTop = position?.previewScrollTop
      ?? (typeof lineTop === 'number' ? Math.max(0, lineTop - SCROLL_SYNC_TOP_OFFSET) : 0)
    withRestoreLock(() => {
      container.scrollTop = nextTop
    })
    restoredPreviewKeysRef.current[pane] = tabId
    schedulePreviewReveal(tabId)
  }, [schedulePreviewReveal, withRestoreLock])

  useEffect(() => {
    if (!activeTab?.id || (viewMode !== 'edit' && viewMode !== 'edit-preview')) return
    let view: EditorView | null = null
    const handleScroll = () => {
      const currentMode = useEditorStore.getState().viewMode
      if (currentMode !== 'edit' && currentMode !== 'edit-preview') return
      if (scrollSyncSessionRef.current.source !== 'preview') {
        saveEditorPositionForTab(activeTab.id)
        scheduleFlush()
        setTocFocus('editor')
      }
      if (editorTocFrameRef.current !== null || !view) return
      editorTocFrameRef.current = window.requestAnimationFrame(() => {
        editorTocFrameRef.current = null
        if (view) updateEditorHeading(view)
      })
    }
    let frame = window.requestAnimationFrame(() => {
      view = editorViewRef.current
      if (!view) return
      updateEditorHeading(view)
      view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true })
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (view) {
        view.scrollDOM.removeEventListener('scroll', handleScroll)
      }
      if (editorTocFrameRef.current !== null) {
        window.cancelAnimationFrame(editorTocFrameRef.current)
        editorTocFrameRef.current = null
      }
    }
  }, [activeTab?.id, saveEditorPositionForTab, scheduleFlush, updateEditorHeading, viewMode])

  // 预览内容更新（版本变化）只恢复预览自身位置，保证右侧渲染稳定；
  // 绝不在内容更新时反向恢复编辑器位置——否则右侧渲染会把左侧视口拉走
  // （编辑左侧时每次预览刷新都可能导致左侧跳动）。
  useLayoutEffect(() => {
    if (!activeTab?.id) return
    const restoreStartedAt = import.meta.env.DEV ? performance.now() : 0
    if (viewMode === 'preview' || viewMode === 'edit-preview' || viewMode === 'dual-preview') {
      restorePreviewReadingPosition(activeTab.id, leftPreviewRef.current, 'left')
    }
    if (viewMode === 'dual-preview' && rightTab?.id) {
      restorePreviewReadingPosition(rightTab.id, rightPreviewRef.current, 'right')
    }
    if (leftPreviewVisible) {
      reportPreviewSwitchPerformance(activeTab.id, restoreStartedAt)
    }
  }, [
    activePreview.version,
    activeTab?.id,
    restorePreviewReadingPosition,
    rightPreview.version,
    rightTab?.id,
    viewMode,
  ])

  // 编辑器阅读位置只在模式切换 / 标签页切换（进入编辑器或换文档）时恢复，
  // 不随预览内容版本变化重放：编辑过程中右侧渲染不得影响左侧位置。
  useLayoutEffect(() => {
    if (!activeTab?.id) return
    if (viewMode !== 'edit' && viewMode !== 'edit-preview') return
    restoreEditorReadingPosition(activeTab.id)
  }, [activeTab?.id, restoreEditorReadingPosition, viewMode])

  // 切换标签页时立即 flush 上一个标签页的位置
  useEffect(() => {
    const prevId = previousActiveTabIdRef.current
    previousActiveTabIdRef.current = activeTabId ?? null
    if (!prevId || prevId === activeTabId) return
    // 取消 debounce，立即 flush
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const positions = readingPositionsRef.current
    const all: Record<string, ReadingPosition> = {}
    const editorPos = positions.get(prevId)
    if (editorPos) all[prevId] = editorPos
    const leftPos = positions.getForPane(prevId, 'left')
    if (leftPos) all[`${prevId}:left`] = leftPos
    const rightPos = positions.getForPane(prevId, 'right')
    if (rightPos) all[`${prevId}:right`] = rightPos
    if (Object.keys(all).length > 0) {
      flushReadingPositions(all)
    }
  }, [activeTabId, flushReadingPositions])

  // 退出/隐藏时 flush 所有位置
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      const positions = readingPositionsRef.current
      const all: Record<string, ReadingPosition> = {}
      const activeId = activeTab?.id
      if (activeId) {
        const editorPos = positions.get(activeId)
        if (editorPos) all[activeId] = editorPos
        const leftPos = positions.getForPane(activeId, 'left')
        if (leftPos) all[`${activeId}:left`] = leftPos
        const rightPos = positions.getForPane(activeId, 'right')
        if (rightPos) all[`${activeId}:right`] = rightPos
      }
      if (Object.keys(all).length > 0) {
        flushReadingPositions(all)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleBeforeUnload()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [activeTab?.id, flushReadingPositions])

  const clearPreviewContextHighlight = useCallback(() => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete(PREVIEW_CONTEXT_HIGHLIGHT)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.altKey) {
        setSearchOpen(true)
      }
    }
    const openSearch = () => setSearchOpen(true)
    window.addEventListener('keydown', handler, true)
    window.addEventListener(OPEN_EDITOR_SEARCH_EVENT, openSearch)
    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener(OPEN_EDITOR_SEARCH_EVENT, openSearch)
    }
  }, [])

  // Ctrl + 滚轮快捷调节字号
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const delta = e.deltaY < 0 ? 1 : -1
      const current = useSettingsStore.getState().editor.fontSize
      const next = Math.max(10, Math.min(24, current + delta))
      if (next !== current) {
        useSettingsStore.getState().updateEditorSettings({ fontSize: next })
      }
    }
    window.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', handler, { capture: true })
  }, [])

  useEffect(() => clearPreviewContextHighlight, [clearPreviewContextHighlight])

  /** 取消正在写编辑器 scrollTop 的 follower（预览滚动驱动方向） */
  const cancelEditorFollower = useCallback(() => {
    const f = editorFollowerRef.current
    if (f.frameId !== null) {
      window.cancelAnimationFrame(f.frameId)
      f.frameId = null
    }
    f.active = false
    f.pos = null
    f.lastTarget = null
    f.stableFrames = 0
  }, [])

  /** 取消正在写预览 scrollTop 的 follower（编辑器滚动驱动方向） */
  const cancelPreviewFollower = useCallback(() => {
    const f = previewFollowerRef.current
    if (f.frameId !== null) {
      window.cancelAnimationFrame(f.frameId)
      f.frameId = null
    }
    f.active = false
    f.target = null
    f.lastTarget = null
    f.stableFrames = 0
  }, [])

  const cancelEditorHeadingJump = useCallback(() => {
    const cancel = editorHeadingJumpCancelRef.current
    editorHeadingJumpCancelRef.current = null
    cancel?.()
  }, [])

  useEffect(() => () => {
    scrollSyncSessionRef.current.dispose()
    clearAllTtls()
    cancelEditorFollower()
    cancelPreviewFollower()
    cancelEditorHeadingJump()
    scrollFollowerGenerationRef.current += 1
    if (idlePrewarmCancelRef.current) {
      idlePrewarmCancelRef.current()
      idlePrewarmCancelRef.current = null
    }
    if (diffReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(diffReleaseFrameRef.current)
      diffReleaseFrameRef.current = null
    }
    if (restoreScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreScrollFrameRef.current)
      restoreScrollFrameRef.current = null
    }
    if (editorRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(editorRestoreFrameRef.current)
      editorRestoreFrameRef.current = null
    }
    if (editorScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(editorScrollFrameRef.current)
      editorScrollFrameRef.current = null
    }
    if (previewScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(previewScrollFrameRef.current)
      previewScrollFrameRef.current = null
    }
    if (editorTocFrameRef.current !== null) {
      window.cancelAnimationFrame(editorTocFrameRef.current)
      editorTocFrameRef.current = null
    }
    retainedRightTabRef.current = null
    leftPreviewRenderRef.current = { content: '', filePath: undefined }
    instanceDocumentRef.current = {}
    prewarmedModeKeysRef.current = {}
    warmedModeKeysRef.current.clear()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditorChange = useCallback(
    (content: string) => {
      lastEditorInputAtRef.current = Date.now()
      if (activeTabId) updateTabContent(activeTabId, content)
    },
    [activeTabId, updateTabContent]
  )

  const setScrollSyncSource = useCallback((source: 'editor' | 'preview') => {
    scrollSyncSessionRef.current.lock(source)
  }, [])

  // ---- 同步滚动平滑跟随（rAF lerp follower）----
  // 只把被动方从瞬时跳转改为平滑跟随；映射计算、方向判断、手势守卫、
  // 输入暂停、restore 隔离与阅读位置逻辑全部保持原语义。
  // 不使用 scrollTo({ behavior: 'smooth' })：同步目标约 60Hz 更新，
  // 浏览器 smooth 每次都会重新启动并互相打断。

  /** 编辑器被动动画帧：预览滚动驱动编辑器平滑逼近目标行 */
  const stepEditorFollower = useCallback((now: number) => {
    const f = editorFollowerRef.current
    f.frameId = null
    if (!f.active || f.pos === null) return
    const view = f.view
    const pos = f.pos
    if (!view || editorViewRef.current !== view
      || f.generation !== scrollFollowerGenerationRef.current
      || pos > view.state.doc.length) {
      cancelEditorFollower()
      return
    }

    // 每帧续锁原始 source：动画写编辑器产生的 scroll 事件不得反向同步预览
    setScrollSyncSource('preview')

    // 动态目标：长行、表格未进入视口时 lineBlockAt 可能是估算值，逐帧重读。
    // 写入前把目标限制在合法滚动范围（0 ... scrollHeight - clientHeight），
    // 与原生 scrollTo 的夹取行为等价，保证文档底部/顶部也能收敛。
    const scrollDOM = view.scrollDOM
    const editorMaxTop = Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight)
    const target = Math.min(
      Math.max(0, view.lineBlockAt(pos).top - SCROLL_SYNC_TOP_OFFSET),
      editorMaxTop,
    )

    const actualTop = scrollDOM.scrollTop
    // CodeMirror 自己的测量校正也可能修改编辑器 scrollTop：吸收为新的 current
    // 继续收敛，不视为取消；用户接管通过明确的 wheel / pointer 事件取消。
    const current = f.lastWrite === null || Math.abs(actualTop - f.lastWrite) > SCROLL_SYNC_EXTERNAL_DRIFT_PX
      ? actualTop
      : f.lastWrite

    const dt = f.lastTime === null ? 16 : Math.min(now - f.lastTime, SCROLL_SYNC_FOLLOW_MAX_DT_MS)
    f.lastTime = now
    const alpha = 1 - Math.exp(-dt / SCROLL_SYNC_FOLLOW_TAU_MS)
    const next = current + (target - current) * alpha

    scrollDOM.scrollTop = Math.max(0, Math.min(next, editorMaxTop))
    f.lastWrite = scrollDOM.scrollTop

    const settled = Math.abs(target - f.lastWrite) < SCROLL_SYNC_FOLLOW_EPSILON_PX
    const targetStable = f.lastTarget !== null && Math.abs(target - f.lastTarget) < SCROLL_SYNC_FOLLOW_EPSILON_PX
    f.lastTarget = target
    f.stableFrames = settled && targetStable ? f.stableFrames + 1 : 0

    if (f.stableFrames >= SCROLL_SYNC_FOLLOW_STABLE_FRAMES) {
      // 收敛后仅执行一次 CodeMirror 精确测量校正（不能在连续同步事件中反复调用）。
      // 到达这里时已确认：仍是同一个 EditorView、同一同步 effect 生命周期（generation）、
      // 动画未被用户取消（active）、当前 pos 未被后续 retarget 替换（retarget 会重置 stableFrames）。
      f.active = false
      f.pos = null
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: SCROLL_SYNC_TOP_OFFSET }),
      })
      return
    }

    f.frameId = window.requestAnimationFrame(stepEditorFollower)
  }, [cancelEditorFollower, setScrollSyncSource])

  /** 预览被动动画帧：编辑器滚动驱动预览平滑逼近静态目标 */
  const stepPreviewFollower = useCallback((now: number) => {
    const f = previewFollowerRef.current
    f.frameId = null
    if (!f.active || f.target === null) return
    const container = f.container
    if (!container || leftPreviewRef.current !== container
      || f.generation !== scrollFollowerGenerationRef.current) {
      cancelPreviewFollower()
      return
    }

    // 每帧续锁原始 source：动画写预览产生的 scroll 事件不得反向同步编辑器
    setScrollSyncSource('editor')

    // 写入前把目标限制在合法滚动范围（0 ... scrollHeight - clientHeight）；
    // 预览虚拟化下容器几何逐帧变化，需每帧重取
    const previewMaxTop = Math.max(0, container.scrollHeight - container.clientHeight)
    const target = Math.min(f.target, previewMaxTop)
    if (f.lastWrite !== null && Math.abs(container.scrollTop - f.lastWrite) > SCROLL_SYNC_EXTERNAL_DRIFT_PX) {
      // 预览虚拟化、图片、KaTeX 等渲染补偿修改了 scrollTop：停止预览 follower，
      // 让外部补偿或用户操作接管
      cancelPreviewFollower()
      return
    }
    const current = f.lastWrite ?? container.scrollTop

    const dt = f.lastTime === null ? 16 : Math.min(now - f.lastTime, SCROLL_SYNC_FOLLOW_MAX_DT_MS)
    f.lastTime = now
    const alpha = 1 - Math.exp(-dt / SCROLL_SYNC_FOLLOW_TAU_MS)
    const next = current + (target - current) * alpha

    container.scrollTop = Math.max(0, Math.min(next, previewMaxTop))
    f.lastWrite = container.scrollTop

    const settled = Math.abs(target - f.lastWrite) < SCROLL_SYNC_FOLLOW_EPSILON_PX
    const targetStable = f.lastTarget !== null && Math.abs(target - f.lastTarget) < SCROLL_SYNC_FOLLOW_EPSILON_PX
    f.lastTarget = target
    f.stableFrames = settled && targetStable ? f.stableFrames + 1 : 0

    if (f.stableFrames >= SCROLL_SYNC_FOLLOW_STABLE_FRAMES) {
      f.active = false
      f.target = null
      return
    }

    f.frameId = window.requestAnimationFrame(stepPreviewFollower)
  }, [cancelPreviewFollower, setScrollSyncSource])

  const startEditorFollower = useCallback((view: EditorView, pos: number) => {
    const f = editorFollowerRef.current
    f.pos = pos
    f.stableFrames = 0
    if (f.active && f.frameId !== null) {
      // 连续同步事件只更新目标，不取消并重新启动 rAF
      f.view = view
      return
    }
    f.active = true
    f.view = view
    f.lastWrite = view.scrollDOM.scrollTop
    f.lastTime = null
    f.lastTarget = null
    if (f.frameId !== null) window.cancelAnimationFrame(f.frameId)
    f.frameId = window.requestAnimationFrame(stepEditorFollower)
  }, [stepEditorFollower])

  const startPreviewFollower = useCallback((container: HTMLElement, target: number) => {
    const f = previewFollowerRef.current
    f.target = target
    f.stableFrames = 0
    if (f.active && f.frameId !== null) {
      f.container = container
      return
    }
    f.active = true
    f.container = container
    f.lastWrite = container.scrollTop
    f.lastTime = null
    f.lastTarget = null
    if (f.frameId !== null) window.cancelAnimationFrame(f.frameId)
    f.frameId = window.requestAnimationFrame(stepPreviewFollower)
  }, [stepPreviewFollower])

  const syncPreviewToEditorLine = useCallback((line: number) => {
    const container = leftPreviewRef.current
    if (!container) return

    const targetTop = getPreviewTopForLine(container, line, leftMarkdownPreviewRef.current?.getTopForLine(line))
    if (typeof targetTop !== 'number') return

    setScrollSyncSource('editor')
    // 映射计算保持不变：只把瞬时写入改成更新预览 follower 的静态目标
    startPreviewFollower(container, Math.max(0, targetTop - SCROLL_SYNC_TOP_OFFSET))
  }, [activePreview.version, setScrollSyncSource, startPreviewFollower])

  const syncEditorToPreviewLine = useCallback((line: number) => {
    const view = editorViewRef.current
    if (!view || line < 1 || line > view.state.doc.lines) return

    const pos = view.state.doc.line(line).from
    setScrollSyncSource('preview')
    // 长行、表格等内容尚未进入视口时，CodeMirror 的高度映射可能仍是估算值。
    // 动画期间每帧动态读取 lineBlockAt(pos).top 平滑逼近，收敛后仅执行一次
    // scrollIntoView 精确测量校正，避免把瞬时估算固化为 scrollTop。
    startEditorFollower(view, pos)
  }, [setScrollSyncSource, startEditorFollower])

  useEffect(() => {
    if (viewMode !== 'edit-preview' || !syncScroll) return
    const view = editorViewRef.current
    const preview = leftPreviewRef.current
    if (!view || !preview) return

    // 新生命周期代数：上一个生命周期的 follower 帧即使漏取消也会在下一帧自杀
    const generation = ++scrollFollowerGenerationRef.current
    editorFollowerRef.current.generation = generation
    previewFollowerRef.current.generation = generation

    const handleEditorScroll = () => {
      if (scrollSyncSessionRef.current.source === 'preview') return
      if (editorScrollFrameRef.current !== null) return
      editorScrollFrameRef.current = window.requestAnimationFrame(() => {
        editorScrollFrameRef.current = null
        const line = getEditorTopLine(view)
        if (typeof line === 'number') {
          syncPreviewToEditorLine(line)
        }
      })
    }

    const handlePreviewScroll = () => {
      if (isRestoringScrollRef.current) return
      // 反向同步只接受用户主动滚动预览（滚轮 / 按住拖拽滚动条 / 触控）产生的
      // scroll 事件；渲染补偿（内容更新锚点补偿、scrollTop 夹取、预览位置恢复、
      // 异步图片/KaTeX 高度变化）产生的 scroll 事件一律不得反向移动编辑器。
      if (!previewPointerDownRef.current
        && Date.now() - previewGestureAtRef.current > PREVIEW_SYNC_GESTURE_WINDOW_MS) return
      if (scrollSyncSessionRef.current.source === 'editor') return
      if (Date.now() - lastEditorInputAtRef.current < SCROLL_SYNC_INPUT_PAUSE_MS) return
      if (previewScrollFrameRef.current !== null) return
      previewScrollFrameRef.current = window.requestAnimationFrame(() => {
        previewScrollFrameRef.current = null
        const line = leftMarkdownPreviewRef.current?.getLineForTop(
          preview.scrollTop + SCROLL_SYNC_TOP_OFFSET,
        )
        if (typeof line === 'number') {
          syncEditorToPreviewLine(line)
        }
      })
    }

    const handleEditorWheel = () => {
      // 用户接管被动面：立即取消正在写编辑器 scrollTop 的动画，最迟下一帧让路
      cancelEditorFollower()
      setScrollSyncSource('editor')
    }
    const handlePreviewWheel = () => {
      cancelPreviewFollower()
      previewGestureAtRef.current = Date.now()
      setScrollSyncSource('preview')
    }
    const handleEditorPointerDown = () => {
      // 仅用于取消编辑器 follower（覆盖拖动编辑器滚动条）
      cancelEditorFollower()
    }
    const handlePreviewPointerDown = () => {
      cancelPreviewFollower()
      previewPointerDownRef.current = true
      previewGestureAtRef.current = Date.now()
    }
    const handlePreviewPointerUp = () => {
      previewPointerDownRef.current = false
    }

    view.scrollDOM.addEventListener('scroll', handleEditorScroll, { passive: true })
    preview.addEventListener('scroll', handlePreviewScroll, { passive: true })
    view.scrollDOM.addEventListener('wheel', handleEditorWheel, { passive: true })
    preview.addEventListener('wheel', handlePreviewWheel, { passive: true })
    view.scrollDOM.addEventListener('pointerdown', handleEditorPointerDown, { passive: true })
    preview.addEventListener('pointerdown', handlePreviewPointerDown, { passive: true })
    window.addEventListener('pointerup', handlePreviewPointerUp, true)
    window.addEventListener('pointercancel', handlePreviewPointerUp, true)

    return () => {
      view.scrollDOM.removeEventListener('scroll', handleEditorScroll)
      preview.removeEventListener('scroll', handlePreviewScroll)
      view.scrollDOM.removeEventListener('wheel', handleEditorWheel)
      preview.removeEventListener('wheel', handlePreviewWheel)
      view.scrollDOM.removeEventListener('pointerdown', handleEditorPointerDown)
      preview.removeEventListener('pointerdown', handlePreviewPointerDown)
      window.removeEventListener('pointerup', handlePreviewPointerUp, true)
      window.removeEventListener('pointercancel', handlePreviewPointerUp, true)
      cancelEditorFollower()
      cancelPreviewFollower()
      scrollFollowerGenerationRef.current += 1
      if (editorScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(editorScrollFrameRef.current)
        editorScrollFrameRef.current = null
      }
      if (previewScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(previewScrollFrameRef.current)
        previewScrollFrameRef.current = null
      }
    }
  }, [activeTab?.id, activePreview.version, cancelEditorFollower, cancelPreviewFollower, setScrollSyncSource, syncEditorToPreviewLine, syncPreviewToEditorLine, syncScroll, viewMode])

  const handleSave = useCallback(async () => {
    const state = useEditorStore.getState()
    const tab = state.tabs.find((item) => item.id === state.activeTabId)
    if (!tab) return
    try {
      if (tab.filePath) {
        await saveFile(tab.filePath, tab.content)
        scheduleMarkdownDocumentIndex(tab.filePath, tab.title, tab.content)
        useEditorStore.getState().markTabSaved(tab.id, tab.content)
        toast.success('已保存')
      } else {
        const result = await saveFileAs(tab.content)
        if (result) {
          scheduleMarkdownDocumentIndex(result.path, result.name, result.content)
          useEditorStore.getState().saveTabAs(tab.id, result.path, result.name, result.content)
          toast.success('已保存')
        }
      }
    } catch (err) {
      console.error('Save failed:', err)
      toast.error(describeFileOperationError(err, '保存失败'))
    }
  }, [])

  const persistTabContent = useCallback(async (tabId: string, nextContent: string) => {
    const targetTab = useEditorStore.getState().tabs.find((tab) => tab.id === tabId)
    if (!targetTab) return

    updateTabContent(tabId, nextContent)

    if (!targetTab.filePath) return

    try {
      await saveFile(targetTab.filePath, nextContent)
      scheduleMarkdownDocumentIndex(targetTab.filePath, targetTab.title, nextContent)
      useEditorStore.getState().replaceTabContentWithSaved(tabId, nextContent)
    } catch (err) {
      console.error('Auto-save markdown task failed:', err)
      toast.error(describeFileOperationError(err, '任务勾选保存失败'))
    }
  }, [updateTabContent])

  const handleTaskToggle = useCallback(async (tabId: string, content: string, line: number, checked: boolean) => {
    const nextContent = toggleMarkdownTaskAtLine(content, line, checked)
    if (!nextContent || nextContent === content) return
    await persistTabContent(tabId, nextContent)
  }, [persistTabContent])

  const handleActiveTaskToggle = useCallback((line: number, checked: boolean) => {
    const state = useEditorStore.getState()
    if (!state.activeTabId) return
    const tab = state.tabs.find((item) => item.id === state.activeTabId)
    if (tab) void handleTaskToggle(tab.id, tab.content, line, checked)
  }, [handleTaskToggle])

  const handlePreviewBlockCommit = useCallback(async (request: MarkdownBlockCommitRequest) => {
    const tab = useEditorStore.getState().tabs.find((item) => item.id === request.documentKey)
    if (!tab) {
      toast.warning('文档已关闭，块修改未写入；可复制修改内容后重新打开文档。')
      return { status: 'conflict' as const, currentSource: '' }
    }
    // 动态导入：markdownBlocks 仅在块提交时需要，避免进入入口 chunk（阶段 4 定位重构后 bundle budget）
    const { replaceMarkdownBlock } = await import('@/services/markdownBlocks')
    const result = await replaceMarkdownBlock(tab.content, request.block, request.draft)
    if (result.status === 'conflict') {
      toast.warning('该 Markdown 块已被其他操作修改，当前草稿未覆盖原文。')
      return result
    }
    if (result.content !== tab.content) updateTabContent(tab.id, result.content)
    return { status: 'applied' as const, content: result.content }
  }, [updateTabContent])

  const handleRightTaskToggle = useCallback((line: number, checked: boolean) => {
    if (!rightTab?.id) return
    const tab = useEditorStore.getState().tabs.find((item) => item.id === rightTab.id)
    if (tab) void handleTaskToggle(tab.id, tab.content, line, checked)
  }, [handleTaskToggle, rightTab?.id])

  const handleLeftPreviewScroll = useCallback(() => {
    if (!activeTab?.id) return
    if (viewModeRef.current === 'edit-preview' && scrollSyncSessionRef.current.source === 'editor') return
    if (isRestoringScrollRef.current) return
    if (viewModeRef.current === 'edit-preview') setTocFocus('preview')
    savePreviewReadingPosition(activeTab.id, leftPreviewRef.current, leftMarkdownPreviewRef.current, 'left')
    scheduleFlush()
  }, [activeTab?.id, savePreviewReadingPosition, scheduleFlush])

  const handleRightPreviewScroll = useCallback(() => {
    if (!rightTab?.id) return
    if (isRestoringScrollRef.current) return
    savePreviewReadingPosition(rightTab.id, rightPreviewRef.current, rightMarkdownPreviewRef.current, 'right')
    scheduleFlush()
  }, [rightTab?.id, savePreviewReadingPosition, scheduleFlush])

  const jumpToLine = useCallback((line: number) => {
    const view = editorViewRef.current
    if (!view || line < 1 || line > view.state.doc.lines) return
    // 目录/标题跳转属于程序性接管编辑器滚动：先取消正在写编辑器 scrollTop 的
    // follower，避免其每帧覆写压制本次跳转、收敛后还把编辑器拉回旧目标
    cancelEditorFollower()
    cancelEditorHeadingJump()
    const pos = view.state.doc.line(line).from
    const initialTargetTop = view.lineBlockAt(pos).top - SCROLL_SYNC_TOP_OFFSET
    view.dispatch({ selection: { anchor: pos } })
    let useInitialTarget = true
    let cleanup: (() => void) | null = null
    cleanup = startHeadingScroll({
      container: view.scrollDOM,
      fadeElement: view.scrollDOM,
      getTargetTop: () => {
        if (editorViewRef.current !== view || pos > view.state.doc.length) return undefined
        if (useInitialTarget) {
          useInitialTarget = false
          return initialTargetTop
        }
        return view.lineBlockAt(pos).top - SCROLL_SYNC_TOP_OFFSET
      },
      onBeforeReveal: () => {
        if (editorViewRef.current !== view || pos > view.state.doc.length) return
        view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: SCROLL_SYNC_TOP_OFFSET }),
        })
      },
      onSettled: () => {
        if (cleanup && editorHeadingJumpCancelRef.current === cleanup) editorHeadingJumpCancelRef.current = null
      },
    })
    editorHeadingJumpCancelRef.current = cleanup
    view.focus()
  }, [cancelEditorFollower, cancelEditorHeadingJump])

  const handleLeftPreviewHeadingClick = useCallback((line: number) => {
    if (viewModeRef.current !== 'edit-preview') return
    jumpToLine(line)
  }, [jumpToLine])

  const jumpToEditorHeading = useCallback((item: TocItem) => {
    jumpToLine(item.line)
  }, [jumpToLine])

  const insertMarkdownAtCursor = useCallback((markdown: string, insertAt?: number) => {
    const view = editorViewRef.current
    if (!view || !activeTabId) return false
    const selection = view.state.selection.main
    const from = typeof insertAt === 'number' ? insertAt : selection.from
    const to = typeof insertAt === 'number' ? insertAt : selection.to
    view.dispatch({
      changes: { from, to, insert: markdown },
      selection: { anchor: from + markdown.length },
      scrollIntoView: true,
    })
    view.focus()
    return true
  }, [activeTabId])

  const handleChooseImage = useCallback(async () => {
    if (!activeTab) return
    if (!activeTab.filePath) {
      toast.info('请先保存当前 Markdown 文件，再插入图片')
      return
    }

    try {
      const selected = await openFileDialog([
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      ])
      const imagePath = Array.isArray(selected) ? selected[0] : selected
      if (!imagePath) return

      const relativePath = await saveExternalImageForMarkdown(activeTab.filePath, imagePath)
      if (insertMarkdownAtCursor(`![图片描述](${relativePath})`)) {
        toast.success('图片已插入')
      }
    } catch (err) {
      console.error('Insert image failed:', err)
      toast.error(describeFileOperationError(err, '插入图片失败'))
    }
  }, [activeTab, insertMarkdownAtCursor])

  const handleInsertImageFiles = useCallback(async (files: File[], insertAt?: number) => {
    if (!activeTab) return
    if (!activeTab.filePath) {
      toast.info('请先保存当前 Markdown 文件，再插入图片')
      return
    }

    try {
      const snippets: string[] = []
      for (const file of files) {
        const relativePath = await saveImageFileForMarkdown(activeTab.filePath, file)
        snippets.push(`![图片描述](${relativePath})`)
      }
      if (snippets.length > 0 && insertMarkdownAtCursor(snippets.join('\n'), insertAt)) {
        toast.success(snippets.length > 1 ? `已插入 ${snippets.length} 张图片` : '图片已插入')
      }
    } catch (err) {
      console.error('Insert dropped/pasted image failed:', err)
      toast.error(describeFileOperationError(err, '插入图片失败'))
    }
  }, [activeTab, insertMarkdownAtCursor])

  const handleInsertImagePaths = useCallback(async (paths: string[]) => {
    if (!activeTab) return
    if (!activeTab.filePath) {
      toast.info('请先保存当前 Markdown 文件，再插入图片')
      return
    }

    try {
      const snippets: string[] = []
      for (const path of paths) {
        const relativePath = await saveExternalImageForMarkdown(activeTab.filePath, path)
        snippets.push(`![图片描述](${relativePath})`)
      }
      if (snippets.length > 0 && insertMarkdownAtCursor(snippets.join('\n'))) {
        toast.success(snippets.length > 1 ? `已插入 ${snippets.length} 张图片` : '图片已插入')
      }
    } catch (err) {
      console.error('Insert dragged image path failed:', err)
      toast.error(describeFileOperationError(err, '插入图片失败'))
    }
  }, [activeTab, insertMarkdownAtCursor])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ paths?: string[] }>).detail
      if (detail?.paths?.length) {
        void handleInsertImagePaths(detail.paths)
      }
    }
    window.addEventListener(DROP_IMAGES_EVENT, handler)
    return () => window.removeEventListener(DROP_IMAGES_EVENT, handler)
  }, [handleInsertImagePaths])

  const jumpToPreviewHeading = useCallback((item: TocItem) => {
    // 目录跳转属于用户在预览侧的主动导航：先取消正在写预览 scrollTop 的 follower
    // （其每帧覆写会压制 scrollToLine 的平滑步进，导致目录点击无响应），
    // 并标记手势，使预览平滑滚动期间的 scroll 事件可继续反向同步编辑器
    // （与用户滚轮滚动预览一致）。
    cancelPreviewFollower()
    previewGestureAtRef.current = Date.now()
    leftMarkdownPreviewRef.current?.scrollToLine(item.line)
  }, [cancelPreviewFollower])

  const jumpToRightPreviewHeading = useCallback((item: TocItem) => {
    rightMarkdownPreviewRef.current?.scrollToLine(item.line)
  }, [])

  const dualPreviewTocSections = useMemo(() => {
    const sections = activeTab
      ? [{
          key: `left-${activeTab.id}`,
          title: activeTab.title ? `左栏 · ${activeTab.title}` : '左栏目录',
          toc,
          onHeadingClick: jumpToPreviewHeading,
          activeHeading,
        }]
      : []

    if (rightTab) {
      sections.push({
        key: `right-${rightTab.id}`,
        title: rightTab.title ? `右栏 · ${rightTab.title}` : '右栏目录',
        toc: rightToc,
        onHeadingClick: jumpToRightPreviewHeading,
        activeHeading: activeRightHeading,
      })
    }

    return sections.slice(0, 2)
  }, [activeTab, activeHeading, activeRightHeading, jumpToPreviewHeading, jumpToRightPreviewHeading, rightTab, rightToc, toc])

  const fullscreenTocExpanded = isFullscreen && !tocCollapsed && (
    viewMode === 'dual-preview' ? dualPreviewTocSections.length > 0 : toc.length > 1
  )
  const fullscreenTocWidthClass = viewMode === 'dual-preview' ? 'gm-fullscreen-toc-adjacent--dual' : ''

  const getPreviewSelectionLineRange = useCallback((selection: Selection, container: HTMLElement): { startLine?: number, endLine?: number } => {
    if (!selection || selection.rangeCount === 0) return {}

    const range = selection.getRangeAt(0)

    // 向上查找带 data-md-line 的元素
    const findLineElement = (node: Node | null): HTMLElement | null => {
      let current = node instanceof HTMLElement ? node : node?.parentElement
      while (current && current !== container) {
        if (current.hasAttribute?.('data-md-line')) return current
        current = current.parentElement
      }
      return null
    }

    const startEl = findLineElement(range.startContainer)
    const endEl = findLineElement(range.endContainer)
    const readLine = (element: HTMLElement | null, attribute: 'data-md-line' | 'data-md-end-line') => {
      const value = Number(element?.getAttribute(attribute))
      return Number.isFinite(value) && value > 0 ? value : undefined
    }
    const firstLine = readLine(startEl, 'data-md-line')
    const lastLine = readLine(endEl, 'data-md-end-line') ?? readLine(endEl, 'data-md-line')
    if (firstLine === undefined) return { startLine: lastLine, endLine: lastLine }
    if (lastLine === undefined) return { startLine: firstLine, endLine: firstLine }
    return {
      startLine: Math.min(firstLine, lastLine),
      endLine: Math.max(firstLine, lastLine),
    }
  }, [])

  const handlePreviewContextMenu = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    pane: 'left' | 'right'
  ) => {
    e.preventDefault()
    // 优先读取统一 Range 选区快照（虚拟化下 DOM 卸载不丢失）
    const previewHandle = pane === 'left' ? leftMarkdownPreviewRef.current : rightMarkdownPreviewRef.current
    const snapshot = previewHandle?.getSelection() ?? null
    let selectedText = snapshot?.text ?? ''
    let startLine = snapshot?.startLine
    let endLine = snapshot?.endLine
    const selectionFrom = snapshot?.from
    const selectionTo = snapshot?.to

    // 非接管区域（KaTeX / 代码高亮等）回退原生 DOM Selection
    if (!selectedText) {
      const container = pane === 'left' ? leftPreviewRef.current : rightPreviewRef.current
      const selection = window.getSelection()
      if (container && selection && selection.rangeCount > 0
        && container.contains(selection.anchorNode) && container.contains(selection.focusNode)) {
        selectedText = selection.toString()
        const lineRange = getPreviewSelectionLineRange(selection, container)
        startLine = lineRange.startLine
        endLine = lineRange.endLine
      }
      clearPreviewContextHighlight()
      if (selectedText && typeof CSS !== 'undefined' && CSS.highlights && selection && selection.rangeCount > 0) {
        CSS.highlights.set(PREVIEW_CONTEXT_HIGHLIGHT, new Highlight(selection.getRangeAt(0).cloneRange()))
      }
    }

    setPreviewMenu({ x: e.clientX, y: e.clientY, selectedText, startLine, endLine, selectionFrom, selectionTo, pane })
  }, [clearPreviewContextHighlight, getPreviewSelectionLineRange])

  const handleCopyPreviewSelection = useCallback(() => {
    if (previewMenu?.selectedText) {
      void navigator.clipboard.writeText(previewMenu.selectedText)
    }
    clearPreviewContextHighlight()
    setPreviewMenu(null)
  }, [clearPreviewContextHighlight, previewMenu])

  const handleSelectAllPreview = useCallback(() => {
    // 逻辑全文选择：selectionRange = 文档开始 → 文档结束，不依赖 DOM Selection
    const previewHandle = previewMenu?.pane === 'right' ? rightMarkdownPreviewRef.current : leftMarkdownPreviewRef.current
    previewHandle?.selectAll()
    clearPreviewContextHighlight()
    setPreviewMenu(null)
  }, [clearPreviewContextHighlight, previewMenu])

  const getPreviewSourceSelection = useCallback((): PreviewSelectionSource | null => {
    if (!previewMenu?.selectedText) return null

    const tab = previewMenu.pane === 'right' ? rightTab : activeTab
    if (!tab) return null

    const selectedText = previewMenu.selectedText.trim()
    if (!selectedText) return null

    const content = tab.content

    // 统一 Range 快照：offset 即精确源码位置，无需文本回溯推测
    if (
      typeof previewMenu.selectionFrom === 'number'
      && typeof previewMenu.selectionTo === 'number'
      && previewMenu.selectionTo > previewMenu.selectionFrom
      && previewMenu.selectionTo <= content.length
    ) {
      return {
        title: tab.title,
        filePath: tab.filePath,
        text: content.slice(previewMenu.selectionFrom, previewMenu.selectionTo),
        startLine: previewMenu.startLine,
        endLine: previewMenu.endLine,
        selectionFrom: previewMenu.selectionFrom,
        selectionTo: previewMenu.selectionTo,
      }
    }
    const normalizedSelectedText = selectedText.replace(/\r\n/g, '\n')
    const lines = content.split('\n')
    const startLine = previewMenu.startLine
    const endLine = previewMenu.endLine

    const findUniqueRange = (source: string, needle: string, baseOffset = 0) => {
      const variants = [...new Set([needle, needle.replace(/\n/g, '\r\n')])]
      const matches = variants.flatMap((variant) => {
        if (!variant) return []
        const indexes: number[] = []
        let index = source.indexOf(variant)
        while (index >= 0 && indexes.length < 2) {
          indexes.push(index)
          index = source.indexOf(variant, index + variant.length)
        }
        return indexes.map((from) => ({ from, to: from + variant.length }))
      })
      const uniqueMatches = matches.filter((match, index) => (
        matches.findIndex((candidate) => candidate.from === match.from && candidate.to === match.to) === index
      ))
      return uniqueMatches.length === 1
        ? { from: baseOffset + uniqueMatches[0].from, to: baseOffset + uniqueMatches[0].to }
        : null
    }

    const offsetForLine = (line: number) => {
      let offset = 0
      for (let i = 0; i < Math.max(0, line - 1); i++) {
        offset += lines[i].length + 1
      }
      return offset
    }

    let range: { from: number; to: number } | null = null
    let markdownText = ''

    if (startLine && endLine) {
      const safeStart = Math.max(1, Math.min(startLine, lines.length))
      const safeEnd = Math.max(safeStart, Math.min(endLine, lines.length))
      const from = offsetForLine(safeStart)
      const to = offsetForLine(safeEnd) + lines[safeEnd - 1].length
      markdownText = content.slice(from, to)
      range = findUniqueRange(markdownText, normalizedSelectedText, from)
      if (!range) {
        range = { from, to }
      }
    }

    range = range || findUniqueRange(content, normalizedSelectedText)

    const sourceText = range ? content.slice(range.from, range.to) : normalizedSelectedText

    return {
      title: tab.title,
      filePath: tab.filePath,
      text: sourceText || markdownText || normalizedSelectedText,
      startLine,
      endLine,
      selectionFrom: range?.from,
      selectionTo: range?.to,
    }
  }, [activeTab, previewMenu, rightTab])

  const handleAddPreviewSelectionToAi = useCallback(() => {
    if (!previewMenu?.selectedText) return
    const sourceSelection = getPreviewSourceSelection()
    if (!sourceSelection) return
    addSelectionContextTag({
      title: sourceSelection.title,
      filePath: sourceSelection.filePath,
      text: sourceSelection.text,
      startLine: sourceSelection.startLine,
      endLine: sourceSelection.endLine,
      selectionFrom: sourceSelection.selectionFrom,
      selectionTo: sourceSelection.selectionTo,
    })
    clearPreviewContextHighlight()
    setPreviewMenu(null)
  }, [previewMenu, clearPreviewContextHighlight, getPreviewSourceSelection])

  const handlePreviewAiAction = useCallback((prompt: string) => {
    if (!previewMenu?.selectedText) return
    const sourceSelection = getPreviewSourceSelection()
    if (!sourceSelection) return
    addSelectionContextTag({
      title: sourceSelection.title,
      filePath: sourceSelection.filePath,
      text: sourceSelection.text,
      startLine: sourceSelection.startLine,
      endLine: sourceSelection.endLine,
      selectionFrom: sourceSelection.selectionFrom,
      selectionTo: sourceSelection.selectionTo,
    })
    setAiShortcutPrompt(prompt)
    clearPreviewContextHighlight()
    setPreviewMenu(null)
  }, [previewMenu, clearPreviewContextHighlight, getPreviewSourceSelection])

  // Drag & drop for dual-preview right pane
  const handleRightPaneDragOver = useCallback((e: React.DragEvent) => {
    const hasTab = e.dataTransfer.types.includes('application/x-guanmo-tab')
    if (hasTab) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setRightPaneDragOver(true)
    }
  }, [])

  const handleRightPaneDragLeave = useCallback(() => {
    setRightPaneDragOver(false)
  }, [])

  const handleRightPaneDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setRightPaneDragOver(false)
    const tabData = e.dataTransfer.getData('application/x-guanmo-tab')
    let tabId: string | undefined
    try {
      tabId = tabData ? JSON.parse(tabData).tabId as string | undefined : undefined
    } catch {
      tabId = undefined
    }
    if (tabId) {
      setRightPaneTabId(tabId)
      if (viewMode !== 'dual-preview') {
        setViewMode('dual-preview')
      }
    }
  }, [setRightPaneTabId, viewMode, setViewMode])

  const getSearchProps = () => {
    if (viewMode === 'edit' || viewMode === 'edit-preview') return { editorViewRef }
    const previewSources = []
    if (leftPreviewVisible && leftPreviewRef.current) {
      previewSources.push({
        content: leftPreviewRenderRef.current.content,
        paneRef: leftPreviewRef,
        previewRef: leftMarkdownPreviewRef,
      })
    }
    if (viewMode === 'dual-preview' && rightPreviewRef.current && rightTab) {
      previewSources.push({
        content: rightPreview.content,
        paneRef: rightPreviewRef,
        previewRef: rightMarkdownPreviewRef,
      })
    }
    return { previewSources }
  }

  const handlePreviewFirstVisible = useCallback((documentId: string | null) => {
    if (!documentId || !activeTab || !previewContentReady) return
    if (!markActiveDocumentFirstScreenReady(documentId)) return
    markStartupPoint('active-document-first-visible', {
      surface: 'preview',
      charCount: activeTab.content.length,
    })
    markStartupPoint('preview-first-visible', {
      charCount: activeTab.content.length,
      mode: viewMode,
      policy: modePerformancePolicy,
    })
    if (import.meta.env.DEV) {
      eventMarker.mark('preview-first-visible', {
        charCount: activeTab.content.length,
        mode: viewMode,
        policy: modePerformancePolicy,
      })
    }
  }, [activeTab?.content.length, activeTab?.id, markActiveDocumentFirstScreenReady, modePerformancePolicy, previewContentReady, viewMode])

  const handlePreviewRenderComplete = useCallback(() => {
    markStartupPoint('preview-render-complete', { mode: viewMode })
    eventMarker.mark('preview-render-complete', { mode: viewMode })
  }, [viewMode])

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-gm-canvas"
      style={isFullscreen ? { '--gm-fullscreen-content-padding': `${fullscreenContentPadding}px` } as CSSProperties : undefined}
    >
      {!isFullscreen && <TabBar />}

      <div className="flex-1 flex overflow-hidden relative">
        {tabs.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <>
            {(viewMode === 'diff-preview' || diffMounted) && (
              <div className={viewMode === 'diff-preview' ? 'flex min-w-0 flex-1' : 'hidden'}>
                <Suspense fallback={<PreviewSuspenseFallback />}>
                  <LazyMarkdownDiffView
                    original={activeTab?.originalContent || ''}
                    current={activeTab?.content || ''}
                    fontSize={editorFontSize}
                    lineHeight={editorLineHeight}
                    fontFamily={editorFontFamily}
                    wordWrap={editorWordWrap}
                    lineNumbers={editorLineNumbers}
                    documentKey={activeTab?.id}
                    resource="diff"
                  />
                </Suspense>
              </div>
            )}
            <div className={`${viewMode === 'diff-preview' ? 'hidden' : 'flex'} flex-1 overflow-hidden bg-gm-surface`}>
            {(editorMounted || editorVisible) && (
            <div className={`${editorVisible ? (viewMode === 'edit-preview' ? 'min-w-0 flex-1 border-r border-gm-border-subtle' : 'flex-1') : 'hidden'} ${isFullscreen ? 'gm-fullscreen-editor-content' : ''} ${isFullscreen && viewMode === 'edit-preview' ? 'gm-fullscreen-content-split-left' : ''} ${fullscreenTocExpanded && viewMode === 'edit' ? `gm-fullscreen-toc-adjacent ${fullscreenTocWidthClass}` : ''} overflow-hidden relative`}>
              {activeTab && (
                <CodeMirrorEditor
                  content={activeTab.content}
                  onChange={handleEditorChange}
                  onSave={handleSave}
                  onImageFiles={(files, insertAt) => void handleInsertImageFiles(files, insertAt)}
                  viewRef={editorViewRef}
                  documentKey={activeTab.id}
                  tabId={activeTab.id}
                  initialScrollTop={getStoredEditorTop(activeTab.id)}
                  initialCursor={readingPositionsRef.current.get(activeTab.id)?.cursor}
                  initialSelection={readingPositionsRef.current.get(activeTab.id)?.selection}
                  initialRanges={readingPositionsRef.current.get(activeTab.id)?.ranges}
                  initialMainIndex={readingPositionsRef.current.get(activeTab.id)?.mainIndex}
                  onBeforeDestroy={saveEditorPositionForTab}
                  resource="editor"
                />
              )}
              {activeTab && (
                <button
                  type="button"
                  onClick={() => void handleChooseImage()}
                  className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-gm-border bg-gm-surface/90 text-gm-text-secondary shadow-sm hover:border-gm-primary/50 hover:text-gm-primary"
                  title="选择图片插入"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </button>
              )}
              <EditorContextMenu viewRef={editorViewRef} />
            </div>
            )}

            {(leftPreviewMounted || leftPreviewVisible) && (
              <div
                key={`left-${activeTab?.id ?? 'none'}`}
                ref={leftPreviewRef}
                data-product-tour="preview-area"
                className={`${leftPreviewVisible ? 'min-w-0 flex-1' : 'hidden'} ${viewMode === 'dual-preview' ? 'border-r border-gm-border-subtle' : ''} ${viewMode === 'edit-preview' ? 'gm-preview-heading-clickable' : ''} ${isFullscreen ? 'gm-fullscreen-preview-content py-6' : 'p-6'} ${isFullscreen && viewMode === 'edit-preview' ? 'gm-fullscreen-content-split-right' : isFullscreen && viewMode === 'dual-preview' ? 'gm-fullscreen-content-split-left' : ''} ${fullscreenTocExpanded && viewMode !== 'dual-preview' ? `gm-fullscreen-toc-adjacent ${fullscreenTocWidthClass}` : ''} overflow-y-auto overflow-x-hidden select-text bg-gm-surface relative`}
                style={{ overflowAnchor: 'none', ...(leftPreviewMasked ? { visibility: 'hidden' } : {}) }}
                aria-hidden={!leftPreviewVisible}
                onScroll={handleLeftPreviewScroll}
                onContextMenu={(e) => handlePreviewContextMenu(e, 'left')}
              >
                {viewMode === 'dual-preview' && <PaneHeader title={activeTab?.title || ''} />}
                <Suspense fallback={<PreviewSuspenseFallback />}>
                  <LazyMarkdownPreview
                    ref={leftMarkdownPreviewRef}
                    content={leftPreviewRenderRef.current.content}
                    filePath={leftPreviewRenderRef.current.filePath}
                    fontSize={editorFontSize}
                    lineHeight={editorLineHeight}
                    fontFamily={previewFontFamily}
                    wordWrap={editorWordWrap}
                    documentKey={activeTab?.id}
                    documentVersion={getContentSignature(activeTab?.content || '')}
                    inlineEditEnabled={inlinePreviewEdit}
                    onBlockCommit={handlePreviewBlockCommit}
                    onHeadingClick={handleLeftPreviewHeadingClick}
                    onTaskToggle={activeTab ? handleActiveTaskToggle : undefined}
                    onDraftStateChange={handleLeftDraftStateChange}
                    isVisible={leftPreviewVisible && previewContentReady}
                    onFirstVisible={() => handlePreviewFirstVisible(activeTab?.id ?? null)}
                    onRenderComplete={handlePreviewRenderComplete}
                    resource="left-preview"
                  />
                </Suspense>
              </div>
            )}

            {(rightPreviewMounted || viewMode === 'dual-preview') && (
            <div
              key={`right-${rightTab?.id ?? 'none'}`}
              ref={rightPreviewRef}
              className={`${viewMode === 'dual-preview' ? 'min-w-0 flex-1' : 'hidden'} ${isFullscreen ? 'gm-fullscreen-preview-content py-6' : 'p-6'} ${isFullscreen && viewMode === 'dual-preview' ? 'gm-fullscreen-content-split-right' : ''} ${fullscreenTocExpanded && viewMode === 'dual-preview' ? `gm-fullscreen-toc-adjacent ${fullscreenTocWidthClass}` : ''} overflow-y-auto overflow-x-hidden select-text bg-gm-surface relative ${rightPaneDragOver ? 'ring-2 ring-inset ring-gm-primary/40' : ''}`}
              style={{ overflowAnchor: 'none', ...(rightPreviewMasked ? { visibility: 'hidden' } : {}) }}
              aria-hidden={viewMode !== 'dual-preview'}
              onScroll={handleRightPreviewScroll}
              onDragOver={handleRightPaneDragOver}
              onDragLeave={handleRightPaneDragLeave}
              onDrop={handleRightPaneDrop}
              onContextMenu={(e) => handlePreviewContextMenu(e, 'right')}
            >
              {rightPaneDragOver && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-gm-primary/5 border-2 border-dashed border-gm-primary/50 rounded-lg pointer-events-none">
                  <span className="text-caption text-gm-primary font-bold">{'释放以在右栏打开'}</span>
                </div>
              )}
              <PaneHeader
                title={rightTab?.title || '选择文件'}
                onClose={() => {
                  setRightPaneTabId(null)
                  useEditorStore.getState().setViewMode('edit')
                }}
              />
              {rightTab ? (
                <Suspense fallback={<PreviewSuspenseFallback />}>
                  <LazyMarkdownPreview
                    ref={rightMarkdownPreviewRef}
                    content={rightPreview.content}
                    filePath={rightTab.filePath}
                    fontSize={editorFontSize}
                    lineHeight={editorLineHeight}
                    fontFamily={previewFontFamily}
                    wordWrap={editorWordWrap}
                    documentKey={rightTab.id}
                    documentVersion={getContentSignature(rightTab.content)}
                    inlineEditEnabled={inlinePreviewEdit}
                    onBlockCommit={handlePreviewBlockCommit}
                    onTaskToggle={handleRightTaskToggle}
                    onDraftStateChange={handleRightDraftStateChange}
                    isVisible={viewMode === 'dual-preview'}
                    resource="right-preview"
                  />
                </Suspense>
              ) : (
                <div className="flex items-center justify-center h-full text-gm-text-tertiary text-caption">
                  {'拖拽标签页到此处，或右键选择"在右栏打开"'}
                </div>
              )}
            </div>
            )}
            {viewMode === 'dual-preview' && (
            <MarkdownToc
              collapsed={tocCollapsed}
              onToggle={() => setTocCollapsed((collapsed) => !collapsed)}
              sections={dualPreviewTocSections}
            />
            )}

            {viewMode !== 'dual-preview' && (
              <MarkdownToc
                toc={toc}
                collapsed={tocCollapsed}
                onToggle={() => setTocCollapsed((collapsed) => !collapsed)}
                onHeadingClick={leftPreviewVisible ? jumpToPreviewHeading : jumpToEditorHeading}
                activeHeading={viewMode === 'edit' || (viewMode === 'edit-preview' && tocFocus === 'editor')
                  ? activeEditorHeading
                  : activeHeading}
              />
            )}
            </div>
          </>
        )}

        {searchOpen && tabs.length > 0 && (
          <SearchOverlay onClose={() => setSearchOpen(false)} {...getSearchProps()} />
        )}
        {previewMenu && (
          <ContextMenu position={previewMenu} onClose={() => {
            clearPreviewContextHighlight()
            setPreviewMenu(null)
          }} minWidth={176} maxWidth={176}>
            <ContextMenuGroupTitle>预览操作</ContextMenuGroupTitle>
            <ContextMenuItem onClick={handleCopyPreviewSelection} disabled={!previewMenu.selectedText}>
              复制
            </ContextMenuItem>
            <ContextMenuItem onClick={handleSelectAllPreview}>
              全选
            </ContextMenuItem>
            {previewMenu.selectedText && (
              <>
                <ContextMenuSeparator />
                <ContextMenuGroupTitle>AI 助手</ContextMenuGroupTitle>
                <ContextMenuItem onClick={handleAddPreviewSelectionToAi}>
                  添加到 AI 上下文
                </ContextMenuItem>
                <AiShortcutMenuItems onAction={handlePreviewAiAction} />
              </>
            )}
          </ContextMenu>
        )}
      </div>
    </div>
  )
}

function getEditorTopLine(view: EditorView): number | undefined {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + SCROLL_SYNC_TOP_OFFSET)
  if (!block) return undefined
  return view.state.doc.lineAt(block.from).number
}

function getHeadingIdAtLine(toc: TocItem[], line: number): string | null {
  let activeId: string | null = null
  for (const item of toc) {
    if (item.line > line) break
    activeId = item.id
  }
  return activeId
}

/**
 * 滚动几何 → 活跃目录项：取"滚动位置之前最后一个标题"。
 * 行号映射来自预览实例的全文模型 + 实测高度，与标题块是否挂载无关；
 * 尚未越过任何标题时（文档顶部），回落到视口上半区可见的首个标题，
 * 与原 IntersectionObserver（rootMargin -50%）的顶部行为保持一致。
 */
function resolveActiveHeadingByScroll(
  handle: Pick<MarkdownPreviewHandle, 'getLineForTop'>,
  toc: TocItem[],
  scrollTop: number,
  viewportHeight: number
): string | null {
  const topLine = handle.getLineForTop(scrollTop)
  if (typeof topLine === 'number') {
    const passed = getHeadingIdAtLine(toc, topLine)
    if (passed) return passed
  }
  const halfLine = handle.getLineForTop(scrollTop + viewportHeight / 2)
  if (typeof halfLine === 'number') {
    return toc.find((item) => item.line <= halfLine)?.id ?? null
  }
  return null
}

function getPreviewTopForLine(
  container: HTMLElement,
  line: number,
  estimatedTop?: number
): number | undefined {
  let previousElement: HTMLElement | undefined
  let previousLine = -1
  let nextElement: HTMLElement | undefined
  let nextLine = Number.POSITIVE_INFINITY

  for (const element of container.querySelectorAll<HTMLElement>('[data-md-line]')) {
    const elementLine = Number(element.dataset.mdLine)
    if (!Number.isFinite(elementLine) || elementLine < 1) continue
    if (elementLine <= line && elementLine > previousLine) {
      previousElement = element
      previousLine = elementLine
    } else if (elementLine > line && elementLine < nextLine) {
      nextElement = element
      nextLine = elementLine
    }
  }

  const anchorElement = previousElement ?? nextElement
  if (!anchorElement) return estimatedTop
  const containerTop = container.getBoundingClientRect().top
  const anchorRect = anchorElement.getBoundingClientRect()
  const anchorTop = anchorRect.top - containerTop + container.scrollTop
  const endLine = Number(anchorElement.dataset.mdEndLine)
  if (previousElement && Number.isFinite(endLine) && endLine > previousLine && line <= endLine) {
    const progress = (line - previousLine) / (endLine - previousLine)
    return anchorTop + anchorRect.height * progress
  }

  if (previousElement && nextElement && nextLine !== previousLine) {
    const nextTop = nextElement.getBoundingClientRect().top - containerTop + container.scrollTop
    const progress = (line - previousLine) / (nextLine - previousLine)
    return anchorTop + (nextTop - anchorTop) * Math.max(0, Math.min(1, progress))
  }

  return estimatedTop ?? anchorTop
}

function reportPreviewSwitchPerformance(tabId: string, restoreStartedAt: number) {
  if (!import.meta.env.DEV) return
  const startMark = `${PREVIEW_SWITCH_MARK_PREFIX}:${tabId}:start`
  const entries = performance.getEntriesByName(startMark, 'mark')
  const start = entries[entries.length - 1]
  if (!start) return

  const committedAt = performance.now()
  window.requestAnimationFrame(() => {
    const firstFrameAt = performance.now()
    console.debug('[预览切换性能]', {
      tabId,
      commitMs: Number((committedAt - start.startTime).toFixed(1)),
      restoreMs: Number((committedAt - restoreStartedAt).toFixed(1)),
      firstFrameMs: Number((firstFrameAt - start.startTime).toFixed(1)),
    })
    performance.clearMarks(startMark)
  })
}

function getContentSignature(content: string) {
  let hash = 2166136261
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${content.length}:${hash >>> 0}`
}

function countMarkdownLines(content: string) {
  if (!content) return 1
  let lines = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines += 1
  }
  return lines
}

function PaneHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4 pb-2 border-b border-gm-border-subtle">
      <div className="flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gm-primary)" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="text-caption font-bold text-gm-text truncate">{title}</span>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-gm-text-tertiary hover:text-gm-text hover:bg-gm-surface-hover"
          title="关闭右栏"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

function WelcomeScreen() {
  const { handleNewFile, handleOpenFile } = useFileOperations()
  const toggleAiPanel = useAppStore((s) => s.toggleAiPanel)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fadeIn">
      <div className="mb-5">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--gm-primary)" strokeWidth="1.2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
      </div>

      <h2 className="text-display text-gm-text mb-2 font-display">观墨</h2>
      <p className="text-body text-gm-text-secondary mb-7">AI 驱动的 Markdown 知识管理</p>

      <div className="grid w-full max-w-sm grid-cols-2 gap-x-5 gap-y-1">
        <ActionItem label="新建文件" shortcut="Ctrl+N" onClick={handleNewFile}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14" /></svg>}
        />
        <ActionItem label="打开文件" shortcut="Ctrl+O" onClick={handleOpenFile}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>}
        />
        <ActionItem
          label="快速打开"
          shortcut="Ctrl+P"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>}
        />
        <ActionItem label="AI 对话" shortcut="Ctrl+J" onClick={toggleAiPanel}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>}
        />
      </div>
    </div>
  )
}

function ActionItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  shortcut: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex min-h-11 items-center gap-2 border-b border-gm-border-subtle px-2 text-left text-gm-text-secondary transition-colors hover:border-gm-border hover:text-gm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gm-primary/35"
      onClick={onClick}
    >
      <span className="flex-shrink-0 text-gm-primary">{icon}</span>
      <span className="min-w-0 flex-1 text-caption font-bold text-gm-text">{label}</span>
      <kbd className="flex-shrink-0 font-mono text-micro text-gm-text-tertiary">{shortcut}</kbd>
    </button>
  )
}
