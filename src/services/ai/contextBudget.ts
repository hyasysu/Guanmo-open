import type { ChatMessage } from './types'

export function estimateModelTokens(text: string): number {
  let ascii = 0
  let nonAscii = 0
  for (const char of text) {
    if (char.codePointAt(0)! <= 0x7f) ascii += 1
    else nonAscii += 1
  }
  return Math.ceil(ascii / 4) + nonAscii
}

export function estimateMessageTokens(message: ChatMessage): number {
  return 4 + estimateModelTokens(message.content)
}

export function isModelContextOverflowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:context length|context window|maximum context|too many tokens|token limit|上下文.*(?:超限|过长)|输入.*过长)/i.test(message)
}

/**
 * 从最旧的完整问答轮次开始移除消息，用于 Provider 真实返回上下文超限时
 * 做一次性无副作用降级重试。
 *
 * 保留：system 消息、当前问题，以及 keepMessage 判定为真的消息。
 * 完整轮次定义为：一条 user 消息及其后直到下一条 user 之前的连续消息。
 */
export function dropOldestCompleteTurns(
  messages: ChatMessage[],
  options: { keepMessage?: (message: ChatMessage) => boolean } = {},
): ChatMessage[] {
  if (messages.length <= 1) return messages.slice()

  let currentUserIndex = messages.length - 1
  while (currentUserIndex >= 0 && messages[currentUserIndex].role !== 'user') {
    currentUserIndex -= 1
  }
  if (currentUserIndex <= 0) return messages.slice()

  let oldestUserIndex = -1
  for (let i = 0; i < currentUserIndex; i += 1) {
    if (messages[i].role === 'user') {
      oldestUserIndex = i
      break
    }
  }
  if (oldestUserIndex < 0) return messages.slice()

  let turnEnd = currentUserIndex
  for (let i = oldestUserIndex + 1; i < currentUserIndex; i += 1) {
    if (messages[i].role === 'user') {
      turnEnd = i
      break
    }
  }

  const keep = options.keepMessage ?? (() => false)
  return messages.filter((message, index) => {
    if (index < oldestUserIndex || index >= turnEnd) return true
    if (message.role === 'system') return true
    return keep(message)
  })
}
