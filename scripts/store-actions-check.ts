import assert from 'node:assert/strict'
import { useAppStore } from '../src/stores/appStore'
import { useChatStore } from '../src/stores/chatStore'
import { useEditorStore } from '../src/stores/editorStore'
import { applyPendingEditCommand } from '../src/services/pendingEditCommand'
import type { EditConfirmation } from '../src/services/ai/types'

const baseTab = {
  id: 'tab-a',
  title: 'a.md',
  filePath: 'D:/notes/a.md',
  content: 'alpha beta gamma',
  savedContent: 'alpha beta gamma',
  originalContent: 'alpha beta gamma',
  modified: false,
}

useEditorStore.setState({ tabs: [baseTab], activeTabId: baseTab.id })
useEditorStore.getState().updateTabContent(baseTab.id, 'changed')
useEditorStore.getState().markTabSaved(baseTab.id, 'stale')
assert.equal(useEditorStore.getState().tabs[0].modified, true, 'stale save must not clear modified state')
assert.equal(useEditorStore.getState().tabs[0].savedContent, 'stale', 'stale save must record the actual disk snapshot')
useEditorStore.getState().markTabSaved(baseTab.id, 'changed')
assert.equal(useEditorStore.getState().tabs[0].modified, false)

useAppStore.setState({ aiPanelOpen: true })
useAppStore.getState().closeAiPanel()
assert.equal(useAppStore.getState().aiPanelOpen, false)

const pendingEdit: EditConfirmation = {
  id: 'edit-a',
  messageId: 'message-a',
  oldText: 'beta',
  newText: 'BETA',
  tabId: baseTab.id,
  tabTitle: baseTab.title,
  replaceFrom: 6,
  replaceTo: 10,
  status: 'pending',
}
useEditorStore.setState({ tabs: [baseTab], activeTabId: baseTab.id })
useChatStore.setState({
  messages: [{ id: 'message-a', role: 'assistant', content: 'edit', editConfirmation: pendingEdit }],
  pendingEdit,
  saveCurrentSession: async () => {},
})
assert.equal(applyPendingEditCommand(pendingEdit.id), true)
assert.equal(useEditorStore.getState().tabs[0].content, 'alpha BETA gamma')
assert.equal(useChatStore.getState().pendingEdit?.status, 'applied')

useChatStore.getState().resetHistoryState()
const resetChat = useChatStore.getState()
assert.deepEqual(resetChat.messages, [])
assert.equal(resetChat.streaming, false)
assert.equal(resetChat.hasMoreHistory, false)

console.log('store action checks passed')
