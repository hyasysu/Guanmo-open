import type { ContextTag, ContextTagType } from '@/types/contextTag'

interface ContextTagChipProps {
  tag: ContextTag
  onRemove: (id: string) => void
}

function getTagIcon(type: ContextTagType) {
  switch (type) {
    case 'selection':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
          <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      )
    case 'file':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )
    case 'folder':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
      )
    case 'memory':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
    case 'web':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      )
  }
}

function getTagLabel(tag: ContextTag): string {
  switch (tag.type) {
    case 'selection':
      return tag.startLine
        ? `${tag.title} · L${tag.startLine}${tag.endLine ? `-${tag.endLine}` : ''}`
        : `${tag.title} · 选中文本`
    case 'file':
      return tag.title
    case 'folder':
      return tag.title
    case 'memory':
      return '记忆'
    case 'web':
      return tag.title || 'Web'
  }
}

function getTooltip(tag: ContextTag): string {
  const location = tag.filePath || tag.folderPath
  const lines = tag.startLine
    ? `L${tag.startLine}${tag.endLine ? `-${tag.endLine}` : ''}`
    : ''
  return [tag.preview, location, lines].filter(Boolean).join('\n')
}

export function ContextTagChip({ tag, onRemove }: ContextTagChipProps) {
  const label = getTagLabel(tag)
  const tooltip = getTooltip(tag)

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-gm-border bg-gm-surface-elevated text-gm-primary text-micro max-w-[220px] group animate-slideInUp shadow-sm hover:border-gm-primary/40 hover:bg-gm-primary-subtle/40 transition-colors"
      title={tooltip}
    >
      {getTagIcon(tag.type)}
      <span className="truncate">{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove(tag.id)
        }}
        className="flex-shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-gm-primary/20 transition-colors"
        title="移除"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}
