import { useEffect, useRef } from 'react'
import { isTauri } from '@/hooks/useTauri'

/**
 * 在数据库就绪后启动使用时长统计，卸载时停止。
 * Web 端不执行任何操作。
 *
 * @param ready - 数据库是否已就绪，就绪后才启动统计
 */
export function useUsageTracking(ready: boolean): void {
  const startedRef = useRef(false)

  useEffect(() => {
    if (!isTauri() || !ready || startedRef.current) return

    startedRef.current = true
    let cancelled = false
    const trackingModule = import('@/services/usageTracking')

    void trackingModule.then(({ startUsageTracking }) => {
      if (cancelled) return
      return startUsageTracking().catch(() => {
        startedRef.current = false
        console.warn('[useUsageTracking] start failed')
      })
    })

    return () => {
      cancelled = true
      startedRef.current = false
      void trackingModule.then(({ stopUsageTracking }) => stopUsageTracking().catch(() => {
        console.warn('[useUsageTracking] stop failed')
      })
      )
    }
  }, [ready])
}
