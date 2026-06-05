import { isTauri } from '@/hooks/useTauri'

export const AI_API_KEY_SECRET = import.meta.env.VITE_GUANMO_AI_API_KEY_SECRET ?? ''
export const EMBEDDING_API_KEY_SECRET = import.meta.env.VITE_GUANMO_EMBEDDING_API_KEY_SECRET ?? ''
export const WEB_SEARCH_API_KEY_SECRET = import.meta.env.VITE_GUANMO_WEB_SEARCH_API_KEY_SECRET ?? ''

export async function saveSecret(key: string, value: string): Promise<void> {
  if (!isTauri() || !key) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_secret', { key, value })
}

export async function loadSecret(key: string): Promise<string | null> {
  if (!isTauri() || !key) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('load_secret', { key })
}

export async function deleteSecret(key: string): Promise<void> {
  if (!isTauri() || !key) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('delete_secret', { key })
}
