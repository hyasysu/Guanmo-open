import { isTauri } from '@/hooks/useTauri'
import { desktopConnection, syncDesktopCredential } from '@/stores/settingsStore'
import { configureApiConnection } from '@/services/secureStorage'
import { toast } from '@/services/toast'

import { pendingLegacyCredentials, acknowledgeLegacyCredential } from './legacyApiCredentials'

let hydrationPromise: Promise<void> | null = null
// Capture original targets before a user can switch presets; legacy DPAPI slots have no target metadata.
let originalTargets = (['chat', 'embedding', 'search'] as const).map(kind => desktopConnection(kind))

async function hydrateSettingsSecretsOnce(): Promise<boolean> {
  if (!isTauri()) return true
  const failedKinds = new Set<string>()
  for (const entry of pendingLegacyCredentials()) {
    if (!entry.connection.baseUrl) continue
    try {
      await configureApiConnection(entry.connection, { value: entry.value, importLegacy: true })
      acknowledgeLegacyCredential(entry)
    } catch {
      failedKinds.add(entry.connection.kind)
    }
  }
  const pendingTargets: typeof originalTargets = []
  for (const connection of originalTargets) {
    if (!connection.baseUrl) continue
    try {
      await configureApiConnection(connection, { migrateLegacy: true })
    } catch {
      pendingTargets.push(connection)
      failedKinds.add(connection.kind)
    }
  }
  originalTargets = pendingTargets
  let syncedKinds = 0
  for (const kind of ['chat', 'embedding', 'search'] as const) {
    if (!desktopConnection(kind).baseUrl) continue
    try {
      if (await syncDesktopCredential(kind)) syncedKinds += 1
      else failedKinds.add(kind)
    } catch {
      failedKinds.add(kind)
    }
  }
  if (failedKinds.size) {
    const labels = { chat: '对话', embedding: 'Embedding', search: '搜索' }
    const failed = (['chat', 'embedding', 'search'] as const).filter(kind => failedKinds.has(kind)).map(kind => labels[kind]).join('、')
    const message = `${failed} API 安全配置恢复失败，旧数据已保留，请在设置中重试`
    toast.error(message)
    if (!syncedKinds) throw new Error(message)
  }
  return failedKinds.size === 0
}

export function ensureSettingsSecretsHydrated(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = hydrateSettingsSecretsOnce().then((complete) => {
      // Let consumers initialize valid connections; retry retained failures on the next call.
      if (!complete) hydrationPromise = null
    }).catch((error: unknown) => {
      hydrationPromise = null
      throw error
    })
  }
  return hydrationPromise
}

export function hydrateSettingsSecrets(): Promise<void> {
  return ensureSettingsSecretsHydrated()
}

export function resetSettingsSecretsHydrationForTest(): void {
  hydrationPromise = null
  originalTargets = (['chat', 'embedding', 'search'] as const).map(kind => desktopConnection(kind))
}
