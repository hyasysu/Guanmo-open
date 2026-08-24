import type { TocItem } from '@/services/markdownToc'

interface MarkdownTocSection {
  key: string
  title: string
  toc: TocItem[]
  onHeadingClick: (item: TocItem) => void
  emptyText?: string
  activeHeading?: string | null
}

export function MarkdownToc({
  toc = [],
  collapsed,
  onToggle,
  onHeadingClick,
  sections,
  activeHeading,
}: {
  toc?: TocItem[]
  collapsed: boolean
  onToggle: () => void
  onHeadingClick?: (item: TocItem) => void
  sections?: MarkdownTocSection[]
  activeHeading?: string | null
}) {
  const explicitSections = sections && sections.length > 0
    ? sections.slice(0, 2)
    : null
  const visibleSections = explicitSections
    ? explicitSections
    : toc.length > 1
      ? [{ key: 'toc', title: '目录', toc, onHeadingClick: onHeadingClick ?? (() => {}) }]
      : []
  const dualColumn = visibleSections.length > 1

  if (visibleSections.length === 0) return null

  return (
    <aside
      className={`gm-markdown-toc relative h-full flex-shrink-0 ${dualColumn ? 'gm-markdown-toc--dual' : ''} ${
        collapsed ? 'w-0' : 'gm-markdown-toc--expanded border-l border-gm-border-subtle bg-gm-surface'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? '展开目录' : '收起目录'}
        aria-expanded={!collapsed}
        className="absolute left-0 top-1/2 z-10 flex h-12 w-5 -translate-x-full -translate-y-1/2 items-center justify-center rounded-l-2xl border border-r-0 border-gm-border bg-gm-surface text-gm-text-tertiary shadow-sm hover:border-gm-primary/40 hover:bg-gm-surface-hover hover:text-gm-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gm-primary/40"
        title={collapsed ? '展开目录' : '收起目录'}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={collapsed ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
        </svg>
      </button>
      {!collapsed && (
        <nav aria-label="文档目录" className="h-full pl-4 pr-0 py-3 text-micro text-gm-text-tertiary">
          <div className={dualColumn ? 'flex h-full gap-3 overflow-hidden' : 'max-h-full space-y-4 overflow-y-auto'}>
            {visibleSections.map((section) => (
              <section key={section.key} className={dualColumn ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'pr-4'}>
                <div className="mb-2 truncate font-bold text-gm-text-secondary" title={section.title}>
                  {section.title}
                </div>
                <div className={dualColumn ? 'min-h-0 flex-1 space-y-1 overflow-y-auto' : 'space-y-1'}>
                  {section.toc.length > 1 ? (
                    section.toc.map((item) => {
                      const currentActive = section.activeHeading !== undefined ? section.activeHeading : activeHeading
                      const isActive = currentActive === item.id
                      return (
                        <button
                          key={`${section.key}-${item.id}-${item.line}`}
                          type="button"
                          onClick={() => section.onHeadingClick(item)}
                          className={`block w-full truncate rounded-md py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gm-primary/30 ${
                            isActive
                              ? 'font-bold'
                              : 'hover:bg-gm-surface-hover hover:text-gm-primary'
                          }`}
                          style={{
                            paddingLeft: 6 + Math.max(0, item.level - 1) * 10,
                            ...(isActive ? {
                              backgroundColor: 'color-mix(in srgb, var(--gm-active-indicator) 10%, transparent)',
                              color: 'var(--gm-active-indicator)',
                            } : {}),
                          }}
                          title={`${item.text}（第 ${item.line} 行）`}
                        >
                          {item.text}
                        </button>
                      )
                    })
                  ) : (
                    <div className="rounded-md border border-dashed border-gm-border-subtle px-3 py-2 text-gm-text-muted">
                      {section.emptyText ?? '无目录'}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </nav>
      )}
    </aside>
  )
}
