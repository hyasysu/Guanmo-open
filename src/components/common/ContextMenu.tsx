import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuPosition {
  x: number
  y: number
}

export function ContextMenu({
  position,
  onClose,
  children,
  minWidth = 160,
  maxWidth,
}: {
  position: ContextMenuPosition
  onClose: () => void
  children: React.ReactNode
  minWidth?: number
  maxWidth?: number
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjusted, setAdjusted] = useState(position)

  useEffect(() => {
    setAdjusted(position)
  }, [position])

  useEffect(() => {
    const handleClose = () => onClose()
    window.addEventListener('click', handleClose)
    window.addEventListener('scroll', handleClose, true)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('scroll', handleClose, true)
    }
  }, [onClose])

  useLayoutEffect(() => {
    if (!menuRef.current) return
    const width = menuRef.current.offsetWidth
    const height = menuRef.current.offsetHeight
    const margin = 4
    const x = Math.max(margin, Math.min(position.x, window.innerWidth - width - margin))
    const preferredY = position.y + height + margin > window.innerHeight
      ? position.y - height
      : position.y
    const y = Math.max(margin, Math.min(preferredY, window.innerHeight - height - margin))
    if (x !== adjusted.x || y !== adjusted.y) {
      setAdjusted({ x, y })
    }
  }, [adjusted.x, adjusted.y, position])

  return (
    <div
      ref={menuRef}
      className="fixed z-50 rounded-xl border border-gm-border bg-gm-surface py-1 shadow-lg animate-bounceIn overflow-hidden"
      style={{ left: adjusted.x, top: adjusted.y, minWidth, maxWidth }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

export function ContextMenuItem({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  if (!children) return null

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full px-4 py-1.5 text-left text-caption text-gm-text-secondary transition-colors hover:bg-gm-surface-hover hover:text-gm-text disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  )
}

export function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-gm-border-subtle" />
}
