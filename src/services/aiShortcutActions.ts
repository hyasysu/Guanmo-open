export interface AiShortcutAction {
  id: string
  label: string
  prompt: string
  enabled: boolean
}

export const AI_SHORTCUT_LABEL_MAX_LENGTH = 12
export const AI_SHORTCUT_PROMPT_MAX_LENGTH = 1000

const DEFAULT_AI_SHORTCUT_ACTIONS: readonly AiShortcutAction[] = [
  { id: 'explain', label: 'AI 解释这段', prompt: '请解释这段内容', enabled: true },
  {
    id: 'explain-with-context',
    label: 'AI 结合上下文解释',
    prompt: '请结合上下文解释这段内容，优先读取选区附近内容，不要默认阅读全文',
    enabled: true,
  },
  { id: 'summarize', label: 'AI 总结这段', prompt: '请总结这段内容', enabled: true },
  { id: 'rewrite', label: 'AI 改写这段', prompt: '请改写这段内容，使其更清晰', enabled: true },
  {
    id: 'format',
    label: 'AI 优化格式',
    prompt: '请优化选中文本的 Markdown 格式：可以调整标题、列表、引用、代码块、表格等 Markdown 标记；不得改变原文内容、语义和顺序，不得新增信息。',
    enabled: true,
  },
  { id: 'translate', label: 'AI 翻译', prompt: '请翻译这段内容', enabled: true },
]

export function createDefaultAiShortcutActions(): AiShortcutAction[] {
  return DEFAULT_AI_SHORTCUT_ACTIONS.map((action) => ({ ...action }))
}

export function normalizeAiShortcutActions(value: unknown): AiShortcutAction[] {
  if (!Array.isArray(value)) return createDefaultAiShortcutActions()
  if (value.length === 0) return []

  const seenIds = new Set<string>()
  const normalized: AiShortcutAction[] = []

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
    if (!id || !label || !prompt || seenIds.has(id)) continue

    seenIds.add(id)
    normalized.push({
      id,
      label: label.slice(0, AI_SHORTCUT_LABEL_MAX_LENGTH),
      prompt: prompt.slice(0, AI_SHORTCUT_PROMPT_MAX_LENGTH),
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    })
  }

  return normalized.length > 0 ? normalized : createDefaultAiShortcutActions()
}
