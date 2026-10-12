import { chatConnection, embeddingConnection, searchConnection, connectionIdentity, type ApiConnection } from './apiConnection'

const STORAGE_KEY = 'guanmo-settings'
interface LegacyCredential { connection: ApiConnection; value: string }

export function pendingLegacyCredentials(): LegacyCredential[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').state || {}
    const pending: LegacyCredential[] = Array.isArray(saved.legacyApiCredentials) ? [...saved.legacyApiCredentials] : []
    const add = (connection: ApiConnection, value: unknown) => {
      if (typeof value !== 'string' || !value) return
      if (!pending.some((entry) => connectionIdentity(entry.connection) === connectionIdentity(connection) && entry.value === value)) {
        pending.push({ connection, value })
      }
    }
    if (saved.ai) {
      add(chatConnection({ ...saved.ai, protocol: saved.ai.protocol || 'openai-chat' }), saved.ai.apiKey)
      if (saved.ai.embedding) add(embeddingConnection({ ...saved.ai.embedding, protocol: saved.ai.embedding.protocol || 'openai-embedding' }), saved.ai.embedding.apiKey)
    }
    if (saved.webSearch) add(searchConnection(saved.webSearch), saved.webSearch.apiKey)
    for (const [field, kind, protocol] of [
      ['customChatPresets', 'chat', 'openai-chat'], ['customEmbeddingPresets', 'embedding', 'openai-embedding'],
    ] as const) {
      for (const preset of saved[field] || []) add({ kind, protocol: preset.protocol || protocol, baseUrl: preset.baseUrl }, preset.apiKey)
    }
    return pending
  } catch { return [] }
}

export function acknowledgeLegacyCredential(entry: LegacyCredential): void {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return
  const parsed = JSON.parse(raw)
  parsed.state.legacyApiCredentials = pendingLegacyCredentials().filter((pending) =>
    connectionIdentity(pending.connection) !== connectionIdentity(entry.connection) || pending.value !== entry.value)
  // Clear only the entry whose native write was confirmed; preserve all other pending data.
  const saved = parsed.state
  const active = entry.connection.kind === 'chat' ? saved.ai
    : entry.connection.kind === 'embedding' ? saved.ai?.embedding : saved.webSearch
  const descriptor = entry.connection.kind === 'chat' ? active && chatConnection({ ...active, protocol: active.protocol || 'openai-chat' })
    : entry.connection.kind === 'embedding' ? active && embeddingConnection({ ...active, protocol: active.protocol || 'openai-embedding' })
      : active && searchConnection(active)
  if (descriptor && connectionIdentity(descriptor) === connectionIdentity(entry.connection) && active.apiKey === entry.value) active.apiKey = ''
  for (const field of ['customChatPresets', 'customEmbeddingPresets']) {
    for (const preset of saved[field] || []) {
      if (preset.apiKey === entry.value && preset.baseUrl === entry.connection.baseUrl) delete preset.apiKey
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
}
