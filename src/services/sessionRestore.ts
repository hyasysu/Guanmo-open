import type { Tab } from '@/stores/editorStore'
import { readRememberedFile } from '@/services/persistedFileAccess'
import { isWorkspaceDisplayFile } from '@/services/fileTree'

interface RestorePersistedTabsOptions {
  activeTabId?: string | null
  concurrency?: number
  readFile?: (path: string) => Promise<string>
  onTabRestored?: (tab: Tab, index: number) => void
}

export function getRestorablePersistedTabs(tabs: Tab[]): Tab[] {
  return tabs.filter((tab) => !tab.filePath || isWorkspaceDisplayFile(tab.filePath))
}

export function mergeBackgroundRestoredTab(current: Tab, original: Tab, restored: Tab): Tab {
  if (current.id !== original.id || current.filePath !== original.filePath) return current
  const unchangedSinceStartup =
    current.content === original.content
    && current.savedContent === original.savedContent
    && current.originalContent === original.originalContent
    && current.modified === original.modified
  if (unchangedSinceStartup) return restored
  if (!current.modified) return current
  return {
    ...current,
    savedContent: restored.savedContent,
    modified: current.content !== restored.savedContent,
  }
}

async function restorePersistedTab(
  tab: Tab,
  readFile: (path: string) => Promise<string>
): Promise<Tab> {
  if (!tab.filePath) {
    return {
      ...tab,
      originalContent: tab.originalContent ?? tab.savedContent ?? tab.content,
    }
  }

  try {
    const diskContent = await readFile(tab.filePath)
    if (tab.modified) {
      return {
        ...tab,
        originalContent: tab.originalContent ?? tab.savedContent ?? tab.content,
        savedContent: diskContent,
        modified: tab.content !== diskContent,
      }
    }
    return {
      ...tab,
      content: diskContent,
      savedContent: diskContent,
      originalContent: diskContent,
      modified: false,
    }
  } catch (error) {
    console.warn(`[SessionRestore] Failed to read file ${tab.filePath}:`, error)
    return {
      ...tab,
      originalContent: tab.originalContent ?? tab.savedContent ?? tab.content,
    }
  }
}

/**
 * 恢复持久化标签页。
 * 未修改的磁盘文件刷新为当前文件内容；有未保存修改的标签保留持久化内容，避免丢失草稿。
 */
export async function restorePersistedTabs(
  tabs: Tab[],
  options: RestorePersistedTabsOptions = {}
): Promise<Tab[]> {
  const restorableTabs = getRestorablePersistedTabs(tabs)
  const restored = [...restorableTabs]
  const readFile = options.readFile ?? readRememberedFile
  const activeIndex = restorableTabs.findIndex((tab) => tab.id === options.activeTabId)
  const pendingIndexes = restorableTabs.map((_, index) => index)
  if (activeIndex > 0) {
    pendingIndexes.splice(activeIndex, 1)
    pendingIndexes.unshift(activeIndex)
  }
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, pendingIndexes.length || 1))

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (pendingIndexes.length > 0) {
      const index = pendingIndexes.shift()
      if (index === undefined) return
      const tab = await restorePersistedTab(restorableTabs[index], readFile)
      restored[index] = tab
      options.onTabRestored?.(tab, index)
    }
  }))

  return restored
}
