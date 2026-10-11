import type { OriginalSelectionSnapshot } from '@/services/originalSelections'

export function OriginalSelections({ selections }: { selections: readonly OriginalSelectionSnapshot[] }) {
  if (!selections.length) return null
  return <details className="mt-3 rounded-xl border border-gm-border-subtle bg-gm-canvas/45 px-3 py-2 text-caption">
    <summary className="cursor-pointer text-micro font-bold text-gm-text-secondary">原始选区 · {selections.length}</summary>
    <div className="mt-2 space-y-3">{selections.map((selection, index) => <section key={index}>
      <div className="mb-1 break-words text-micro text-gm-text-tertiary">{selection.title}{selection.startLine ? ` · L${selection.startLine}-${selection.endLine}` : ''}{!selection.filePath && ' · 未绑定文件'}{selection.previewOnly ? ' · 仅预览片段' : selection.truncated ? ' · 内容已截断' : ''}</div>
      <div tabIndex={0} aria-label={`原始选区 ${index + 1}`} className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words select-text text-gm-text" style={{ fontSize: 'var(--gm-ai-chat-font-size)' }}>{selection.text}</div>
    </section>)}</div>
  </details>
}
