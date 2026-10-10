import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function ArtifactFilterMenu({ value, onChange, label, ariaLabel, menuLabel, options, disabled = false }: {
  value: string
  onChange: (value: string, trigger: HTMLButtonElement) => void
  label: string
  ariaLabel: string
  menuLabel: string
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const select = (next: string) => {
    if (triggerRef.current) onChange(next, triggerRef.current)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="relative min-w-0 shrink-0 max-w-[160px]">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 max-w-full items-center gap-1.5 rounded-md border border-gm-border bg-gm-surface px-2.5 text-micro font-bold text-gm-text-secondary outline-none transition-colors hover:bg-gm-surface-hover focus-visible:border-gm-primary focus-visible:ring-1 focus-visible:ring-gm-primary/30 disabled:opacity-50"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} strokeWidth={1.8} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={menuLabel} className="absolute right-0 top-full z-30 mt-1 min-w-full max-w-[240px] max-h-64 overflow-y-auto rounded-lg border border-gm-border bg-gm-surface-elevated p-1 shadow-lg">
          {options.map((option) => {
            const selected = value === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => select(option.value)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-micro outline-none transition-colors hover:bg-gm-surface-hover focus-visible:bg-gm-surface-hover ${selected ? 'font-bold text-gm-primary' : 'text-gm-text-secondary'}`}
              >
                <span className="truncate">{option.label}</span>
                <Check size={13} strokeWidth={2} className={selected ? 'opacity-100' : 'opacity-0'} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
