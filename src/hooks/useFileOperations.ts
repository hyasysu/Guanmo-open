import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { openFile } from '@/services/fileSystem'
import { scheduleMarkdownDocumentIndex } from '@/services/rag/indexer'
import { isSameFilePath } from '@/services/pathIdentity'
import { toast } from '@/services/toast'
import { describeFileOperationError } from '@/services/fileOperationErrors'
import { isTauri } from '@/hooks/useTauri'
import { getRuntimeCapabilities } from '@/services/runtimeCapabilities'
import { saveActiveDocument, saveDocument } from '@/services/documentSave'

export function useFileOperations() {
  const addTab = useEditorStore((s) => s.addTab)
  const createNewDocument = useEditorStore((s) => s.createNewDocument)
  const tabs = useEditorStore((s) => s.tabs)
  const editor = useSettingsStore((s) => s.editor)
  const autoSaveTimersRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; content: string }>>(new Map())

  const handleNewFile = useCallback(() => {
    createNewDocument()
  }, [createNewDocument])

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
        scheduleMarkdownDocumentIndex(file.path, file.name, file.content)
      }
    } catch (err) {
      console.error('Open file failed:', err)
      toast.error(describeFileOperationError(err, '打开文件失败'))
    }
  }, [addTab, tabs])

  const handleSaveFile = saveActiveDocument

  // Auto-save effect
  useEffect(() => {
    const clearAutoSaveTimers = () => {
      for (const { timer } of autoSaveTimersRef.current.values()) {
        clearTimeout(timer)
      }
      autoSaveTimersRef.current.clear()
    }

    if ((!isTauri() && !getRuntimeCapabilities().browserFileWrite) || !editor.autoSave) {
      clearAutoSaveTimers()
      return
    }

    const delay = editor.autoSaveDelay || 1000

    const scheduleTabSave = (tabId: string, content: string) => {
      const timer = setTimeout(async () => {
        autoSaveTimersRef.current.delete(tabId)
        const state = useEditorStore.getState()
        const tab = state.tabs.find((t) => t.id === tabId)
        if (!tab?.modified || !tab.filePath || tab.content !== content) return

        // Shared coordinator owns serialization, retry budget and completion effects.
        try { await saveDocument(tab.id, 'auto') } catch { /* coordinator reports auto-save failures */ }
      }, delay)

      autoSaveTimersRef.current.set(tabId, { timer, content })
    }

    const modifiedTabIds = new Set<string>()
    for (const tab of tabs) {
      if (!tab.modified || !tab.filePath) continue
      modifiedTabIds.add(tab.id)
      const existing = autoSaveTimersRef.current.get(tab.id)
      if (existing?.content === tab.content) continue
      if (existing) {
        clearTimeout(existing.timer)
      }
      scheduleTabSave(tab.id, tab.content)
    }

    for (const [tabId, { timer }] of autoSaveTimersRef.current) {
      if (modifiedTabIds.has(tabId)) continue
      clearTimeout(timer)
      autoSaveTimersRef.current.delete(tabId)
    }

    return clearAutoSaveTimers
  }, [editor.autoSave, editor.autoSaveDelay, tabs])

  return { handleNewFile, handleOpenFile, handleSaveFile }
}
