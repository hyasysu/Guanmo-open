import { create } from 'zustand'

export type ToastType = 'success' | 'info' | 'warning' | 'error'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  createdAt: number
}

interface ToastState {
  toasts: ToastItem[]
  timers: Map<string, ReturnType<typeof setTimeout>>
  addToast: (message: string, type: ToastType) => void
  removeToast: (id: string) => void
}

const MAX_TOASTS = 3
const AUTO_DISMISS_MS = 3000
const DEDUP_WINDOW_MS = 2000

let nextId = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  timers: new Map(),

  addToast: (message, type) => {
    const state = get()
    const now = Date.now()

    // 去重：2 秒内相同 message+type → 重置计时器
    const existing = state.toasts.find(
      (t) => t.message === message && t.type === type && now - t.createdAt < DEDUP_WINDOW_MS
    )
    if (existing) {
      // 重置自动消失计时器
      const oldTimer = state.timers.get(existing.id)
      if (oldTimer) clearTimeout(oldTimer)
      if (type !== 'error') {
        const newTimer = setTimeout(() => get().removeToast(existing.id), AUTO_DISMISS_MS)
        const newTimers = new Map(state.timers)
        newTimers.set(existing.id, newTimer)
        set({ timers: newTimers })
      }
      return
    }

    const id = `toast-${++nextId}`
    const toast: ToastItem = { id, message, type, createdAt: now }

    set((s) => {
      let toasts = [...s.toasts, toast]
      // 超过上限，移除最旧的
      if (toasts.length > MAX_TOASTS) {
        const removed = toasts.slice(0, toasts.length - MAX_TOASTS)
        const newTimers = new Map(s.timers)
        for (const t of removed) {
          const timer = newTimers.get(t.id)
          if (timer) clearTimeout(timer)
          newTimers.delete(t.id)
        }
        toasts = toasts.slice(-MAX_TOASTS)
        return { toasts, timers: newTimers }
      }
      return { toasts }
    })

    // error 类型不自动消失
    if (type !== 'error') {
      const timer = setTimeout(() => get().removeToast(id), AUTO_DISMISS_MS)
      set((s) => {
        const newTimers = new Map(s.timers)
        newTimers.set(id, timer)
        return { timers: newTimers }
      })
    }
  },

  removeToast: (id) => {
    set((s) => {
      const timer = s.timers.get(id)
      if (timer) clearTimeout(timer)
      const newTimers = new Map(s.timers)
      newTimers.delete(id)
      return {
        toasts: s.toasts.filter((t) => t.id !== id),
        timers: newTimers,
      }
    })
  },
}))
