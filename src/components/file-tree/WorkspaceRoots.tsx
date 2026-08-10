import { useCallback, useRef, useState } from 'react'
import { FileTree, type FileTreeHandle } from '@/components/file-tree/FileTree'
import { isTauri } from '@/hooks/useTauri'
import { useWorkspaceFileTree } from '@/hooks/useWorkspaceFileTree'
import { pickDirectory } from '@/services/fileSystem'
import { indexWorkspaceMarkdown } from '@/services/rag/indexer'
import { toast } from '@/services/toast'

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

  const handleAddWorkspace = useCallback(async () => {
    if (!isTauri()) {
      toast.error('浏览器模式下不可用，请下载桌面版')
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
    if (workingRootId) return
    setWorkingRootId(rootId)
    setSummary(rootId, null)
    try {
      const result = await indexWorkspaceMarkdown(rootPath)
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-micro text-gm-text-tertiary">共打开 {workspaceRoots.length} 个文件夹</span>
        <button
          type="button"
          onClick={handleAddWorkspace}
          className="rounded-md px-2 py-1 text-micro text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text"
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
            <div className="flex min-w-0 items-center gap-1">
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
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text"
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
                <span className="min-w-0 flex-1 truncate text-caption font-bold">
                  {root.name}
                </span>
              </button>
              <button
                type="button"
                disabled={Boolean(workingRootId)}
                onClick={() => void handleIndex(root.id, root.path)}
                className="text-micro text-gm-text-tertiary hover:text-gm-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working ? '索引中…' : '索引'}
              </button>
              <WorkspaceRootActionButton
                label={`新建文件 ${root.name}`}
                onClick={() => treeRefs.current[root.id]?.startCreate('file')}
              >
                ＋文
              </WorkspaceRootActionButton>
              <WorkspaceRootActionButton
                label={`新建文件夹 ${root.name}`}
                onClick={() => treeRefs.current[root.id]?.startCreate('folder')}
              >
                ＋夹
              </WorkspaceRootActionButton>
              <WorkspaceRootActionButton
                label={`展开所有文件夹 ${root.name}`}
                onClick={() => setExpandSignals((current) => ({
                  ...current,
                  [root.id]: (current[root.id] ?? 0) + 1,
                }))}
              >
                展开
              </WorkspaceRootActionButton>
              <WorkspaceRootActionButton
                label={`折叠所有文件夹 ${root.name}`}
                onClick={() => setCollapseSignals((current) => ({
                  ...current,
                  [root.id]: (current[root.id] ?? 0) + 1,
                }))}
              >
                折叠
              </WorkspaceRootActionButton>
              <button
                type="button"
                onClick={() => void refreshWorkspaceRoot(root.id)}
                className="text-micro text-gm-text-tertiary hover:text-gm-text"
              >
                刷新
              </button>
              <button
                type="button"
                onClick={() => handleRemove(root.id)}
                className="text-micro text-gm-text-tertiary hover:text-gm-error"
                title="仅移除工作区记录，不删除本地文件"
              >
                移除
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
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-micro text-gm-text-tertiary hover:text-gm-text"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
