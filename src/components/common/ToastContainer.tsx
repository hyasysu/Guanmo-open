import { useToastStore, type ToastItem } from '@/stores/toastStore'

const TYPE_STYLES: Record<ToastItem['type'], string> = {
  success: 'bg-[var(--gm-success)]',
  info: 'bg-[var(--gm-primary)]',
  warning: 'bg-[var(--gm-warning)]',
  error: 'bg-[var(--gm-error)]',
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-14 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto animate-toast-in flex items-center gap-3 px-4 py-2.5 min-w-[240px] max-w-[360px] bg-gm-surface/95 border border-gm-border rounded-xl shadow-[0_8px_24px_0_rgba(61,52,40,0.14)] backdrop-blur-sm"
        >
          <div className={`w-1 h-full min-h-[20px] rounded-full shrink-0 ${TYPE_STYLES[t.type]}`} />
          <span className="flex-1 text-[13px] leading-[1.4] text-gm-text break-words">{t.message}</span>
          {t.type === 'error' && (
            <button
              onClick={() => removeToast(t.id)}
              className="shrink-0 p-0.5 rounded text-gm-text-tertiary hover:text-gm-text transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
