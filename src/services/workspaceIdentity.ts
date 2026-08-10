export interface WorkspaceRoot {
  id: string
  path: string
  name: string
}

function createWorkspaceRootId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function normalizeWorkspacePath(path: string | null | undefined): string {
  if (!path) return ''
  let normalized = path.trim().replace(/\\/g, '/')
  const lowerPath = normalized.toLowerCase()
  if (lowerPath.startsWith('//?/unc/')) normalized = `//${normalized.slice(8)}`
  else if (lowerPath.startsWith('//?/')) normalized = normalized.slice(4)
  const unc = normalized.startsWith('//')
  normalized = `${unc ? '//' : ''}${normalized.slice(unc ? 2 : 0).replace(/\/+/g, '/')}`.toLowerCase()
  if (normalized.length > 1 && !/^[a-z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '')
  }
  return normalized
}

function cleanWorkspacePath(path: string): string {
  const trimmed = path.trim()
  if (/^[a-zA-Z]:[\\/]$/.test(trimmed)) return trimmed
  return trimmed.replace(/[\\/]+$/, '')
}

export function createWorkspaceRoot(path: string, id = createWorkspaceRootId()): WorkspaceRoot | null {
  const cleanedPath = cleanWorkspacePath(path)
  if (!normalizeWorkspacePath(cleanedPath)) return null
  return {
    id,
    path: cleanedPath,
    name: cleanedPath.split(/[\\/]/).filter(Boolean).pop() || cleanedPath,
  }
}
