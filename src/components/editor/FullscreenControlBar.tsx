import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useEditorStore, type Tab } from '@/stores/editorStore'
import { useAppStore } from '@/stores/appStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useChatStore } from '@/stores/chatStore'
import { addFileContextTag } from '@/services/aiContext'
import { indexMarkdownDocument } from '@/services/rag/indexer'
import { isSameFilePath } from '@/services/pathIdentity'
import { renameFileEntry, saveTabAsFile, validateFileName } from '@/services/fileEntryActions'
import { describeFileOperationError } from '@/services/fileOperationErrors'
import { toast } from '@/services/toast'
import { ContextMenu, ContextMenuGroupTitle, ContextMenuItem, ContextMenuSeparator } from '@/components/common/ContextMenu'
import { useFullscreen } from '@/hooks/useFullscreen'

type ViewMode = 'edit' | 'preview' | 'edit-preview' | 'dual-preview' | 'diff-preview'

const MODES: Array<{ key: ViewMode; label: string }> = [
  { key: 'edit', label: '编辑' },
  { key: 'preview', label: '预览' },
  { key: 'edit-preview', label: '分屏' },
  { key: 'dual-preview', label: '对照' },
  { key: 'diff-preview', label: 'Diff' },
]

export function FullscreenControlBar() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const viewMode = useEditorStore((s) => s.viewMode)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  const closeTab = useEditorStore((s) => s.closeTab)
  const setRightPaneTabId = useEditorStore((s) => s.setRightPaneTabId)
  const togglePinTab = useEditorStore((s) => s.togglePinTab)
  const favorites = useEditorStore((s) => s.favorites)
  const aiPanelOpen = useAppStore((s) => s.aiPanelOpen)
  const toggleAiPanel = useAppStore((s) => s.toggleAiPanel)
  const theme = useSettingsStore((s) => s.appearance.theme)
  const { exitFullscreen } = useFullscreen()
  const [visible, setVisible] = useState(false)
  const [tabMode, setTabMode] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const hideTimerRef = useRef<number | null>(null)
  const renameCancelledRef = useRef(false)
  const renameSubmittingRef = useRef(false)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const showBar = useCallback(() => {
    clearHideTimer()
    setVisible(true)
  }, [clearHideTimer])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false)
      if (!contextMenu) setTabMode(false)
    }, tabMode ? 2200 : 700)
  }, [clearHideTimer, contextMenu, tabMode])

  useEffect(() => () => clearHideTimer(), [clearHideTimer])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[data-editor-search-overlay]')) return
      if (contextMenu) {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu(null)
        return
      }
      if (tabMode) {
        e.preventDefault()
        e.stopPropagation()
        setTabMode(false)
        setVisible(true)
        return
      }
      if (useAppStore.getState().aiPanelOpen) {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.setState({ aiPanelOpen: false })
        return
      }
      e.preventDefault()
      e.stopPropagation()
      void exitFullscreen()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [contextMenu, exitFullscreen, tabMode])

  const toggleTheme = useCallback(() => {
    useSettingsStore.getState().updateAppearanceSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
  }, [theme])

  const contextTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) : null

  const handleContextAction = useCallback(async (action: string) => {
    if (!contextMenu) return
    const tabId = contextMenu.tabId
    setContextMenu(null)

    switch (action) {
      case 'close':
        closeTab(tabId)
        break
      case 'closeOthers':
        tabs.filter((tab) => tab.id !== tabId && !tab.pinned).forEach((tab) => closeTab(tab.id))
        break
      case 'closeRight': {
        const index = tabs.findIndex((tab) => tab.id === tabId)
        tabs.slice(index + 1).filter((tab) => !tab.pinned).forEach((tab) => closeTab(tab.id))
        break
      }
      case 'closeAll':
        tabs.filter((tab) => !tab.pinned).forEach((tab) => closeTab(tab.id))
        break
      case 'copyPath':
        if (contextTab?.filePath) await navigator.clipboard.writeText(contextTab.filePath)
        break
      case 'copyContent':
        if (contextTab) await navigator.clipboard.writeText(contextTab.content)
        break
      case 'revealFile':
        if (contextTab?.filePath) {
          try {
            await invoke('reveal_file_in_folder', { path: contextTab.filePath })
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err || '打开文件位置失败'))
          }
        }
        break
      case 'addToAi':
        if (contextTab) addFileContextTag({ title: contextTab.title, filePath: contextTab.filePath })
        break
      case 'aiSummarize':
        if (contextTab) {
          addFileContextTag({ title: contextTab.title, filePath: contextTab.filePath })
          useChatStore.getState().setDraftInput(`请总结文件「${contextTab.title}」的内容`)
        }
        break
      case 'openInRightPane':
        setRightPaneTabId(tabId)
        if (viewMode !== 'dual-preview') setViewMode('dual-preview')
        break
      case 'pinTab':
        togglePinTab(tabId)
        break
      case 'reindexRag':
        if (contextTab?.filePath) indexMarkdownDocument(contextTab.filePath, contextTab.title, contextTab.content)
        break
      case 'rename':
        if (contextTab?.filePath) {
          renameCancelledRef.current = false
          setRenamingTabId(contextTab.id)
          setRenameValue(contextTab.title)
        }
        break
      case 'saveAs':
        if (contextTab) {
          try {
            await saveTabAsFile(contextTab)
            toast.success('已另存为')
          } catch (err) {
            toast.error(describeFileOperationError(err, '另存为失败'))
          }
        }
        break
    }
  }, [closeTab, contextMenu, contextTab, setRightPaneTabId, setViewMode, tabs, togglePinTab, viewMode])

  const commitRename = useCallback(async (tab: Tab) => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      return
    }
    if (renameSubmittingRef.current || !tab.filePath) {
      setRenamingTabId(null)
      return
    }
    const error = validateFileName(renameValue)
    if (error) {
      toast.error(error)
      return
    }
    renameSubmittingRef.current = true
    try {
      await renameFileEntry(tab.filePath, renameValue)
      renameCancelledRef.current = true
      setRenamingTabId(null)
      toast.success('已重命名')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重命名失败')
    } finally {
      renameSubmittingRef.current = false
    }
  }, [renameValue])

  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return 0
  })

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-40 h-7" onMouseEnter={showBar} />
      <div
        className={`fixed left-1/2 top-3 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onMouseEnter={showBar}
        onMouseLeave={scheduleHide}
      >
        <div className="gm-instant-color flex max-w-full items-center gap-1 rounded-full border border-gm-border/70 bg-gm-surface/82 px-2 py-1 shadow-lg backdrop-blur-xl">
          {tabMode ? (
            <>
              <BubbleButton onClick={() => setTabMode(false)} title="返回">
                ←
              </BubbleButton>
              <div className="flex max-w-[min(70vw,760px)] items-center gap-1 overflow-x-auto px-1">
                {sortedTabs.map((tab) => {
                  const active = tab.id === activeTabId
                  const isFav = tab.filePath ? favorites.some((path) => isSameFilePath(path, tab.filePath)) : false
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setVisible(true)
                        setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
                      }}
                      className={`flex h-8 max-w-[180px] flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-caption transition-colors ${
                        active
                          ? 'bg-gm-primary-subtle text-gm-primary font-bold'
                          : 'text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text'
                      }`}
                      title={tab.title}
                    >
                      <span className="truncate">{renamingTabId === tab.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => void commitRename(tab)}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') void commitRename(tab)
                            if (e.key === 'Escape') {
                              renameCancelledRef.current = true
                              setRenamingTabId(null)
                            }
                          }}
                          className="w-28 bg-transparent text-caption outline-none"
                        />
                      ) : tab.title}</span>
                      {tab.pinned && <span className="text-gm-primary">◆</span>}
                      {isFav && <span className="text-gm-warning">★</span>}
                      {tab.modified && <span className="h-1.5 w-1.5 rounded-full bg-gm-primary" />}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <BubbleButton onClick={() => setTabMode(true)} title="标签">
                标签
              </BubbleButton>
              <Separator />
              {MODES.map((mode) => (
                <BubbleButton
                  key={mode.key}
                  active={viewMode === mode.key}
                  onClick={() => setViewMode(mode.key)}
                >
                  {mode.label}
                </BubbleButton>
              ))}
              <Separator />
              <BubbleButton onClick={toggleAiPanel} active={aiPanelOpen} title="切换 AI 助手">
                AI
              </BubbleButton>
              <BubbleButton onClick={toggleTheme} title={theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'}>
                主题
              </BubbleButton>
              <BubbleButton onClick={() => void exitFullscreen()} title="退出全屏">
                退出
              </BubbleButton>
            </>
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu position={contextMenu} onClose={() => setContextMenu(null)} minWidth={176} maxWidth={176}>
          <ContextMenuGroupTitle>标签操作</ContextMenuGroupTitle>
          <ContextMenuItem onClick={() => handleContextAction('pinTab')}>
            {contextTab?.pinned ? '取消固定' : '固定标签'}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('openInRightPane')}>
            在右栏打开
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('rename')} disabled={!contextTab?.filePath}>
            重命名
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('saveAs')}>
            另存为
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuGroupTitle>AI 助手</ContextMenuGroupTitle>
          <ContextMenuItem onClick={() => handleContextAction('aiSummarize')}>
            AI 总结该文件
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('addToAi')}>
            添加文件到 AI 上下文
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuGroupTitle>复制与索引</ContextMenuGroupTitle>
          <ContextMenuItem onClick={() => handleContextAction('copyContent')}>
            复制内容
          </ContextMenuItem>
          {contextTab?.filePath && (
            <ContextMenuItem onClick={() => handleContextAction('copyPath')}>
              复制路径
            </ContextMenuItem>
          )}
          {contextTab?.filePath && (
            <ContextMenuItem onClick={() => handleContextAction('revealFile')}>
              打开文件位置
            </ContextMenuItem>
          )}
          {contextTab?.filePath && (
            <ContextMenuItem onClick={() => handleContextAction('reindexRag')}>
              重新索引 RAG
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuGroupTitle>关闭标签</ContextMenuGroupTitle>
          <ContextMenuItem onClick={() => handleContextAction('close')}>
            关闭
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('closeOthers')}>
            关闭其他
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('closeRight')}>
            关闭右侧标签
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction('closeAll')}>
            全部关闭
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  )
}

function BubbleButton({
  children,
  active = false,
  onClick,
  title,
}: {
  children: React.ReactNode
  active?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-8 rounded-full px-3 text-caption font-bold transition-colors ${
        active
          ? 'bg-gm-primary text-white shadow-sm'
          : 'text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text'
      }`}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <div className="mx-1 h-5 w-px bg-gm-border-subtle" />
}
