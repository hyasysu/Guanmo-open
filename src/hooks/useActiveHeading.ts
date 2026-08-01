import { useEffect, useRef, useState } from 'react'

/**
 * 使用 IntersectionObserver 监听标题元素可见性
 * 返回当前在视口中"活跃"的标题 ID
 *
 * @param containerRef - 滚动容器的 ref
 * @param headingSelector - 标题元素的选择器
 * @param trigger - 额外的触发依赖，当容器可能变化时传入（如 viewMode）
 */
export function useActiveHeading(
  containerRef: React.RefObject<HTMLElement | null>,
  headingSelector: string = '[data-heading-id]',
  trigger?: unknown,
  enabled: boolean = true
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const headingPositionsRef = useRef<Map<string, number>>(new Map())
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // 清理旧的 observer
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    setActiveId(null)

    const headingPositions = headingPositionsRef.current
    headingPositions.clear()

    if (!enabled) return

    const updateActiveHeading = (clearWhenEmpty = false) => {
      if (headingPositions.size === 0) {
        if (clearWhenEmpty) setActiveId(null)
        return
      }

      let closestId: string | null = null
      let closestTop = -Infinity

      headingPositions.forEach((top, id) => {
        if (top >= 0 && (closestId === null || top < closestTop)) {
          closestTop = top
          closestId = id
        }
      })

      if (closestId === null) {
        let minDistance = Infinity
        headingPositions.forEach((top, id) => {
          const distance = Math.abs(top)
          if (distance < minDistance) {
            minDistance = distance
            closestId = id
          }
        })
      }

      setActiveId(closestId)
    }

    // 使用 rAF 循环检测容器是否已挂载
    let disposed = false
    let removeScrollListener: (() => void) | null = null

    const tryObserve = () => {
      if (disposed) return

      const container = containerRef.current
      if (!container) {
        // 容器还没挂载，下一帧再试
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          tryObserve()
        })
        return
      }

      // 创建 IntersectionObserver
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!observedHeadings.has(entry.target)) return
            const id = entry.target.getAttribute('data-heading-id')
            if (!id) return

            if (entry.isIntersecting) {
              headingPositions.set(id, entry.boundingClientRect.top)
            } else {
              headingPositions.delete(id)
            }
          })

          // 选择最靠近视口顶部的标题
          updateActiveHeading()
        },
        {
          root: container,
          // 触发区域：顶部 0% 到底部 50%
          rootMargin: '0px 0px -50% 0px',
          threshold: 0,
        }
      )
      observerRef.current = observer

      const observedHeadings = new Set<Element>()
      const syncObservedHeadings = () => {
        if (disposed) return

        const currentHeadings = new Set(container.querySelectorAll(headingSelector))
        let removedHeading = false

        observedHeadings.forEach((heading) => {
          if (currentHeadings.has(heading)) return
          observer.unobserve(heading)
          observedHeadings.delete(heading)
          const id = heading.getAttribute('data-heading-id')
          if (id) headingPositions.delete(id)
          removedHeading = true
        })

        currentHeadings.forEach((heading) => {
          if (observedHeadings.has(heading)) return
          observedHeadings.add(heading)
          observer.observe(heading)
        })

        if (removedHeading) updateActiveHeading(true)
      }

      syncObservedHeadings()
      const scheduleHeadingSync = () => {
        if (rafRef.current !== null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          syncObservedHeadings()
        })
      }
      container.addEventListener('scroll', scheduleHeadingSync, { passive: true })
      removeScrollListener = () => container.removeEventListener('scroll', scheduleHeadingSync)
      scheduleHeadingSync()
    }

    tryObserve()

    return () => {
      disposed = true
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      removeScrollListener?.()
      headingPositions.clear()
    }
  }, [containerRef, headingSelector, trigger, enabled])

  return activeId
}
