import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveHeading } from '@/hooks/useActiveHeading'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()
  readonly takeRecords = vi.fn(() => [])
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this)
  }

  emit(target: Element, isIntersecting: boolean, top: number) {
    this.callback([{
      target,
      isIntersecting,
      boundingClientRect: { top },
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function Harness({ headingId }: { headingId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeHeading = useActiveHeading(containerRef)

  return (
    <>
      <div ref={containerRef} data-testid="preview-container">
        <h2 key={headingId} data-heading-id={headingId}>{headingId}</h2>
      </div>
      <output>{activeHeading ?? 'none'}</output>
    </>
  )
}

describe('useActiveHeading', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('observes virtualized headings after the preview scrolls', async () => {
    const { rerender } = render(<Harness headingId="first" />)
    const observer = MockIntersectionObserver.instances[0]
    const firstHeading = screen.getByText('first')

    expect(observer.observe).toHaveBeenCalledWith(firstHeading)
    act(() => observer.emit(firstHeading, true, 20))
    expect(screen.getByText('first', { selector: 'output' })).toBeInTheDocument()
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

    rerender(<Harness headingId="second" />)
    const secondHeading = screen.getByText('second')
    fireEvent.scroll(screen.getByTestId('preview-container'))

    await waitFor(() => {
      expect(observer.unobserve).toHaveBeenCalledWith(firstHeading)
      expect(observer.observe).toHaveBeenCalledWith(secondHeading)
      expect(screen.getByText('none', { selector: 'output' })).toBeInTheDocument()
    })

    act(() => observer.emit(secondHeading, true, 20))
    expect(screen.getByText('second', { selector: 'output' })).toBeInTheDocument()
  })
})
