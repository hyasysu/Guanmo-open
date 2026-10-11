import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Matches the width transition in layoutMotion.css; no per-frame React updates.
const SIDEBAR_TRANSITION_MS = 220

export function useSidebarContent(open: boolean, focusTarget: string, { keepMounted = false, active = true } = {}) {
  const [retained, setRetained] = useState(open)
  const contentRef = useRef<HTMLDivElement>(null)
  const present = active && (open || retained)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    if (!open && content.contains(document.activeElement)) {
      const target = document.querySelector<HTMLElement>(focusTarget)
      if (target) target.focus({ preventScroll: true })
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    content.inert = !open
  }, [open, present, focusTarget])

  useEffect(() => {
    if (!active) {
      setRetained(false)
      return
    }
    if (open) {
      setRetained(true)
      return
    }
    if (keepMounted) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setRetained(false), reducedMotion ? 0 : SIDEBAR_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [open, keepMounted, active])

  return { contentRef, present }
}
