export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
}

const WORKSPACE_FILE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdx',
  'txt',
  'json',
  'html',
  'css',
  'js',
  'ts',
  'jsx',
  'tsx',
])

const IGNORED_WORKSPACE_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
])

const MAX_WORKSPACE_VISIBLE_ENTRIES = 500

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : ''
}

function isWorkspaceDisplayFile(name: string): boolean {
  return WORKSPACE_FILE_EXTENSIONS.has(getExtension(name))
}

function shouldSkipWorkspaceDirectory(name: string): boolean {
  return IGNORED_WORKSPACE_DIRECTORIES.has(name.toLowerCase())
}

function filterWorkspaceEntries<T extends { name: string; isDirectory: boolean }>(entries: T[]): {
  entries: T[]
  hiddenCount: number
  limited: boolean
} {
  const visible = entries.filter((entry) => {
    if (entry.isDirectory) return !shouldSkipWorkspaceDirectory(entry.name)
    return isWorkspaceDisplayFile(entry.name)
  })
  const limited = visible.length > MAX_WORKSPACE_VISIBLE_ENTRIES
  return {
    entries: visible.slice(0, MAX_WORKSPACE_VISIBLE_ENTRIES),
    hiddenCount: entries.length - visible.length + (limited ? visible.length - MAX_WORKSPACE_VISIBLE_ENTRIES : 0),
    limited,
  }
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
}

function getFileIcon(name: string, type: 'file' | 'directory'): string {
  if (type === 'directory') return 'folder'
  const ext = getExtension(name)
  switch (ext) {
    case 'md': return 'markdown'
    case 'txt': return 'text'
    case 'json': return 'json'
    case 'html': return 'html'
    case 'css': return 'css'
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx': return 'code'
    default: return 'file'
  }
}

function buildFileTree(entries: { name: string; path: string; isDirectory: boolean }[]): FileNode[] {
  const { entries: visibleEntries } = filterWorkspaceEntries(entries)
  return sortNodes(
    visibleEntries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.isDirectory ? 'directory' as const : 'file' as const,
      extension: entry.isDirectory ? undefined : getExtension(entry.name),
      children: entry.isDirectory ? [] : undefined,
    }))
  )
}

export {
  getFileIcon,
  buildFileTree,
  sortNodes,
  getExtension,
  isWorkspaceDisplayFile,
  shouldSkipWorkspaceDirectory,
  filterWorkspaceEntries,
}
