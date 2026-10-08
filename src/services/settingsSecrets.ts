import { isTauri } from '@/hooks/useTauri'
import { desktopConnection, syncDesktopCredential } from '@/stores/settingsStore'
import { configureApiConnection } from '@/services/secureStorage'
import { toast } from '@/services/toast'

import { pendingLegacyCredentials, acknowledgeLegacyCredential } from './legacyApiCredentials'

let hydrationPromise: Promise<void> | null = null
// Capture original targets before a user can switch presets; legacy DPAPI slots have no target metadata.
let originalTargets = (['chat', 'embedding', 'search'] as const).map(kind => desktopConnection(kind))

async function hydrateSettingsSecretsOnce(): Promise<void> {
  if (!isTauri()) return
  for (const entry of pendingLegacyCredentials()) {
    if (!entry.connection.baseUrl) continue
    await configureApiConnection(entry.connection, { value: entry.value, importLegacy: true })
    acknowledgeLegacyCredential(entry)
  }
  for (const connection of originalTargets) {
    if (connection.baseUrl) await configureApiConnection(connection, { migrateLegacy: true })
  }
  for (const kind of ['chat', 'embedding', 'search'] as const) {
    await syncDesktopCredential(kind)
  }
}

export function ensureSettingsSecretsHydrated(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = hydrateSettingsSecretsOnce().catch(() => {
      hydrationPromise = null
      toast.error('API 安全配置恢复失败，旧数据已保留，请在设置中重试')
      throw new Error('API 安全配置恢复失败，旧数据已保留，请重试')
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
