import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  records: new Map<string, string>(),
  legacy: new Map<string, string>(),
  invoke: vi.fn(),
  fail: false,
  pending: null as null | (() => void),
}))
vi.mock('@/hooks/useTauri', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class {} }))
import { DEFAULT_AI_CONFIG } from '@/services/ai/types'
import { useSettingsStore, syncDesktopCredential, desktopConnection } from '@/stores/settingsStore'
import { ensureSettingsSecretsHydrated, resetSettingsSecretsHydrationForTest } from '@/services/settingsSecrets'
import { chatConnection, connectionIdentity } from '@/services/apiConnection'
import { configureApiConnection } from '@/services/secureStorage'

beforeEach(() => {
  native.records.clear()
  native.legacy.clear()
  native.fail = false
  native.pending = null
  native.invoke.mockReset()
  localStorage.clear()
  useSettingsStore.setState({ ai: { ...DEFAULT_AI_CONFIG, baseUrl: 'https://chat.example/v1', embedding: { ...DEFAULT_AI_CONFIG.embedding, baseUrl: 'https://embed.example/v1' } },
    webSearch: { provider: 'tavily', apiKey: '', maxResults: 5, timeout: 15000 }, customChatPresets: [], customEmbeddingPresets: [] })
  resetSettingsSecretsHydrationForTest()
  native.invoke.mockImplementation(async (command, args) => {
    expect(command).toBe('configure_api_connection')
    if (native.pending) await new Promise<void>((resolve) => { native.pending = resolve })
    if (native.fail) throw new Error('synthetic failure')
    const { connection, value, remove, migrateLegacy, importLegacy } = args.request
    const id = connectionIdentity(connection)
    const old = native.records.get(id)
    if (value === undefined && !remove && !migrateLegacy && !importLegacy) return { configId: id, configured: Boolean(old) }
    const key = remove ? '' : (importLegacy && old ? old : value) || old || (migrateLegacy ? native.legacy.get(connection.kind) : '') || ''
    native.records.set(id, key)
    if (migrateLegacy) native.legacy.delete(connection.kind)
    return { configId: id, configured: Boolean(key) }
  })
})

describe('desktop credential metadata and compatible migration', () => {
  it('shares hydration, migrates the old native slots and never returns keys to the Store', async () => {
    native.legacy.set('chat', 'synthetic-chat-key')
    native.legacy.set('embedding', 'synthetic-embedding-key')
    native.legacy.set('search', 'synthetic-search-key')
    const first = ensureSettingsSecretsHydrated()
    expect(ensureSettingsSecretsHydrated()).toBe(first)
    await first
    const state = useSettingsStore.getState()
    expect(state.ai.apiKeyConfigured).toBe(true)
    expect(state.ai.embedding.apiKeyConfigured).toBe(true)
    expect(state.webSearch.apiKeyConfigured).toBe(true)
    expect(JSON.stringify(state)).not.toContain('synthetic-')
    expect(localStorage.getItem('guanmo-settings')).not.toContain('synthetic-')
    expect(native.legacy.size).toBe(0)
    expect(native.invoke.mock.calls.every(([command]) => command !== 'load_secret')).toBe(true)
  })

  it('keeps empty input unchanged and explicitly replaces/deletes, without persisting temporary input', async () => {
    await syncDesktopCredential('chat', { value: 'synthetic-initial-key' })
    await syncDesktopCredential('chat', { value: '' })
    expect(native.records.get(connectionIdentity(desktopConnection('chat')))).toBe('synthetic-initial-key')
    expect(useSettingsStore.getState().ai.apiKeyConfigured).toBe(true)
    await syncDesktopCredential('chat', { value: 'synthetic-replacement-key' })
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain('synthetic-')
    expect(localStorage.getItem('guanmo-settings')).not.toContain('synthetic-')
    await syncDesktopCredential('chat', { remove: true })
    expect(useSettingsStore.getState().ai.apiKeyConfigured).toBe(false)
    expect(native.records.get(connectionIdentity(desktopConnection('chat'))) || '').toBe('')
  })

  it('keeps legacy plaintext after failed migration and retries all three types and old preset keys', async () => {
    localStorage.setItem('guanmo-settings', JSON.stringify({ state: {
      ai: { ...useSettingsStore.getState().ai, apiKey: 'synthetic-legacy-chat', embedding: { ...useSettingsStore.getState().ai.embedding, apiKey: 'synthetic-legacy-embedding' } },
      webSearch: { ...useSettingsStore.getState().webSearch, apiKey: 'synthetic-legacy-search' },
      customChatPresets: [{ id: 'old', baseUrl: 'https://preset.example/v1', apiKey: 'synthetic-legacy-preset' }],
    } }))
    native.fail = true
    await expect(ensureSettingsSecretsHydrated()).rejects.toThrow('旧数据已保留')
    expect(localStorage.getItem('guanmo-settings')).toContain('synthetic-legacy-chat')
    expect(useSettingsStore.getState().ai.apiKey).toBe('')
    native.fail = false
    await ensureSettingsSecretsHydrated()
    expect(localStorage.getItem('guanmo-settings')).not.toContain('synthetic-legacy-')
    expect([...native.records.values()]).toEqual(expect.arrayContaining(['synthetic-legacy-chat', 'synthetic-legacy-embedding', 'synthetic-legacy-search', 'synthetic-legacy-preset']))
  })

  it('preserves the original target of legacy plaintext across settings writes before migration', async () => {
    const old = chatConnection(useSettingsStore.getState().ai)
    localStorage.setItem('guanmo-settings', JSON.stringify({ state: { ai: { ...useSettingsStore.getState().ai, apiKey: 'synthetic-pending' } } }))
    useSettingsStore.setState(state => ({ ai: { ...state.ai, baseUrl: 'https://new.example/v1' } }))
    expect(localStorage.getItem('guanmo-settings')).toContain('synthetic-pending')
    await ensureSettingsSecretsHydrated()
    expect(native.records.get(connectionIdentity(old))).toBe('synthetic-pending')
    expect(native.records.get(connectionIdentity(desktopConnection('chat'))) || '').toBe('')
    expect(useSettingsStore.getState().ai.apiKeyConfigured).toBe(false)
    expect(localStorage.getItem('guanmo-settings')).not.toContain('synthetic-pending')
  })

  it('does not publish an old save status after target switch, and restores each target independently', async () => {
    const original = desktopConnection('chat')
    const previousVersion = useSettingsStore.getState().ai.credentialVersion
    native.pending = () => {}
    const first = syncDesktopCredential('chat', { value: 'synthetic-original' })
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled())
    const resolve = native.pending!
    useSettingsStore.getState().updateAiConfig({ baseUrl: 'https://new.example/v1' })
    native.pending = null
    resolve()
    await first
    await vi.waitFor(() => expect(useSettingsStore.getState().ai.credentialVersion).not.toBe(previousVersion))
    expect(useSettingsStore.getState().ai.apiKeyConfigured).toBe(false)
    expect(native.records.get(connectionIdentity(original))).toBe('synthetic-original')
    useSettingsStore.getState().updateAiConfig({ baseUrl: original.baseUrl })
    await vi.waitFor(() => expect(useSettingsStore.getState().ai.apiKeyConfigured).toBe(true))
  })

  it('does not let a delayed plaintext migration replace a newly saved key', async () => {
    const connection = desktopConnection('chat')
    localStorage.setItem('guanmo-settings', JSON.stringify({ state: { ai: { ...useSettingsStore.getState().ai, apiKey: 'synthetic-stale-key' } } }))
    await configureApiConnection(connection, { value: 'synthetic-current-key' })
    await ensureSettingsSecretsHydrated()
    expect(native.records.get(connectionIdentity(connection))).toBe('synthetic-current-key')
    expect(localStorage.getItem('guanmo-settings')).not.toContain('synthetic-stale-key')
  })

  it('only allows writing via configuration metadata IPC', async () => {
    const status = await configureApiConnection(desktopConnection('chat'), { value: 'synthetic-direct' })
    expect(Object.keys(status).sort()).toEqual(['configId', 'configured'])
    expect(JSON.stringify(status)).not.toContain('synthetic-direct')
  })
})
