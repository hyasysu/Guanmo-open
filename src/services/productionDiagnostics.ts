import { invoke } from '@tauri-apps/api/core'

type DiagnosticLevel = 'info' | 'slow' | 'error'

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const globals = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in globals || '__TAURI__' in globals
}

export async function recordDiagnostic(
  name: string,
  level: DiagnosticLevel,
  durationMs?: number,
): Promise<void> {
  if (!isDesktopRuntime()) return
  await invoke('record_diagnostic_event', { name, level, durationMs })
}
