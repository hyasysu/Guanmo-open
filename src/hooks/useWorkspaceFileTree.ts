import { useCallback, useEffect, useState } from 'react'
import { joinPath } from '@/hooks/useTauri'
import { listDirectory } from '@/services/fileSystem'
import { isWorkspaceDisplayFile, shouldSkipWorkspaceDirectory, type FileNode } from '@/services/fileTree'
import { recoverRememberedWorkspace } from '@/services/persistedFileAccess'
import { useAppStore, type WorkspaceRoot } from '@/stores/appStore'

export interface WorkspaceTreeState {
  nodes: FileNode[]
  hiddenCount: number
  loading: boolean
  error: string | null
}

const EMPTY_TREE: WorkspaceTreeState = {
  nodes: [],
  hiddenCount: 0,
  loading: false,
  error: null,
}

export function useWorkspaceFileTree() {
  const workspaceRoots = useAppStore((state) => state.workspaceRoots)
  const addWorkspaceRoot = useAppStore((state) => state.addWorkspaceRoot)
  const removeWorkspaceRoot = useAppStore((state) => state.removeWorkspaceRoot)
  const [workspaceTrees, setWorkspaceTrees] = useState<Record<string, WorkspaceTreeState>>({})

  const readDirRecursive = useCallback(async (dirPath: string, depth: number): Promise<{ nodes: FileNode[]; hidden: number }> => {
    if (depth > 5) return { nodes: [], hidden: 0 }
    const entries = await listDirectory(dirPath)
    const nodes: FileNode[] = []
    let hidden = 0
    for (const entry of entries) {
      const fullPath = await joinPath(dirPath, entry.name)
      if (entry.isDirectory) {
        if (shouldSkipWorkspaceDirectory(entry.name)) {
          hidden++
          continue
        }
        const { nodes: children, hidden: childHidden } = await readDirRecursive(fullPath, depth + 1)
        nodes.push({ name: entry.name, path: fullPath, type: 'directory', children })
        hidden += childHidden
      } else if (isWorkspaceDisplayFile(entry.name)) {
        const ext = entry.name.includes('.') ? entry.name.split('.').pop()?.toLowerCase() : undefined
        nodes.push({ name: entry.name, path: fullPath, type: 'file', extension: ext })
      } else {
        hidden++
      }
    }
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
    return { nodes, hidden }
  }, [])

  const loadWorkspaceRoot = useCallback(async (root: WorkspaceRoot) => {
    setWorkspaceTrees((current) => ({
      ...current,
      [root.id]: { ...(current[root.id] ?? EMPTY_TREE), loading: true, error: null },
    }))
    try {
      const { nodes, hidden } = await recoverRememberedWorkspace(
        root.path,
        () => readDirRecursive(root.path, 0)
      )
      if (!useAppStore.getState().workspaceRoots.some((item) => item.id === root.id)) return
      setWorkspaceTrees((current) => ({
        ...current,
        [root.id]: { nodes, hiddenCount: hidden, loading: false, error: null },
      }))
    } catch (error) {
      if (!useAppStore.getState().workspaceRoots.some((item) => item.id === root.id)) return
      const message = error instanceof Error ? error.message : String(error)
      setWorkspaceTrees((current) => ({
        ...current,
        [root.id]: { ...(current[root.id] ?? EMPTY_TREE), loading: false, error: message || '工作区加载失败' },
      }))
    }
  }, [readDirRecursive])

  const refreshWorkspaceRoot = useCallback(async (id: string) => {
    const root = useAppStore.getState().workspaceRoots.find((item) => item.id === id)
    if (root) await loadWorkspaceRoot(root)
  }, [loadWorkspaceRoot])

  const loadWorkspaceRoots = useCallback(async (roots: WorkspaceRoot[]) => {
    for (const root of roots) {
      await loadWorkspaceRoot(root)
    }
  }, [loadWorkspaceRoot])

  const refreshAllWorkspaces = useCallback(async () => {
    const roots = useAppStore.getState().workspaceRoots
    await loadWorkspaceRoots(roots)
  }, [loadWorkspaceRoots])

  const removeWorkspace = useCallback((id: string) => {
    removeWorkspaceRoot(id)
    setWorkspaceTrees((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [removeWorkspaceRoot])

  useEffect(() => {
    const rootIds = new Set(workspaceRoots.map((root) => root.id))
    setWorkspaceTrees((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => rootIds.has(id))
    ))
    void loadWorkspaceRoots(workspaceRoots)
  }, [loadWorkspaceRoots, workspaceRoots])

  useEffect(() => {
    const handler = () => { void refreshAllWorkspaces() }
    window.addEventListener('guanmo:workspace-refresh', handler)
    return () => window.removeEventListener('guanmo:workspace-refresh', handler)
  }, [refreshAllWorkspaces])

  return {
    workspaceRoots,
    workspaceTrees,
    addWorkspaceRoot,
    removeWorkspace,
    loadWorkspaceRoot,
    refreshWorkspaceRoot,
    refreshAllWorkspaces,
  }
}
