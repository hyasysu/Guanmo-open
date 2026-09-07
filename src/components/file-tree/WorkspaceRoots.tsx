import { useCallback, useRef, useState } from 'react'
import { FileTree, type FileTreeHandle } from '@/components/file-tree/FileTree'
import { isTauri } from '@/hooks/useTauri'
import { useWorkspaceFileTree } from '@/hooks/useWorkspaceFileTree'
import { pickDirectory } from '@/services/fileSystem'
import { indexWorkspaceDocuments } from '@/services/workspaceIndex'
import { toast } from '@/services/toast'
import { getRuntimeCapabilities } from '@/services/runtimeCapabilities'

interface WorkspaceRootsProps {
  onOpenFile: (path: string) => void
}

export function WorkspaceRoots({ onOpenFile }: WorkspaceRootsProps) {
  const {
    workspaceRoots,
    workspaceTrees,
    addWorkspaceRoot,
    removeWorkspace,
    refreshWorkspaceRoot,
  } = useWorkspaceFileTree()
  const [collapsedRootIds, setCollapsedRootIds] = useState<Set<string>>(() => new Set())
  const [workingRootId, setWorkingRootId] = useState<string | null>(null)
  const [rootSummaries, setRootSummaries] = useState<Record<string, string>>({})
  const [collapseSignals, setCollapseSignals] = useState<Record<string, number>>({})
  const [expandSignals, setExpandSignals] = useState<Record<string, number>>({})
  const treeRefs = useRef<Record<string, FileTreeHandle | null>>({})
  const browserFileSystem = getRuntimeCapabilities().browserFileSystem

  const handleAddWorkspace = useCallback(async () => {
    if (!isTauri() && !getRuntimeCapabilities().browserFileSystem) {
      toast.error('当前浏览器不支持目录工作区，请使用 Chrome 或 Edge')
      return
    }
    try {
      const path = await pickDirectory()
      if (!path) return
      if (!addWorkspaceRoot(path)) {
        toast.error('该文件夹已在工作区中')
        return
      }
      toast.success('已添加工作区')
    } catch (error) {
      console.error('Add workspace failed:', error)
      toast.error('添加工作区失败')
    }
  }, [addWorkspaceRoot])

  const setSummary = useCallback((rootId: string, summary: string | null) => {
    setRootSummaries((current) => {
      if (summary === null) {
        const next = { ...current }
        delete next[rootId]
        return next
      }
      return { ...current, [rootId]: summary }
    })
  }, [])

  const handleIndex = useCallback(async (rootId: string, rootPath: string) => {
    if (!getRuntimeCapabilities().database) {
      toast.error('网页版不提供知识库索引')
      return
    }
    if (workingRootId) return
    setWorkingRootId(rootId)
    setSummary(rootId, null)
    try {
      const result = await indexWorkspaceDocuments(rootPath)
      let summary = `已索引 ${result.indexed}`
      if (result.failed > 0) summary += `，失败 ${result.failed}`
      if (result.errors.length > 0) summary += `\n${result.errors.join('\n')}`
      setSummary(rootId, summary)
    } catch (error) {
      setSummary(rootId, error instanceof Error ? error.message : '索引失败')
    } finally {
      setWorkingRootId(null)
    }
  }, [setSummary, workingRootId])

  const handleRemove = useCallback((rootId: string) => {
    removeWorkspace(rootId)
    setSummary(rootId, null)
    toast.success('已移除工作区，本地文件未删除')
  }, [removeWorkspace, setSummary])

  return (
    <div className="gm-workspace-roots space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-micro text-gm-text-tertiary">共打开 {workspaceRoots.length} 个文件夹</span>
        <button
          type="button"
          onClick={handleAddWorkspace}
          disabled={!isTauri() && !browserFileSystem}
          title={!isTauri() && !browserFileSystem ? '当前浏览器不支持目录工作区' : undefined}
          className="rounded-md px-2 py-1 text-micro text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          添加文件夹
        </button>
      </div>
      {workspaceRoots.length === 0 ? (
        <div className="text-caption text-gm-text-tertiary text-center py-4">
          <p>尚未添加工作区</p>
          <p className="mt-1 text-gm-text-disabled">仍可正常打开单个 Markdown 文件</p>
        </div>
      ) : workspaceRoots.map((root, index) => {
        const tree = workspaceTrees[root.id]
        const expanded = !collapsedRootIds.has(root.id)
        const working = workingRootId === root.id
        return (
          <section
            key={root.id}
            className={`px-1.5 py-2 ${index > 0 ? 'border-t border-gm-border-subtle' : ''}`}
          >
            <div className="gm-workspace-root-header min-w-0">
              <div className="gm-workspace-root-actions">
                <WorkspaceRootActionButton
                  label={working ? `正在索引 ${root.name}` : `索引 ${root.name}`}
                  disabled={!getRuntimeCapabilities().database || Boolean(workingRootId)}
                  onClick={() => void handleIndex(root.id, root.path)}
                >
                  {working ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                      className="animate-spin"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <ellipse cx="12" cy="5" rx="7" ry="3" />
                      <path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5" />
                      <path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
                    </svg>
                  )}
                </WorkspaceRootActionButton>
                <WorkspaceRootActionButton
                  label={`新建文件 ${root.name}`}
                  onClick={() => treeRefs.current[root.id]?.startCreate('file')}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 2v6h6M12 12v6M9 15h6" />
                  </svg>
                </WorkspaceRootActionButton>
                <WorkspaceRootActionButton
                  label={`新建文件夹 ${root.name}`}
                  onClick={() => treeRefs.current[root.id]?.startCreate('folder')}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                    <path d="M12 11v6M9 14h6" />
                  </svg>
                </WorkspaceRootActionButton>
                <WorkspaceRootActionButton
                  label={`展开所有文件夹 ${root.name}`}
                  onClick={() => setExpandSignals((current) => ({
                    ...current,
                    [root.id]: (current[root.id] ?? 0) + 1,
                  }))}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m8 9 4-4 4 4M8 15l4 4 4-4M5 12h14" />
                  </svg>
                </WorkspaceRootActionButton>
                <WorkspaceRootActionButton
                  label={`折叠所有文件夹 ${root.name}`}
                  onClick={() => setCollapseSignals((current) => ({
                    ...current,
                    [root.id]: (current[root.id] ?? 0) + 1,
                  }))}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m8 5 4 4 4-4M8 19l4-4 4 4M5 12h14" />
                  </svg>
                </WorkspaceRootActionButton>
                <WorkspaceRootActionButton
                  label={`刷新 ${root.name}`}
                  onClick={() => void refreshWorkspaceRoot(root.id)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                  </svg>
                </WorkspaceRootActionButton>
                <WorkspaceRootActionButton
                  label={`移除工作区 ${root.name}`}
                  onClick={() => handleRemove(root.id)}
                  danger
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                    <path d="M9 14h6" />
                  </svg>
                </WorkspaceRootActionButton>
              </div>
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? '折叠' : '展开'} ${root.name}`}
                onClick={() => setCollapsedRootIds((current) => {
                  const next = new Set(current)
                  if (next.has(root.id)) next.delete(root.id)
                  else next.add(root.id)
                  return next
                })}
                className="gm-workspace-root-toggle flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text"
                title={root.path}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <span className="gm-workspace-root-name min-w-0 flex-1 truncate text-caption font-bold">
                  {root.name}
                </span>
              </button>
            </div>
            {expanded && (
              <div className="pt-1">
                {rootSummaries[root.id] && (
                  <div className="mb-1 rounded-lg border border-gm-border bg-gm-surface-elevated px-2 py-1.5 text-micro text-gm-text-tertiary break-words whitespace-pre-line">
                    {rootSummaries[root.id]}
                  </div>
                )}
                {tree?.error ? (
                  <div className="rounded-lg border border-gm-error/30 bg-gm-error/5 px-2 py-2 text-micro text-gm-text-tertiary">
                    <p className="break-words">{tree.error}</p>
                    <button type="button" className="mt-1 text-gm-primary hover:underline" onClick={() => void refreshWorkspaceRoot(root.id)}>重试</button>
                  </div>
                ) : tree?.loading && !tree.nodes.length ? (
                  <div className="py-3 text-center text-micro text-gm-text-disabled">正在读取…</div>
                ) : (
                  <FileTree
                    ref={(handle) => {
                      treeRefs.current[root.id] = handle
                    }}
                    nodes={tree?.nodes ?? []}
                    onOpenFile={onOpenFile}
                    workspacePath={root.path}
                    onRefreshWorkspace={() => void refreshWorkspaceRoot(root.id)}
                    onCloseWorkspace={() => handleRemove(root.id)}
                    collapseAllSignal={collapseSignals[root.id] ?? 0}
                    expandAllSignal={expandSignals[root.id] ?? 0}
                  />
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function WorkspaceRootActionButton({
  label,
  onClick,
  children,
  disabled = false,
  danger = false,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gm-text-tertiary transition-colors hover:bg-gm-surface-hover disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? 'hover:text-gm-error' : 'hover:text-gm-text'
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
