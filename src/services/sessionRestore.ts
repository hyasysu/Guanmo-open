import { exists } from '@tauri-apps/plugin-fs'
import type { Tab } from '@/stores/editorStore'

/**
 * 验证持久化的标签页，移除文件不存在的标签
 */
export async function validatePersistedTabs(tabs: Tab[]): Promise<Tab[]> {
  const valid: Tab[] = []
  for (const tab of tabs) {
    if (!tab.filePath) {
      valid.push(tab)
      continue
    }
    try {
      if (await exists(tab.filePath)) {
        valid.push(tab)
      }
    } catch {
      // 文件不存在，跳过
    }
  }
  return valid
}
