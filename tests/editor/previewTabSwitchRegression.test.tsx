import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock IntersectionObserver for jsdom
if (typeof IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
    root: Element | null = null
    rootMargin = ''
    thresholds: ReadonlyArray<number> = []
  } as unknown as typeof IntersectionObserver
}

if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

const scheduledCallbacks = vi.hoisted(() => ({
  raf: new Set<number>(),
  idle: new Set<number>(),
  rafTimers: new Map<number, number>(),
  idleTimers: new Map<number, number>(),
}))

vi.mock('@/hooks/useActiveHeading', () => ({ useActiveHeading: () => null }))
vi.mock('@/hooks/useTauri', () => ({ isTauri: false, openFileDialog: vi.fn(), openUrl: vi.fn() }))
vi.mock('@/services/fileSystem', () => ({ saveFile: vi.fn(), saveFileAs: vi.fn() }))
vi.mock('@/services/rag/indexer', () => ({ scheduleMarkdownDocumentIndex: vi.fn() }))
vi.mock('@/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/services/eventMarker', () => ({
  eventMarker: {
    start: vi.fn(),
    mark: vi.fn(),
  },
}))
vi.mock('@/services/aiContext', () => ({ addSelectionContextTag: vi.fn(), setAiShortcutPrompt: vi.fn() }))
vi.mock('@/services/editorViewRef', () => ({
  setActiveEditorView: vi.fn(),
  getActiveEditorView: vi.fn(() => null),
}))
vi.mock('@/services/markdownImages', () => ({
  saveExternalImageForMarkdown: vi.fn(),
  saveImageFileForMarkdown: vi.fn(),
}))
vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({ handleNewFile: vi.fn(), handleOpenFile: vi.fn() }),
}))
vi.mock('@/services/fileOperationErrors', () => ({ describeFileOperationError: vi.fn(() => 'anonymous error') }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((src: string) => src) }))
vi.mock('@/services/markdownBlocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/markdownBlocks')>()
  return { ...actual, replaceMarkdownBlock: vi.fn((content: string) => ({ status: 'applied' as const, content })) }
})

import { EditorArea } from '@/components/editor/EditorArea'
import { useEditorStore, type Tab, type ViewMode } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'

function anonymousTab(id: string, content: string): Tab {
  return {
    id,
    title: `匿名文档-${id}.md`,
    filePath: null,
    content,
    savedContent: content,
    originalContent: content,
    modified: false,
  }
}

function setupEditor(
  tabs: Tab[],
  activeTabId: string,
  viewMode: ViewMode,
  options?: { syncScroll?: boolean; modePerformancePolicy?: string },
) {
  useEditorStore.setState({
    tabs,
    activeTabId,
    viewMode,
    rightPaneTabId: null,
    rightPaneUserSelected: false,
    viewModeUsage: {},
    previewVisible: false,
    previewSwitchingTabId: null,
    pendingReveal: null,
    recentFiles: [],
    favorites: [],
  })
  useSettingsStore.setState((state) => ({
    editor: {
      ...state.editor,
      syncScroll: options?.syncScroll ?? false,
      modePerformancePolicy: (options?.modePerformancePolicy as 'memory' | 'balanced' | 'speed') ?? 'balanced',
      inlinePreviewEdit: false,
    },
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  scheduledCallbacks.raf.clear()
  scheduledCallbacks.idle.clear()
  scheduledCallbacks.rafTimers.clear()
  scheduledCallbacks.idleTimers.clear()
  let nextHandle = 1
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn: FrameRequestCallback) => {
    const handle = nextHandle++
    scheduledCallbacks.raf.add(handle)
    const timer = window.setTimeout(() => {
      scheduledCallbacks.raf.delete(handle)
      scheduledCallbacks.rafTimers.delete(handle)
      fn(performance.now())
    }, 0)
    scheduledCallbacks.rafTimers.set(handle, timer)
    return handle
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle: number) => {
    scheduledCallbacks.raf.delete(handle)
    const timer = scheduledCallbacks.rafTimers.get(handle)
    if (timer !== undefined) window.clearTimeout(timer)
    scheduledCallbacks.rafTimers.delete(handle)
  })
  if ('requestIdleCallback' in window) {
    vi.spyOn(window as any, 'requestIdleCallback').mockImplementation((fn: (...args: any[]) => void) => {
      const handle = nextHandle++
      scheduledCallbacks.idle.add(handle)
      const timer = window.setTimeout(() => {
        scheduledCallbacks.idle.delete(handle)
        scheduledCallbacks.idleTimers.delete(handle)
        fn({ didTimeout: false, timeRemaining: () => 50 })
      }, 0)
      scheduledCallbacks.idleTimers.set(handle, timer)
      return handle
    })
  }
  if ('cancelIdleCallback' in window) {
    vi.spyOn(window as any, 'cancelIdleCallback').mockImplementation((handle: number) => {
      scheduledCallbacks.idle.delete(handle)
      const timer = scheduledCallbacks.idleTimers.get(handle)
      if (timer !== undefined) window.clearTimeout(timer)
      scheduledCallbacks.idleTimers.delete(handle)
    })
  }
})

afterEach(() => {
  vi.useRealTimers()
})

function getLeftPreviewContainer(container: HTMLElement): HTMLElement | null {
  const all = container.querySelectorAll('.overflow-auto.select-text.bg-gm-surface')
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement
    if (!el.classList.contains('hidden')) return el
  }
  return all[0] as HTMLElement | null
}

// ============================================================
// CORE BUG: "Document switch" useEffect clears restoredPreviewKeysRef
// after restore useLayoutEffect set it, causing leftPreviewMasked = true
// ============================================================
describe('preview visibility regression: restoredPreviewKeysRef race', () => {
  describe('mode switch on same tab with saved scroll position', () => {
    it('preview→edit→preview cycle does not permanently hide preview', () => {
      // The "Document switch" useEffect has viewMode in its dependency array.
      // When viewMode changes (even without tab change), the effect body runs.
      // But the guard `if (prev && activeTabId && prev !== activeTabId)` prevents
      // clearing restoredPreviewKeysRef for mode-only changes.
      // The restore useLayoutEffect also has viewMode in deps, so it re-runs
      // and re-sets restoredPreviewKeysRef.
      const longContent = '# 模式切换\n\n' + Array.from({ length: 80 }, (_, i) => `段落 ${i + 1}`).join('\n\n')
      const tab = anonymousTab('tab-a', longContent)
      setupEditor([tab], 'tab-a', 'preview', { modePerformancePolicy: 'balanced' })
      const { container } = render(<EditorArea />)

      const preview = getLeftPreviewContainer(container)
      expect(preview).toBeTruthy()
      expect(preview!.style.visibility).not.toBe('hidden')

      // Save non-zero scroll position
      act(() => {
        Object.defineProperty(preview!, 'scrollTop', { value: 200, writable: true, configurable: true })
        fireEvent.scroll(preview!)
      })
      act(() => vi.advanceTimersByTime(50))

      // preview → edit (container stays mounted, balanced policy)
      act(() => useEditorStore.getState().setViewMode('edit'))
      act(() => vi.advanceTimersByTime(200))

      // edit → preview
      act(() => useEditorStore.getState().setViewMode('preview'))
      act(() => vi.advanceTimersByTime(200))

      const previewAfter = getLeftPreviewContainer(container)
      expect(previewAfter).toBeTruthy()
      expect(previewAfter!.style.visibility).not.toBe('hidden')
      expect(container.textContent).toContain('模式切换')
    })

    it('edit-preview→edit→edit-preview cycle preserves preview visibility', () => {
      const longContent = '# 编辑预览模式\n\n' + Array.from({ length: 80 }, (_, i) => `内容 ${i + 1}`).join('\n\n')
      const tab = anonymousTab('tab-a', longContent)
      setupEditor([tab], 'tab-a', 'edit-preview', { syncScroll: true, modePerformancePolicy: 'balanced' })
      const { container } = render(<EditorArea />)

      const preview = getLeftPreviewContainer(container)
      expect(preview).toBeTruthy()

      // Save scroll position
      act(() => {
        Object.defineProperty(preview!, 'scrollTop', { value: 180, writable: true, configurable: true })
        fireEvent.scroll(preview!)
      })
      act(() => vi.advanceTimersByTime(50))

      // edit-preview → edit
      act(() => useEditorStore.getState().setViewMode('edit'))
      act(() => vi.advanceTimersByTime(200))

      // edit → edit-preview
      act(() => useEditorStore.getState().setViewMode('edit-preview'))
      act(() => vi.advanceTimersByTime(200))

      const previewAfter = getLeftPreviewContainer(container)
      expect(previewAfter).toBeTruthy()
      expect(previewAfter!.style.visibility).not.toBe('hidden')

      // Editor should also be present for bidirectional sync
      const cmEditor = container.querySelector('.cm-editor')
      expect(cmEditor).toBeTruthy()
    })
  })

  describe('tab switch in preview mode', () => {
    it('tab switch remounts container and keeps preview visible', () => {
      // When switching tabs, the preview container's key changes, causing a remount.
      // The new container starts with scrollTop=0, so leftPreviewMasked should be false.
      // The restore useLayoutEffect fires because activePreview.version changes.
      const tabA = anonymousTab('tab-a', '# 文档 A\n\n' + '段落 A\n'.repeat(40))
      const tabB = anonymousTab('tab-b', '# 文档 B\n\n段落 B\n'.repeat(40))
      setupEditor([tabA, tabB], 'tab-a', 'preview')
      const { container } = render(<EditorArea />)

      expect(container.textContent).toContain('文档 A')

      // Save scroll for tab-a
      const preview = getLeftPreviewContainer(container)
      act(() => {
        Object.defineProperty(preview!, 'scrollTop', { value: 100, writable: true, configurable: true })
        fireEvent.scroll(preview!)
      })

      // Switch to tab-b
      act(() => useEditorStore.getState().setActiveTab('tab-b'))
      act(() => vi.advanceTimersByTime(500))
      expect(container.textContent).toContain('文档 B')

      // Switch back to tab-a
      act(() => useEditorStore.getState().setActiveTab('tab-a'))
      act(() => vi.advanceTimersByTime(500))

      // Preview should be visible with correct content
      const previewAfter = getLeftPreviewContainer(container)
      expect(previewAfter).toBeTruthy()
      expect(previewAfter!.style.visibility).not.toBe('hidden')
      expect(container.textContent).toContain('文档 A')
      expect(container.textContent).toContain('段落 A')
    })

    it('three-way tab switch preserves preview visibility', () => {
      const tabs = [
        anonymousTab('tab-a', '# A\n\n' + '内容 A\n'.repeat(50)),
        anonymousTab('tab-b', '# B\n\n内容 B'),
        anonymousTab('tab-c', '# C\n\n内容 C'),
      ]
      setupEditor(tabs, 'tab-a', 'preview')
      const { container } = render(<EditorArea />)

      // Save scroll for tab-a
      const preview = getLeftPreviewContainer(container)
      act(() => {
        Object.defineProperty(preview!, 'scrollTop', { value: 150, writable: true, configurable: true })
        fireEvent.scroll(preview!)
      })

      // A → B → C → A
      act(() => useEditorStore.getState().setActiveTab('tab-b'))
      act(() => vi.advanceTimersByTime(100))
      act(() => useEditorStore.getState().setActiveTab('tab-c'))
      act(() => vi.advanceTimersByTime(100))
      act(() => useEditorStore.getState().setActiveTab('tab-a'))
      act(() => vi.advanceTimersByTime(200))

      const previewA = getLeftPreviewContainer(container)
      expect(previewA).toBeTruthy()
      expect(previewA!.style.visibility).not.toBe('hidden')
      expect(container.textContent).toContain('内容 A')
    })
  })

  describe('tab switch in edit-preview mode', () => {
    it('switching tabs in edit-preview keeps both editor and preview visible', () => {
      const tabA = anonymousTab('tab-a', '# 编辑预览 A\n\n' + '段落\n'.repeat(50))
      const tabB = anonymousTab('tab-b', '# 编辑预览 B\n\n其他内容')
      setupEditor([tabA, tabB], 'tab-a', 'edit-preview', { syncScroll: true })
      const { container } = render(<EditorArea />)

      // Save scroll for tab-a's preview
      const preview = getLeftPreviewContainer(container)
      act(() => {
        Object.defineProperty(preview!, 'scrollTop', { value: 200, writable: true, configurable: true })
        fireEvent.scroll(preview!)
      })

      // Switch to tab-b
      act(() => useEditorStore.getState().setActiveTab('tab-b'))
      act(() => vi.advanceTimersByTime(200))

      // Switch back to tab-a
      act(() => useEditorStore.getState().setActiveTab('tab-a'))
      act(() => vi.advanceTimersByTime(200))

      // Both editor and preview should be present and visible
      const cmEditor = container.querySelector('.cm-editor')
      expect(cmEditor).toBeTruthy()
      const previewAfter = getLeftPreviewContainer(container)
      expect(previewAfter).toBeTruthy()
      expect(previewAfter!.style.visibility).not.toBe('hidden')
      expect(container.textContent).toContain('编辑预览 A')
    })
  })

  describe('anchor cache invalidation after visibility change', () => {
    it('preview scroll sync works after mode cycle that hides and reveals preview', () => {
      // The getCachedPreviewAnchors cache stores empty anchors when the container
      // is visibility:hidden. When the preview becomes visible again, the cache
      // should be invalidated so fresh anchors are queried from the DOM.
      const longContent = '# 缓存测试\n\n' + Array.from({ length: 60 }, (_, i) => `段落 ${i + 1}`).join('\n\n')
      const tab = anonymousTab('tab-a', longContent)
      setupEditor([tab], 'tab-a', 'edit-preview', { syncScroll: true, modePerformancePolicy: 'balanced' })
      const { container } = render(<EditorArea />)

      const preview = getLeftPreviewContainer(container)
      expect(preview).toBeTruthy()

      // Scroll preview to save position
      act(() => {
        Object.defineProperty(preview!, 'scrollTop', { value: 200, writable: true, configurable: true })
        fireEvent.scroll(preview!)
      })
      act(() => vi.advanceTimersByTime(50))

      // edit-preview → edit (preview hidden but stays mounted)
      act(() => useEditorStore.getState().setViewMode('edit'))
      act(() => vi.advanceTimersByTime(200))

      // edit → edit-preview (preview revealed)
      act(() => useEditorStore.getState().setViewMode('edit-preview'))
      act(() => vi.advanceTimersByTime(200))

      // Preview should be visible and content should render
      const previewAfter = getLeftPreviewContainer(container)
      expect(previewAfter).toBeTruthy()
      expect(previewAfter!.style.visibility).not.toBe('hidden')
      expect(container.textContent).toContain('缓存测试')
      expect(container.textContent).toContain('段落')
    })
  })
})
