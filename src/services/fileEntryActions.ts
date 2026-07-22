import { useEditorStore, type Tab } from '@/stores/editorStore'
import { scheduleMarkdownDocumentIndex } from '@/services/rag/indexer'
import { saveFileAs } from '@/services/fileSystem'
import { basenamePath, dirnamePath, fileExists, isTauri, joinPath, renameFile } from '@/hooks/useTauri'
import { isSameFilePath } from '@/services/pathIdentity'
import { describeFileOperationError } from '@/services/fileOperationErrors'
import { readRememberedFile } from '@/services/persistedFileAccess'
import { isWorkspaceDisplayFile } from '@/services/fileTree'

export function validateFileName(fileName: string): string | null {
  const value = fileName.trim()
  if (!value) return '名称不能为空'
  if (/[<>:"/\\|?*]/.test(value)) return '名称不能包含 < > : " / \\ | ? *'
  if (/[. ]$/.test(value)) return '名称不能以句点或空格结尾'
  return null
}

export async function renameFileEntry(path: string, nextName: string): Promise<string> {
  const name = nextName.trim()
  const validationError = validateFileName(name)
  if (validationError) throw new Error(validationError)
  if (!isWorkspaceDisplayFile(name)) throw new Error('仅支持使用 .md 文件名')
  if (await basenamePath(path) === name) return path

  const nextPath = await joinPath(await dirnamePath(path), name)
  if (await fileExists(nextPath)) {
    throw new Error('同一文件夹下已存在同名文件或文件夹')
  }
  try {
    await renameFile(path, nextPath)
  } catch (err) {
    throw new Error(describeFileOperationError(err, '重命名失败'))
  }
  useEditorStore.getState().renameFilePath(path, nextPath, name)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('guanmo:workspace-refresh'))
  }
  return nextPath
}

export async function saveTabAsFile(tab: Tab): Promise<void> {
  const result = await saveFileAs(tab.content)
  if (!result) return
  useEditorStore.getState().saveTabAs(tab.id, result.path, result.name, result.content)
  scheduleMarkdownDocumentIndex(result.path, result.name, result.content)
}

export async function saveExistingFileAs(path: string): Promise<void> {
  const state = useEditorStore.getState()
  const opened = state.tabs.find((tab) => isSameFilePath(tab.filePath, path))
  const content = opened?.content ?? await readRememberedFile(path)
  const result = await saveFileAs(content)
  if (!result) return
  state.addTab(result.path, result.name, result.content)
  scheduleMarkdownDocumentIndex(result.path, result.name, result.content)
}

export async function reloadOpenedTabFromDisk(tab: Tab): Promise<boolean> {
  if (!tab.filePath || !isTauri()) return false

  const hasUnsavedChanges = tab.modified || tab.content !== tab.savedContent
  if (hasUnsavedChanges && !window.confirm('当前文件有未保存修改，重新读取将丢失这些修改。是否继续？')) {
    return false
  }

  const content = await readRememberedFile(tab.filePath)
  useEditorStore.getState().reloadTabFromDisk(tab.id, content)
  scheduleMarkdownDocumentIndex(tab.filePath, tab.title, content)
  return true
}
