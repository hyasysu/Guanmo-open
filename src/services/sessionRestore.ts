import type { Tab } from '@/stores/editorStore'
import { authorizeSelectedPath, readFile } from '@/hooks/useTauri'

/**
 * 恢复持久化标签页。
 * 未修改的磁盘文件刷新为当前文件内容；有未保存修改的标签保留持久化内容，避免丢失草稿。
 */
export async function restorePersistedTabs(tabs: Tab[]): Promise<Tab[]> {
  const restored: Tab[] = []

  for (const tab of tabs) {
    if (!tab.filePath) {
      restored.push(tab)
      continue
    }

    try {
      await authorizeSelectedPath(tab.filePath)
      const diskContent = await readFile(tab.filePath)
      if (tab.modified) {
        restored.push({
          ...tab,
          savedContent: diskContent,
          modified: tab.content !== diskContent,
        })
      } else {
        restored.push({
          ...tab,
          content: diskContent,
          savedContent: diskContent,
          modified: false,
        })
      }
    } catch {
      if (tab.modified) {
        restored.push(tab)
      }
    }
  }

  return restored
}
