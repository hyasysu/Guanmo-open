export type MemoryRetrievalIntent = 'none' | 'weak' | 'strong'
export type MemoryScopeType = 'global' | 'project'

export interface MemoryPolicyRecord {
  id: string
  content: string
  status: string
  scopeType?: MemoryScopeType
  scopeKey?: string | null
  supersedesId?: string | null
  contentHash?: string | null
  embedding?: number[] | null
  embeddingModel?: string | null
  subject?: string | null
  factKey?: string | null
}

export function normalizeMemoryScopeKey(scopeType: MemoryScopeType, scopeKey?: string | null): string | null {
  if (scopeType === 'global') return null
  const normalized = (scopeKey || '').trim().replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  return normalized || null
}

export function classifyMemoryRetrievalIntent(query: string): MemoryRetrievalIntent {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return 'none'

  const strongSignals = [
    '我的偏好', '我的习惯', '我的风格', '我的地址', '我的住址', '我的位置',
    '我的称呼', '我的记忆', '我的项目约定', '我的长期目标', '你记得我', '你还记得我',
    '还记得我', '查询记忆', '搜索记忆', '检索记忆', '查看记忆', '调取记忆', 'remember me',
  ]
  if (strongSignals.some((signal) => normalized.includes(signal))) return 'strong'
  if (/(?:查询|搜索|检索|查看|调取).*记忆|你还?记得.*我/.test(normalized)) return 'strong'

  const weakSignals = [
    '之前', '上次', '以前', '曾经', '按我的习惯', '按我的偏好', '按我的风格', '项目约定',
    '这个项目的设定', '项目设定', '按照之前讨论的', '之前讨论的', '之前告诉过你', '记忆',
  ]
  if (weakSignals.some((signal) => normalized.includes(signal))) return 'weak'
  return /我(?:以前|曾经|之前)(说过|提过|告诉|建议|做过)|上次.*(?:方案|说过|提过|告诉|建议)/.test(normalized)
    ? 'weak'
    : 'none'
}

export function inferMemoryScope(category: string, workspacePath?: string | null): { scopeType: MemoryScopeType; scopeKey: string | null } {
  if (category === 'project' && workspacePath) {
    return { scopeType: 'project', scopeKey: normalizeMemoryScopeKey('project', workspacePath) }
  }
  return { scopeType: 'global', scopeKey: null }
}

export function isMemoryVisibleInScope(
  memory: Pick<MemoryPolicyRecord, 'scopeType' | 'scopeKey'>,
  workspacePath?: string | null
): boolean {
  if (memory.scopeType !== 'project') return true
  const currentScopeKey = normalizeMemoryScopeKey('project', workspacePath)
  return Boolean(currentScopeKey && memory.scopeKey === currentScopeKey)
}

export function filterInjectableMemories<T extends MemoryPolicyRecord>(memories: T[]): T[] {
  const supersededIds = new Set(
    memories
      .filter((memory) => memory.status === 'active' && memory.supersedesId)
      .map((memory) => memory.supersedesId as string)
  )
  return memories.filter((memory) => memory.status === 'active' && !supersededIds.has(memory.id))
}

export function findActiveFactConflict<T extends MemoryPolicyRecord>(
  memories: T[],
  fact: Pick<MemoryPolicyRecord, 'subject' | 'factKey' | 'scopeType' | 'scopeKey'>
): T | undefined {
  if (!fact.subject || !fact.factKey) return undefined
  return memories.find((memory) => (
    memory.status === 'active'
    && memory.subject === fact.subject
    && memory.factKey === fact.factKey
    && (memory.scopeType || 'global') === (fact.scopeType || 'global')
    && (memory.scopeKey || null) === (fact.scopeKey || null)
  ))
}

export function shouldExtractMemoryCandidate(userText: string): boolean {
  const text = userText.trim()
  if (!text) return false
  const explicitSave = /(?:记住|记下来|保存为长期记忆|以后记得|以后都|之后都)/.test(text)
  if (!explicitSave && /(?:今天|现在|这次|这轮|本轮|当前任务|临时|暂时|待会|稍后|马上)/.test(text)) {
    return false
  }
  if (!explicitSave && /(?:翻译|改写|润色|重写|仿写|编写|生成|创作|虚构|假设|举例|示例|角色扮演)/.test(text)) {
    return false
  }
  return [
    /(?:记住|记下来|保存为长期记忆|以后记得|以后都|之后都)/,
    /(?:我喜欢|我偏好|我的习惯|我的风格|默认用|每次都|总是)/,
    /(?:称呼我|叫我|我的称呼|用中文|中文回答)/,
    /(?:项目约定|项目规则|长期项目|目录职责|工程边界|技术栈)/,
    /(?:我正在学|我开始学|我学完了|学习进度|学习路线)/,
    /(?:我的背景|我的身份|我是.+(?:工程师|学生|设计师|作者|开发者))/,
  ].some((pattern) => pattern.test(text))
}

export function hasReusableEmbedding(
  memory: Pick<MemoryPolicyRecord, 'content' | 'contentHash' | 'embedding' | 'embeddingModel'>,
  embeddingModel?: string
): boolean {
  return Boolean(
    memory.embedding?.length
    && memory.contentHash === contentHash(memory.content)
    && memory.embeddingModel === (embeddingModel || null)
  )
}

export function contentHash(content: string): string {
  let hash = 2166136261
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
