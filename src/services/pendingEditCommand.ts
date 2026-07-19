import { useChatStore } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'

export function applyPendingEditCommand(editId?: string): boolean {
  const chat = useChatStore.getState()
  const pendingEdit = editId
    ? chat.messages.find((message) => message.editConfirmation?.id === editId)?.editConfirmation
    : chat.pendingEdit
  if (!pendingEdit || pendingEdit.status !== 'pending') return false

  const editor = useEditorStore.getState()
  const tab = editor.tabs.find((current) => current.id === pendingEdit.tabId)
  const { replaceFrom, replaceTo } = pendingEdit
  const canApply = Boolean(
    tab
    && typeof replaceFrom === 'number'
    && typeof replaceTo === 'number'
    && tab.content.slice(replaceFrom, replaceTo) === pendingEdit.oldText,
  )
  if (!tab || !canApply || typeof replaceFrom !== 'number') {
    chat.setError('修改未应用：目标文本已变化，请重新发起修改确认。')
    return false
  }

  const nextContent = `${tab.content.slice(0, replaceFrom)}${pendingEdit.newText}${tab.content.slice(replaceFrom + pendingEdit.oldText.length)}`
  editor.updateTabContent(pendingEdit.tabId, nextContent)
  chat.completePendingEdit(pendingEdit)
  void chat.saveCurrentSession().catch((err) => {
    console.warn('[Chat] save edit confirmation failed:', err)
  })
  return true
}
