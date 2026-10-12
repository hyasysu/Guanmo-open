import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/services/ai/types'
const mocks = vi.hoisted(() => ({ loadTurns: vi.fn() }))
vi.mock('@/services/agent/conversationCommands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/agent/conversationCommands')>()),
  loadRecentConversationTurns: mocks.loadTurns,
}))
import { encodeChatMessageMetadata, useChatStore } from '@/stores/chatStore'
import { buildUserSelectionMap } from '@/components/ai/AiPanel'

describe('restored original selection association', () => {
  it('restores existing tags/offsets and matches explicit parentId across reordered history', async () => {
    const tags: ChatMessage['tags'] = [{ type: 'selection', title: 'A.md', filePath: 'C:/anonymous/A.md', content: '恢复的当轮原文', preview: '恢复片段', startLine: 3, endLine: 4, selectionFrom: 8, selectionTo: 22 }]
    const base = { session_id: 'session-1', session_title: '匿名会话', created_at: 1 }
    mocks.loadTurns.mockResolvedValue([
      { ...base, id: 'assistant-1', parent_id: 'user-1', role: 'assistant', content: '回复 [S1]', metadata: null },
      { ...base, id: 'user-2', parent_id: null, role: 'user', content: '第二问题', metadata: null },
      { ...base, id: 'user-1', parent_id: null, role: 'user', content: '原问题', metadata: encodeChatMessageMetadata({ role: 'user', content: '原问题', tags }) },
      { ...base, id: 'assistant-2', parent_id: 'user-2', role: 'assistant', content: '第二回复', metadata: null },
    ])
    useChatStore.setState({ messages: [], historyOffset: 0, hasMoreHistory: true })
    await useChatStore.getState().loadMoreHistory()
    const messages = useChatStore.getState().messages
    const selectionsById = buildUserSelectionMap(messages)
    const assistant = messages.find((message) => message.id === 'assistant-1')!
    expect(selectionsById.get(assistant.parentId!)).toEqual([{
      title: 'A.md', text: '恢复的当轮原文', filePath: 'C:/anonymous/A.md', startLine: 3, endLine: 4,
      selectionFrom: 8, selectionTo: 22, truncated: false, previewOnly: false,
    }])
    expect(selectionsById.get('user-2')).toEqual([])
  })
})
