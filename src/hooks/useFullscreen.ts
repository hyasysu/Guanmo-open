import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { isTauri } from '@/hooks/useTauri'

async function readFullscreenState(): Promise<boolean> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return getCurrentWindow().isFullscreen()
  }
  return Boolean(document.fullscreenElement)
}

async function setFullscreenState(next: boolean): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setFullscreen(next)
    return
  }

  if (next && !document.fullscreenElement) {
    await document.documentElement.requestFullscreen()
  } else if (!next && document.fullscreenElement) {
    await document.exitFullscreen()
  }
}

export function useFullscreen() {
  const isFullscreen = useAppStore((s) => s.isFullscreen)
  const setFullscreen = useAppStore((s) => s.setFullscreen)

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined

    const sync = () => {
      readFullscreenState()
        .then((next) => {
          if (!disposed) setFullscreen(next)
        })
        .catch((err) => console.error('Fullscreen: failed to read state:', err))
    }

    sync()

    if (isTauri()) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          const win = getCurrentWindow()
          win.onResized(sync).then((unlisten) => {
            if (disposed) {
              unlisten()
            } else {
              cleanup = unlisten
            }
          })
        })
        .catch((err) => console.error('Fullscreen: failed to initialize listener:', err))
    } else {
      document.addEventListener('fullscreenchange', sync)
      cleanup = () => document.removeEventListener('fullscreenchange', sync)
    }

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [setFullscreen])

  const changeFullscreen = useCallback(async (next: boolean) => {
    try {
      await setFullscreenState(next)
      setFullscreen(next)
    } catch (err) {
      console.error('Fullscreen: change failed:', err)
    }
  }, [setFullscreen])

  const toggleFullscreen = useCallback(async () => {
    try {
      const current = await readFullscreenState()
      await changeFullscreen(!current)
    } catch (err) {
      console.error('Fullscreen: toggle failed:', err)
    }
  }, [changeFullscreen])

  const enterFullscreen = useCallback(() => changeFullscreen(true), [changeFullscreen])
  const exitFullscreen = useCallback(() => changeFullscreen(false), [changeFullscreen])

  return { isFullscreen, toggleFullscreen, enterFullscreen, exitFullscreen }
}
