import { useEffect } from 'react'
import { isTauri } from '@/hooks/useTauri'
import { checkForUpdates } from '@/services/updateService'
import { showAvailableUpdate } from '@/services/updateNotifications'
import { UpdateDetailsModal } from './UpdateDetailsModal'

const STARTUP_CHECK_DELAY_MS = 7_000

export function UpdateManager() {
  useEffect(() => {
    if (!isTauri()) return
    let active = true
    const timer = window.setTimeout(() => {
      void checkForUpdates()
        .then((result) => {
          if (active && result.status === 'available') showAvailableUpdate(result.update)
        })
        .catch(() => {
          // 启动检查必须静默失败，不能影响应用初始化。
        })
    }, STARTUP_CHECK_DELAY_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [])

  return <UpdateDetailsModal />
}
