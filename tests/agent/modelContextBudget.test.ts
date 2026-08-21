import { describe, expect, it } from 'vitest'
import { dropOldestCompleteTurns, estimateMessageTokens, estimateModelTokens, isModelContextOverflowError } from '@/services/ai/contextBudget'
import type { ChatMessage } from '@/services/ai/types'

describe('contextBudget', () => {
  describe('isModelContextOverflowError', () => {
    it.each([
      ['context length exceeded'],
      ['context window too large'],
      ['maximum context length reached'],
      ['too many tokens'],
      ['token limit exceeded'],
      ['上下文超限'],
      ['输入过长'],
      ['This model context window is too large'],
    ])('detects overflow phrase: %s', (message) => {
      expect(isModelContextOverflowError(new Error(message))).toBe(true)
    })

    it('does not flag unrelated errors', () => {
      expect(isModelContextOverflowError(new Error('network error'))).toBe(false)
      expect(isModelContextOverflowError(new Error('invalid api key'))).toBe(false)
    })
  })

  describe('dropOldestCompleteTurns', () => {
    const systemMessage: ChatMessage = { role: 'system', content: 'system prompt' }

    it('keeps system and current user when dropping oldest turn', () => {
      const messages: ChatMessage[] = [
        systemMessage,
        { role: 'user', content: 'question 1' },
        { role: 'assistant', content: 'answer 1' },
        { role: 'user', content: 'question 2' },
        { role: 'assistant', content: 'answer 2' },
        { role: 'user', content: 'current question' },
      ]
      const result = dropOldestCompleteTurns(messages)
      expect(result).toEqual([
        systemMessage,
        { role: 'user', content: 'question 2' },
        { role: 'assistant', content: 'answer 2' },
        { role: 'user', content: 'current question' },
      ])
    })

    it('does not drop when there is only one user message', () => {
      const messages: ChatMessage[] = [
        systemMessage,
        { role: 'user', content: 'current question' },
      ]
      const result = dropOldestCompleteTurns(messages)
      expect(result).toEqual(messages)
    })

    it('keeps messages matched by keepMessage predicate', () => {
      const keepMessage = (message: ChatMessage) => message.content.includes('selection')
      const messages: ChatMessage[] = [
        systemMessage,
        { role: 'user', content: 'question 1' },
        { role: 'assistant', content: 'answer 1 with selection context' },
        { role: 'user', content: 'current question' },
      ]
      const result = dropOldestCompleteTurns(messages, { keepMessage })
      expect(result).toEqual([
        systemMessage,
        { role: 'assistant', content: 'answer 1 with selection context' },
        { role: 'user', content: 'current question' },
      ])
    })

    it('returns a shallow copy even when nothing is dropped', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'only' }]
      const result = dropOldestCompleteTurns(messages)
      expect(result).not.toBe(messages)
      expect(result).toEqual(messages)
    })
  })

  describe('token estimation', () => {
    it('counts non-ascii chars as one token each', () => {
      expect(estimateModelTokens('你好')).toBe(2)
    })

    it('estimates ascii tokens at roughly four chars per token', () => {
      expect(estimateModelTokens('hello world')).toBe(3)
    })

    it('adds message overhead', () => {
      expect(estimateMessageTokens({ role: 'user', content: 'hi' })).toBe(5)
    })
  })
})
