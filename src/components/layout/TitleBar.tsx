import { useState, useEffect, useCallback, useRef } from 'react'
import { useEditorHistoryStore } from '@/stores/editorHistoryStore'
import { useSettingsStore, type ThemeId } from '@/stores/settingsStore'
import { THEME_OPTIONS } from '@/features/settings/ThemePicker'
import { getActiveEditorView } from '@/services/editorViewRef'
import { useFullscreen } from '@/hooks/useFullscreen'

import { isTauri } from '@/hooks/useTauri'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  const canUndo = useEditorHistoryStore((s) => s.canUndo)
  const canRedo = useEditorHistoryStore((s) => s.canRedo)
  const { isFullscreen, toggleFullscreen } = useFullscreen()

  useEffect(() => {
    if (!isTauri()) return

    let disposed = false
    let cleanup: (() => void) | undefined

    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const win = getCurrentWindow()

      win.isMaximized().then(setMaximized)

      win.onResized(() => {
        win.isMaximized().then(setMaximized)
      }).then((unlisten) => {
        if (disposed) {
          unlisten()
        } else {
          cleanup = unlisten
        }
      })
    }).catch((err) => {
      console.error('TitleBar: failed to initialize Tauri window:', err)
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    if (!themeMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (themeMenuRef.current?.contains(event.target as Node)) return
      setThemeMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setThemeMenuOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [themeMenuOpen])

  const handleMinimize = useCallback(() => {
    if (!isTauri()) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().minimize())
      .catch((err) => console.error('TitleBar: minimize failed:', err))
  }, [])

  const handleToggleMaximize = useCallback(() => {
    if (!isTauri()) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
      .catch((err) => console.error('TitleBar: toggleMaximize failed:', err))
  }, [])

  const handleClose = useCallback(() => {
    if (!isTauri()) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().close())
      .catch((err) => console.error('TitleBar: close failed:', err))
  }, [])

  const handleUndo = useCallback(() => {
    const view = getActiveEditorView()
    if (!view) return
    void import('@codemirror/commands').then(({ undo }) => {
      undo({ state: view.state, dispatch: view.dispatch })
    })
  }, [])

  const handleRedo = useCallback(() => {
    const view = getActiveEditorView()
    if (!view) return
    void import('@codemirror/commands').then(({ redo }) => {
      redo({ state: view.state, dispatch: view.dispatch })
    })
  }, [])

  const themeId = useSettingsStore((s) => s.appearance.themeId)
  const lastLightThemeId = useSettingsStore((s) => s.appearance.lastLightThemeId)
  const toggleTheme = useCallback(() => {
    const next = themeId === 'dark' ? lastLightThemeId : 'dark'
    useSettingsStore.getState().updateAppearanceSettings({ themeId: next })
  }, [lastLightThemeId, themeId])

  const applyTheme = useCallback((nextThemeId: ThemeId) => {
    useSettingsStore.getState().updateAppearanceSettings({ themeId: nextThemeId })
    setThemeMenuOpen(false)
  }, [])

  const activeThemeLabel = THEME_OPTIONS.find((option) => option.key === themeId)?.label ?? themeId

  return (
    <div className="h-[38px] flex items-center bg-gm-surface border-b border-gm-border-subtle select-none flex-shrink-0">
      {/* App branding */}
      <div className="flex items-center gap-2 pl-3 pr-2 flex-shrink-0">
        <span className="text-caption font-bold text-gm-text tracking-wide">观墨</span>
        {!isTauri() && (
          <span className="text-micro text-gm-text-disabled bg-gm-surface-elevated px-1.5 py-0.5 rounded">
            浏览器模式，多项功能和样式会有问题，推荐下载桌面版
          </span>
        )}
      </div>

      {/* Drag region */}
      <div
        data-tauri-drag-region=""
        className="flex-1 h-full"
      />

      {/* Undo/Redo + Window controls */}
      <div className="flex items-center h-full flex-shrink-0">
        {/* Undo */}
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className={`h-full w-10 flex items-center justify-center transition-colors ${
            canUndo ? 'text-gm-text-secondary hover:bg-gm-surface-hover' : 'text-gm-text-disabled cursor-not-allowed'
          }`}
          title="撤销 (Ctrl+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
          </svg>
        </button>
        {/* Redo */}
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className={`h-full w-10 flex items-center justify-center transition-colors ${
            canRedo ? 'text-gm-text-secondary hover:bg-gm-surface-hover' : 'text-gm-text-disabled cursor-not-allowed'
          }`}
          title="重做 (Ctrl+Y)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="h-full w-10 flex items-center justify-center text-gm-text-secondary hover:bg-gm-surface-hover transition-colors"
          title={themeId === 'dark' ? '切换为上次浅色主题' : '切换为深色主题'}
        >
          {themeId === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <div className="relative h-full" ref={themeMenuRef}>
          <button
            type="button"
            onClick={() => setThemeMenuOpen((open) => !open)}
            className={`h-full min-w-10 px-2 flex items-center justify-center gap-1 text-gm-text-secondary hover:bg-gm-surface-hover transition-colors ${
              themeMenuOpen ? 'bg-gm-surface-hover text-gm-text' : ''
            }`}
            title={`选择主题（当前：${activeThemeLabel}）`}
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="13.5" cy="6.5" r="2.5" />
              <circle cx="17.5" cy="10.5" r="2.5" />
              <circle cx="8.5" cy="7.5" r="2.5" />
              <circle cx="6.5" cy="12.5" r="2.5" />
              <path d="M12 22a8 8 0 0 0 8-8c0-3.5-4-7-8-10-4 3-8 6.5-8 10a8 8 0 0 0 8 8z" />
            </svg>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {themeMenuOpen && (
            <div
              role="menu"
              aria-label="选择主题"
              className="absolute right-0 top-full z-[60] mt-1 w-[220px] rounded-xl border border-gm-border bg-gm-surface-elevated py-1.5 shadow-lg"
            >
              {THEME_OPTIONS.map((option) => {
                const selected = option.key === themeId
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => applyTheme(option.key)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'bg-gm-primary-subtle text-gm-text'
                        : 'text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-caption font-medium text-gm-text">{option.label}</span>
                      <span className="block text-micro text-gm-text-tertiary">{option.description}</span>
                    </span>
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? 'border-gm-primary bg-gm-primary text-gm-text-on-primary'
                          : 'border-gm-border-subtle text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {/* Divider */}
        <div className="w-px h-5 bg-gm-border-subtle mx-1" />
        <button
          onClick={() => void toggleFullscreen()}
          data-product-tour="fullscreen"
          className="h-full w-12 flex items-center justify-center text-gm-text-secondary hover:bg-gm-surface-hover transition-colors"
          title={isFullscreen ? '退出全屏 F11' : '进入全屏 F11'}
        >
          {isFullscreen ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 1.5H1.5v3M7.5 1.5h3v3M4.5 10.5H1.5v-3M7.5 10.5h3v-3" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 4.5v-3h3M10.5 4.5v-3h-3M1.5 7.5v3h3M10.5 7.5v3h-3" />
            </svg>
          )}
        </button>
        {/* Window controls */}
        <button
          onClick={handleMinimize}
          className="h-full w-12 flex items-center justify-center text-gm-text-secondary hover:bg-gm-surface-hover transition-colors"
          title="最小化"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="h-full w-12 flex items-center justify-center text-gm-text-secondary hover:bg-gm-surface-hover transition-colors"
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            <svg width="12" height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M4.2 2.2h5.1v5.1" />
              <rect x="2.2" y="4.2" width="5.6" height="5.6" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="2.2" y="2.2" width="7.6" height="7.6" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="h-full w-12 flex items-center justify-center text-gm-text-secondary hover:bg-red-500 hover:text-white transition-colors"
          title="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
