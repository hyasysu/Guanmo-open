import type { ChatMessageSource } from '@/services/ai/types'
import type { AgentResult, AgentStep } from './types'
import { stripToolCallJson } from './toolCallParser'
import { createContextMeta } from '@/services/aiChatMessages'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sourceFileName(filePath: string, fallback?: string): string {
  return filePath.split(/[/\\]/).pop() || fallback || filePath
}

export function extractKnowledgeSourcesFromSteps(steps: AgentStep[]): ChatMessageSource[] {
  const sources: ChatMessageSource[] = []
  const seen = new Set<string>()

  for (const step of steps) {
    if (step.type !== 'observation') continue
    try {
      const parsed = JSON.parse(step.content)
      if (!isPlainObject(parsed) || !Array.isArray(parsed.results)) continue

      for (const item of parsed.results) {
        if (!isPlainObject(item)) continue
        if (
          typeof item.filePath !== 'string'
          || typeof item.startLine !== 'number'
          || typeof item.endLine !== 'number'
        ) {
          continue
        }
        const key = `${item.filePath}:${item.startLine}:${item.endLine}`
        if (seen.has(key)) continue
        seen.add(key)
        sources.push({
          kind: 'local',
          filePath: item.filePath,
          fileName: sourceFileName(item.filePath, typeof item.title === 'string' ? item.title : undefined),
          titlePath: Array.isArray(item.titlePath)
            ? item.titlePath.filter((part): part is string => typeof part === 'string')
            : undefined,
          heading: typeof item.heading === 'string' ? item.heading : undefined,
          startLine: item.startLine,
          endLine: item.endLine,
        })
      }
    } catch {
      // 非知识库 observation 不携带 JSON 结果。
    }
  }

  return sources
}

export function buildAgentResultPresentation(result: AgentResult, tagCount: number) {
  const sources = result.sources?.length
    ? result.sources
    : extractKnowledgeSourcesFromSteps(result.steps)
  return {
    sources,
    contextMeta: createContextMeta({
      tagCount,
      ragSourceCount: sources.length,
      webSearchUsed: result.steps.some(
        (step) => step.type === 'action' && step.toolName === 'web_search'
      ),
    }),
    answer: stripToolCallJson(result.answer) || '已生成修改确认卡片，请在下方确认。',
  }
}

export function toLocalMessageSources(sources: Array<{
  filePath: string
  fileName: string
  titlePath?: string[]
  heading?: string
  startLine: number
  endLine: number
}>): ChatMessageSource[] {
  return sources.map((source) => ({
    kind: 'local',
    filePath: source.filePath,
    fileName: source.fileName,
    titlePath: source.titlePath,
    heading: source.heading,
    startLine: source.startLine,
    endLine: source.endLine,
  }))
}
