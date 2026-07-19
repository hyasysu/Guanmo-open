import type { Tab } from '@/stores/editorStore'

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
