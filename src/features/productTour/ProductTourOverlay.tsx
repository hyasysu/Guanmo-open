import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PRODUCT_TOUR_STEPS, type ProductTourPlacement } from './productTourContent'

interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

interface TourLayout {
  rects: RectLike[]
  anchor: RectLike
}

interface CardPosition {
  left: number
  top: number
  placement: ProductTourPlacement
  anchorX: number
  anchorY: number
}

interface ProductTourOverlayProps {
  open: boolean
  stepIndex: number
  onStepChange: (index: number) => void
  onClose: () => void
}

const CARD_WIDTH = 360
const CARD_GAP = 18
const VIEWPORT_PADDING = 16

function readRect(element: Element): RectLike {
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function readLayout(target: string | string[]): TourLayout | null {
  const selectors = Array.isArray(target) ? target : [target]
  const elements = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
  const rects = elements.map(readRect).filter((rect) => rect.width > 0 && rect.height > 0)
  if (rects.length === 0) return null
  const anchor = {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
    width: 0,
    height: 0,
  }
  anchor.width = anchor.right - anchor.left
  anchor.height = anchor.bottom - anchor.top
  return { rects, anchor }
}

function choosePosition(
  anchor: RectLike,
  preferred: ProductTourPlacement,
  cardWidth: number,
  cardHeight: number,
): CardPosition {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const fits = {
    top: anchor.top - CARD_GAP - cardHeight >= VIEWPORT_PADDING,
    right: viewportWidth - anchor.right - CARD_GAP - cardWidth >= VIEWPORT_PADDING,
    bottom: viewportHeight - anchor.bottom - CARD_GAP - cardHeight >= VIEWPORT_PADDING,
    left: anchor.left - CARD_GAP - cardWidth >= VIEWPORT_PADDING,
  }
  const order: ProductTourPlacement[] = [preferred, 'bottom', 'right', 'top', 'left']
  const placement = order.find((candidate, index) => index === 0 ? fits[candidate] : fits[candidate]) ?? 'bottom'
  const clamped = (value: number, max: number) => Math.max(VIEWPORT_PADDING, Math.min(value, max - VIEWPORT_PADDING))
  let left = anchor.left + anchor.width / 2 - cardWidth / 2
  let top = anchor.bottom + CARD_GAP

  if (placement === 'top') {
    left = anchor.left + anchor.width / 2 - cardWidth / 2
    top = anchor.top - CARD_GAP - cardHeight
  } else if (placement === 'right') {
    left = anchor.right + CARD_GAP
    top = anchor.top + anchor.height / 2 - cardHeight / 2
  } else if (placement === 'left') {
    left = anchor.left - CARD_GAP - cardWidth
    top = anchor.top + anchor.height / 2 - cardHeight / 2
  }

  left = clamped(left, viewportWidth - cardWidth)
  top = clamped(top, viewportHeight - cardHeight)
  const anchorX = placement === 'left'
    ? anchor.left
    : placement === 'right'
      ? anchor.right
      : clamped(anchor.left + anchor.width / 2, viewportWidth)
  const anchorY = placement === 'top'
    ? anchor.top
    : placement === 'bottom'
      ? anchor.bottom
      : clamped(anchor.top + anchor.height / 2, viewportHeight)
  return { left, top, placement, anchorX, anchorY }
}

export function ProductTourOverlay({ open, stepIndex, onStepChange, onClose }: ProductTourOverlayProps) {
  const step = PRODUCT_TOUR_STEPS[stepIndex]
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<TourLayout | null>(null)
  const [position, setPosition] = useState<CardPosition | null>(null)
  const [targetMissing, setTargetMissing] = useState(false)

  const measure = useCallback(() => {
    if (!open || !step) return
    const nextLayout = readLayout(step.target)
    setLayout(nextLayout)
    setTargetMissing(!nextLayout)
    if (!nextLayout) {
      setPosition(null)
      return
    }
    const cardRect = cardRef.current?.getBoundingClientRect()
    setPosition(choosePosition(
      nextLayout.anchor,
      step.placement,
      cardRect?.width || CARD_WIDTH,
      cardRect?.height || 220,
    ))
  }, [open, step])

  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    let attempts = 0
    const retryMeasure = () => {
      measure()
      if (attempts < 8) {
        attempts += 1
        frame = window.requestAnimationFrame(retryMeasure)
      }
    }
    retryMeasure()
    return () => window.cancelAnimationFrame(frame)
  }, [measure, open, stepIndex])

  useEffect(() => {
    if (!open) return
    const handleViewportChange = () => measure()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleViewportChange)
    const selectors = Array.isArray(step.target) ? step.target : [step.target]
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => observer?.observe(element))
    })
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      observer?.disconnect()
    }
  }, [measure, open, step.target])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && stepIndex > 0) onStepChange(stepIndex - 1)
      else if (event.key === 'ArrowRight' && stepIndex < PRODUCT_TOUR_STEPS.length - 1) onStepChange(stepIndex + 1)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    cardRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, onStepChange, open, stepIndex])

  if (!open || !step || typeof document === 'undefined') return null

  const isLastStep = stepIndex === PRODUCT_TOUR_STEPS.length - 1
  const cardStyle = targetMissing || !position
    ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    : { left: position.left, top: position.top }

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] bg-black/55"
      role="presentation"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {layout?.rects.map((rect, index) => (
        <div
          key={`${step.id}-${index}`}
          className="pointer-events-none fixed rounded-xl border-2 border-gm-primary shadow-[0_0_0_4px_color-mix(in_srgb,var(--gm-primary)_22%,transparent),0_0_24px_color-mix(in_srgb,var(--gm-primary)_45%,transparent)]"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      ))}
      {position && layout && (
        <svg className="pointer-events-none fixed inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <marker id="product-tour-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0L8 4L0 8Z" fill="var(--gm-primary)" />
            </marker>
          </defs>
          <line
            x1={position.left + CARD_WIDTH / 2}
            y1={position.placement === 'top' ? position.top + 220 : position.top}
            x2={position.anchorX}
            y2={position.anchorY}
            stroke="var(--gm-primary)"
            strokeWidth="2"
            strokeDasharray="5 4"
            markerEnd="url(#product-tour-arrow)"
          />
        </svg>
      )}
      <div
        ref={cardRef}
        className="fixed w-[min(360px,calc(100vw-32px))] rounded-2xl border border-gm-border bg-gm-surface p-5 text-gm-text shadow-2xl outline-none"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-tour-title"
        aria-describedby="product-tour-description"
        tabIndex={-1}
      >
        <div className="mb-1 text-micro font-bold uppercase tracking-wider text-gm-primary">
          观墨使用导览 · {stepIndex + 1}/{PRODUCT_TOUR_STEPS.length}
        </div>
        <h2 id="product-tour-title" className="text-heading font-bold">{step.title}</h2>
        <p id="product-tour-description" className="mt-3 whitespace-pre-line text-body leading-relaxed text-gm-text-secondary">
          {targetMissing ? '当前界面暂时无法定位该功能，你可以继续查看下一步。' : step.content}
        </p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" className="text-caption text-gm-text-tertiary hover:text-gm-text" onClick={onClose}>跳过</button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-gm-border px-3 py-1.5 text-caption text-gm-text-secondary hover:border-gm-primary/50 hover:text-gm-primary disabled:cursor-not-allowed disabled:opacity-40"
              disabled={stepIndex === 0}
              onClick={() => onStepChange(stepIndex - 1)}
            >
              上一步
            </button>
            <button
              type="button"
              className="rounded-lg bg-gm-primary px-3 py-1.5 text-caption font-bold text-white hover:bg-gm-primary-hover"
              onClick={() => isLastStep ? onClose() : onStepChange(stepIndex + 1)}
            >
              {isLastStep ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
