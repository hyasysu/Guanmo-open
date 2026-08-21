import { useEffect, useRef, useState } from 'react'

/** 滚动几何快照：resolver 基于它计算当前活跃标题 */
export interface ActiveHeadingGeometry {
  scrollTop: number
  viewportHeight: number
}

export type ActiveHeadingResolver = (geometry: ActiveHeadingGeometry) => string | null

/**
 * 基于滚动几何计算当前"活跃"标题 ID。
 *
 * 目录当前项按"滚动位置之前最后一个标题"计算（由 resolver 基于全文模型/目录实现），
 * 不依赖标题 DOM 是否仍在虚拟窗口内：长章节中标题块卸载后目录项不再变空。
 * resolver 返回 null 表示当前无活跃标题。
 *
 * @param containerRef - 滚动容器的 ref
 * @param resolveActiveHeading - 滚动几何 → 活跃标题 ID 的模型驱动计算
 * @param trigger - 额外的触发依赖，当容器/内容可能变化时传入（如 viewMode、文档版本）
 * @param enabled - 容器不可见时禁用
 */
export function useActiveHeading(
  containerRef: React.RefObject<HTMLElement | null>,
  resolveActiveHeading: ActiveHeadingResolver | null,
  trigger?: unknown,
  enabled: boolean = true
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    setActiveId(null)
    if (!enabled || !resolveActiveHeading) return

    let disposed = false
    let removeListeners: (() => void) | null = null

    const compute = () => {
      if (disposed) return
      const container = containerRef.current
      if (!container) return
      const next = resolveActiveHeading({
        scrollTop: container.scrollTop,
        viewportHeight: container.clientHeight,
      })
      setActiveId((current) => (current === next ? current : next))
    }

    // 使用 rAF 循环检测容器是否已挂载
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

      const scheduleCompute = () => {
        if (rafRef.current !== null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          compute()
        })
      }
      container.addEventListener('scroll', scheduleCompute, { passive: true })
      // 视口尺寸变化（如分栏拖动）时按新几何重算
      const resizeObserver = new ResizeObserver(scheduleCompute)
      resizeObserver.observe(container)
      removeListeners = () => {
        container.removeEventListener('scroll', scheduleCompute)
        resizeObserver.disconnect()
      }
      compute()
    }

    tryObserve()

    return () => {
      disposed = true
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      removeListeners?.()
    }
  }, [containerRef, resolveActiveHeading, trigger, enabled])

  return activeId
}
