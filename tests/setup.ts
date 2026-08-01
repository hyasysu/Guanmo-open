import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })

  if (typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver !== 'function') {
    class ResizeObserverStub {
      private _cb: ResizeObserverCallback
      private _targets = new Set<Element>()
      constructor(cb: ResizeObserverCallback) { this._cb = cb }
      observe(target: Element) {
        this._targets.add(target)
      }
      unobserve(target: Element) {
        this._targets.delete(target)
      }
      disconnect() {
        this._targets.clear()
      }
    }
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: ResizeObserverStub,
    })
  }
}
