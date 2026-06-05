import { useSettingsStore } from '@/stores/settingsStore'
import { AI_API_KEY_SECRET, EMBEDDING_API_KEY_SECRET, WEB_SEARCH_API_KEY_SECRET, loadSecret, saveSecret } from './secureStorage'
import { updateSearchConfig } from './webSearch'

const SETTINGS_STORAGE_KEY = 'guanmo-settings'

function readLegacyApiKey(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw)
    return parsed?.state?.ai?.apiKey || ''
  } catch {
    return ''
  }
}

function readLegacyWebSearchApiKey(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw)
    return parsed?.state?.webSearch?.apiKey || ''
  } catch {
    return ''
  }
}

function removeLegacyApiKey(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed?.state?.ai) {
      parsed.state.ai.apiKey = ''
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed))
    }
  } catch {
    // Ignore malformed legacy settings.
  }
}

function removeLegacyWebSearchApiKey(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed?.state?.webSearch) {
      parsed.state.webSearch.apiKey = ''
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed))
    }
  } catch {
    // Ignore malformed legacy settings.
  }
}

export async function hydrateSettingsSecrets(): Promise<void> {
  const legacyApiKey = readLegacyApiKey()
  if (legacyApiKey) {
    await saveSecret(AI_API_KEY_SECRET, legacyApiKey)
    removeLegacyApiKey()
  }
  const legacyWebSearchApiKey = readLegacyWebSearchApiKey()
  if (legacyWebSearchApiKey) {
    await saveSecret(WEB_SEARCH_API_KEY_SECRET, legacyWebSearchApiKey)
    removeLegacyWebSearchApiKey()
  }

  const apiKey = await loadSecret(AI_API_KEY_SECRET)
  if (apiKey) {
    useSettingsStore.getState().updateAiConfig({ apiKey })
  }
  const webSearchApiKey = await loadSecret(WEB_SEARCH_API_KEY_SECRET)
  if (webSearchApiKey) {
    useSettingsStore.getState().updateWebSearchConfig({ apiKey: webSearchApiKey })
  }
  const embeddingApiKey = await loadSecret(EMBEDDING_API_KEY_SECRET)
  if (embeddingApiKey) {
    useSettingsStore.getState().updateEmbeddingConfig({ apiKey: embeddingApiKey })
  }
  updateSearchConfig(useSettingsStore.getState().webSearch)
}
