import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { openFile, saveFile } from '@/services/fileSystem'
import { indexMarkdownDocument } from '@/services/rag/indexer'
import { isSameFilePath } from '@/services/pathIdentity'
import { toast } from '@/services/toast'
import { describeFileOperationError } from '@/services/fileOperationErrors'

export function useFileOperations() {
  const { addTab, tabs, activeTabId } = useEditorStore()
  const { editor } = useSettingsStore()
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveRetriesRef = useRef<Map<string, number>>(new Map())

  const handleNewFile = useCallback(() => {
    addTab(undefined, '未命名.md')
  }, [addTab])

  const handleOpenFile = useCallback(async () => {
    try {
      const file = await openFile()
      if (file) {
        // Check if file is already open
        const existing = tabs.find((t) => isSameFilePath(t.filePath, file.path))
        if (existing) {
          useEditorStore.getState().setActiveTab(existing.id)
          return
        }
        addTab(file.path, file.name, file.content)
        indexMarkdownDocument(file.path, file.name, file.content)
      }
    } catch (err) {
      console.error('Open file failed:', err)
      toast.error('打开文件失败')
    }
  }, [addTab, tabs])

  const handleSaveFile = useCallback(async () => {
    const state = useEditorStore.getState()
    const tab = state.tabs.find((t) => t.id === state.activeTabId)
    if (!tab) return

    try {
      if (tab.filePath) {
        await saveFile(tab.filePath, tab.content)
        indexMarkdownDocument(tab.filePath, tab.title, tab.content)
        // Clear modified flag
        useEditorStore.setState((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id ? { ...t, savedContent: tab.content, modified: false } : t
          ),
        }))
        toast.success('已保存')
      } else {
        // Save As
        const { saveFileAs } = await import('@/services/fileSystem')
        const result = await saveFileAs(tab.content)
        if (result) {
          indexMarkdownDocument(result.path, result.name, result.content)
          useEditorStore.setState((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tab.id
                ? { ...t, filePath: result.path, title: result.name, savedContent: result.content, modified: false }
                : t
            ),
          }))
          toast.success('已保存')
        }
      }
    } catch (err) {
      console.error('Save file failed:', err)
      toast.error(describeFileOperationError(err, '保存失败'))
    }
  }, [])

  // Auto-save effect
  useEffect(() => {
    if (!editor.autoSave) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      autoSaveRetriesRef.current.clear()
      return
    }

    const checkAndSave = async () => {
      const state = useEditorStore.getState()
      const modifiedTabs = state.tabs.filter((t) => t.modified && t.filePath)
      const MAX_RETRIES = 3
      for (const tab of modifiedTabs) {
        const retries = autoSaveRetriesRef.current.get(tab.id) || 0
        if (retries >= MAX_RETRIES) continue
        try {
          await saveFile(tab.filePath!, tab.content)
          indexMarkdownDocument(tab.filePath, tab.title, tab.content)
          autoSaveRetriesRef.current.delete(tab.id)
          useEditorStore.setState((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tab.id ? { ...t, modified: false } : t
            ),
          }))
        } catch (err) {
          const nextRetries = retries + 1
          autoSaveRetriesRef.current.set(tab.id, nextRetries)
          console.error(`Auto-save failed for ${tab.title} (${nextRetries}/${MAX_RETRIES}):`, err)
          if (nextRetries >= MAX_RETRIES) {
            toast.error(`自动保存「${tab.title}」失败: ${describeFileOperationError(err, '保存失败')}`)
          } else {
            toast.warning(`自动保存失败: ${tab.title}，${describeFileOperationError(err, '保存失败')}`)
          }
        }
      }
    }

    const delay = editor.autoSaveDelay || 1000
    autoSaveTimerRef.current = setInterval(checkAndSave, delay)

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [editor.autoSave, editor.autoSaveDelay])

  return { handleNewFile, handleOpenFile, handleSaveFile }
}
