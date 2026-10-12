/// <reference lib="es2022.intl" />
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { MORPHING_MOTION_TOKENS } from '@/components/common/useMorphingMotion'

const wordSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh', { granularity: 'word' })
  : null

function splitWords(text: string, offset = 0, animate = true) {
  const words = wordSegmenter
    ? Array.from(wordSegmenter.segment(text), ({ segment }) => segment)
    : Array.from(text)
  return words.map((text) => {
    const word = { text, offset, animate }
    offset += text.length
    return word
  })
}

// Measure natural content rather than scaling the text with a layout transform.
export function StreamingBubbleContent({ active, children }: { active: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const reducedMotion = useReducedMotion() ?? false

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!active || reducedMotion || !content || typeof ResizeObserver !== 'function') return
    const measure = () => setHeight(content.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [active, reducedMotion])

  return (
    <motion.div
      initial={false}
      animate={{ height: active && !reducedMotion && height !== null ? height : 'auto' }}
      transition={reducedMotion ? { duration: 0 } : MORPHING_MOTION_TOKENS.surface}
    >
      <div ref={contentRef} className="flow-root">{children}</div>
    </motion.div>
  )
}

// Presentation only: the chat store keeps the complete content for saving, tools and references.
export function SmoothStreamingText({ content }: { content: string }) {
  const [words, setWords] = useState(() => splitWords(content))
  const visibleRef = useRef(content)
  const targetRef = useRef(content)
  const frameRef = useRef<number | null>(null)
  const framesRemainingRef = useRef(3)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const show = (value: string, animate = true) => {
      const current = visibleRef.current
      visibleRef.current = value
      setWords((words) => animate && value.startsWith(current)
        ? [...words, ...splitWords(value.slice(current.length), current.length)]
        : splitWords(value, 0, false))
    }
    const step = () => {
      frameRef.current = null
      const current = visibleRef.current
      const target = targetRef.current
      if (current === target) return
      const remaining = target.length - current.length
      let end = current.length + Math.max(1, Math.ceil(remaining / framesRemainingRef.current))
      framesRemainingRef.current = Math.max(1, framesRemainingRef.current - 1)
      if (end < target.length && /[\uD800-\uDBFF]/.test(target[end - 1])) end++
      show(target.slice(0, end))
      if (end < target.length) frameRef.current = requestAnimationFrame(step)
      else framesRemainingRef.current = 3
    }

    targetRef.current = content
    const revealImmediately = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      framesRemainingRef.current = 3
      show(targetRef.current, false)
    }
    const onMotionPreferenceChange = () => {
      if (media.matches) revealImmediately()
    }
    const onVisibilityChange = () => {
      if (document.hidden) revealImmediately()
    }
    if (document.hidden || media.matches
      || !content.startsWith(visibleRef.current)) {
      revealImmediately()
    } else if (frameRef.current === null && content !== visibleRef.current) {
      frameRef.current = requestAnimationFrame(step)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    media.addEventListener?.('change', onMotionPreferenceChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      media.removeEventListener?.('change', onMotionPreferenceChange)
    }
  }, [content])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  return (
    <span>
      {words.map(({ text, offset, animate }) => (
        <span key={offset} className={animate && text.trim() ? 'gm-streaming-word' : undefined}>{text}</span>
      ))}
    </span>
  )
}
