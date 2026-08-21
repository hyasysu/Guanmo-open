import { describe, expect, it, vi } from 'vitest'
import { resolveDirectRagSources, streamFinalAnswer } from '@/services/aiChatFlow'
import { createSourceReferenceRegistry } from '@/services/ai/sourceReferences'
import type { AiProvider, ChatMessage, ChatMessageSource } from '@/services/ai/types'

describe('streamFinalAnswer context overflow retry', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'current question' },
  ]

  it('sends the original messages first and retries once on context overflow', async () => {
    const chat = vi.fn()
    let callCount = 0
    const client: Pick<AiProvider, 'chat' | 'streamChat'> = {
      chat: chat.mockImplementation(async () => {
        callCount++
        if (callCount === 1) throw new Error('context length exceeded')
        return { role: 'assistant', content: 'retry answer' }
      }),
      streamChat: vi.fn(),
    }

    const updates: string[] = []
    await streamFinalAnswer({
      client: client as AiProvider,
      messages,
      streamEnabled: false,
      onUpdate: (content) => updates.push(content),
      isCancelled: () => false,
    })

    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[0][0].messages).toEqual(messages)
    expect(chat.mock.calls[1][0].messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'current question' },
    ])
    expect(updates).toEqual(['retry answer'])
  })

  it('does not retry on non-overflow errors', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('network error'))
    const client: Pick<AiProvider, 'chat' | 'streamChat'> = {
      chat,
      streamChat: vi.fn(),
    }

    await expect(streamFinalAnswer({
      client: client as AiProvider,
      messages,
      streamEnabled: false,
      onUpdate: () => {},
      isCancelled: () => false,
    })).rejects.toThrow('network error')

    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('does not retry when cancelled', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('context length exceeded'))
    const client: Pick<AiProvider, 'chat' | 'streamChat'> = {
      chat,
      streamChat: vi.fn(),
    }

    await expect(streamFinalAnswer({
      client: client as AiProvider,
      messages,
      streamEnabled: false,
      onUpdate: () => {},
      isCancelled: () => true,
    })).rejects.toThrow('context length exceeded')

    expect(chat).toHaveBeenCalledTimes(1)
  })
})

describe('Direct RAG source resolution', () => {
  const localSource: ChatMessageSource = {
    kind: 'local',
    filePath: 'C:\\anonymous\\note.md',
    fileName: 'note.md',
    startLine: 2,
    endLine: 4,
  }
  const webSource: ChatMessageSource = {
    kind: 'web',
    title: '匿名网页',
    url: 'https://example.com/anonymous',
  }

  it('uses only valid inline references in first-appearance order and keeps the full answer', () => {
    const content = '结论 [S2]，补充 [S1]，重复 [S2]，尾部仍是正文。'
    const resolved = resolveDirectRagSources(
      content,
      createSourceReferenceRegistry([localSource, webSource]),
      [localSource, webSource],
    )

    expect(resolved.content).toBe(content)
    expect(resolved.sources).toEqual([webSource, localSource])
  })

  it('keeps all candidate sources when the answer has no valid inline reference', () => {
    const candidates = [localSource, webSource]
    const resolved = resolveDirectRagSources(
      '只有正文，没有引用。',
      createSourceReferenceRegistry(candidates),
      candidates,
    )

    expect(resolved.hasValidReferences).toBe(false)
    expect(resolved.sources).toEqual(candidates)
  })
})
