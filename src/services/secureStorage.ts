import { isTauri } from '@/hooks/useTauri'
import type { ApiConnection, ApiConnectionStatus } from './apiConnection'

export async function configureApiConnection(
  connection: ApiConnection,
  change: { value?: string; remove?: boolean; migrateLegacy?: boolean; importLegacy?: boolean } = {},
): Promise<ApiConnectionStatus> {
  if (!isTauri()) throw new Error('当前运行环境不支持桌面安全配置')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<ApiConnectionStatus>('configure_api_connection', { request: { connection, ...change } })
}
