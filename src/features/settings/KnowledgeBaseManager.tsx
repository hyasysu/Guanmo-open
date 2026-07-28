import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button, Input } from 'animal-island-ui'
import {
  listKnowledgeDocuments,
  removeKnowledgeDocuments,
  type KnowledgeDocumentItem,
} from '@/services/rag/knowledgeBase'
import { toast } from '@/services/toast'
import { useSettingsStore } from '@/stores/settingsStore'

interface KnowledgeBaseManagerProps {
  open: boolean
  onClose: () => void
}

const STATE_LABELS: Record<string, string> = {
  PENDING: '待处理',
  CHUNKED: '已分块',
  EMBEDDING: '嵌入中',
  INDEXED: '已索引',
  FAILED: '失败',
}

export function KnowledgeBaseManager({ open, onClose }: KnowledgeBaseManagerProps) {
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeTimerRef = useRef<number>()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const autoIndexEnabled = useSettingsStore((s) => s.knowledge.autoIndexEnabled)

  const finishClose = useCallback(() => {
    closingRef.current = false
    setClosing(false)
    closeTimerRef.current = undefined
    onClose()
  }, [onClose])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    if (showConfirm) {
      setShowConfirm(false)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishClose()
      return
    }
    closingRef.current = true
    setClosing(true)
    closeTimerRef.current = window.setTimeout(finishClose, 160)
  }, [finishClose, showConfirm])

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const docs = await listKnowledgeDocuments()
      setDocuments(docs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      closingRef.current = false
      setClosing(false)
      loadDocuments()
      setSearch('')
      setSelected(new Set())
      setShowConfirm(false)
    }
  }, [open, loadDocuments])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [open, requestClose])

  const filtered = useMemo(() => {
    if (!search.trim()) return documents
    const lower = search.toLowerCase()
    return documents.filter((doc) => {
      const fileName = doc.title || doc.filePath.split(/[/\\]/).pop() || ''
      return fileName.toLowerCase().includes(lower)
    })
  }, [documents, search])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((d) => selected.has(d.filePath))

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const d of filtered) next.delete(d.filePath)
      } else {
        for (const d of filtered) next.add(d.filePath)
      }
      return next
    })
  }

  const toggleSelect = (filePath: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  if (!open) return null

  const handleRemove = async () => {
    setRemoving(true)
    try {
      const result = await removeKnowledgeDocuments([...selected])
      if (result.failed.length > 0) {
        const failedNames = result.failed
          .map((f) => f.filePath.split(/[/\\]/).pop())
          .join('、')
        setSelected(new Set(result.failed.map((f) => f.filePath)))
        toast.error(`部分移除失败：${failedNames}`)
      } else {
        toast.success(`已移除 ${result.success.length} 个文档`)
        setSelected(new Set())
      }
      await loadDocuments()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除失败')
    } finally {
      setRemoving(false)
      setShowConfirm(false)
    }
  }

  return (
    <div
      data-closing={closing || undefined}
      className="gm-kb-modal-scrim fixed inset-0 z-[1100] flex items-center justify-center bg-black/45 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-manager-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <section className="gm-kb-modal-dialog flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-gm-border bg-gm-surface shadow-2xl">
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gm-border px-5 py-4">
          <h2 id="kb-manager-title" className="text-heading font-bold text-gm-text">
            知识库文档管理
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            aria-label="关闭知识库管理"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gm-text-tertiary transition-colors hover:bg-gm-surface-hover hover:text-gm-text"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按文件名搜索..."
          />

          <div className="mt-3">
            {loading && (
              <p className="text-caption text-gm-text-tertiary py-4 text-center">
                加载中...
              </p>
            )}
            {error && !loading && (
              <p className="text-caption text-gm-error py-4 text-center">
                加载失败：{error}
              </p>
            )}
            {!loading && !error && filtered.length === 0 && (
              <p className="text-caption text-gm-text-tertiary py-4 text-center">
                {search.trim() ? '未找到匹配文档' : '暂无已入库文档'}
              </p>
            )}
            {!loading && !error && filtered.length > 0 && (
              <>
                <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none text-caption text-gm-text-secondary border-b border-gm-border-subtle">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="w-4 h-4"
                  />
                  <span>全选当前搜索结果</span>
                </label>
                <div className="divide-y divide-gm-border-subtle">
                  {filtered.map((doc) => {
                    const fileName =
                      doc.title ||
                      doc.filePath.split(/[/\\]/).pop() ||
                      doc.filePath
                    const isSelected = selected.has(doc.filePath)
                    return (
                      <label
                        key={doc.filePath}
                        className="flex items-center gap-2 px-2 py-2 cursor-pointer select-none hover:bg-gm-surface-elevated"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(doc.filePath)}
                          className="w-4 h-4 flex-shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-body text-gm-text truncate">
                            {fileName}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-micro text-gm-text-tertiary">
                              {STATE_LABELS[doc.state] || doc.state}
                            </span>
                            <span
                              className="text-micro text-gm-text-tertiary truncate"
                              title={doc.filePath}
                            >
                              {doc.filePath}
                            </span>
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 items-center justify-between border-t border-gm-border px-5 py-3">
          <span className="text-caption text-gm-text-secondary">
            已选择 {selected.size} 个文档
          </span>
          <Button
            type="primary"
            size="small"
            disabled={selected.size === 0 || removing}
            loading={removing}
            onClick={() => setShowConfirm(true)}
          >
            批量移除
          </Button>
        </footer>
      </section>

      {/* Confirm dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-[1110] flex items-center justify-center bg-black/30 p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowConfirm(false)
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-gm-border bg-gm-surface shadow-xl p-5">
            <h3 className="text-body font-bold text-gm-text mb-3">确认移除</h3>
            <div className="space-y-2 text-body text-gm-text">
              <p>确认移除选中的 {selected.size} 个文档吗？</p>
              <div className="rounded-lg border border-gm-error/30 bg-gm-error/5 px-3 py-2 text-caption text-gm-error">
                <p>仅删除知识库索引/分块数据；</p>
                <p>不会删除用户本地 Markdown 文件。</p>
              </div>
              {autoIndexEnabled && (
                <p className="text-caption text-gm-text-tertiary">
                  自动入库已开启，后续再次打开或保存文档可能重新入库。
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                type="default"
                size="small"
                onClick={() => setShowConfirm(false)}
              >
                取消
              </Button>
              <Button
                type="primary"
                size="small"
                loading={removing}
                onClick={handleRemove}
              >
                确认移除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
