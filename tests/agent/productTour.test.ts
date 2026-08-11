import { beforeEach, describe, expect, it } from 'vitest'
import { PRODUCT_TOUR_STEPS } from '@/features/productTour/productTourContent'
import {
  hasShownProductTourInvite,
  markProductTourInviteShown,
  PRODUCT_TOUR_INVITE_KEY,
} from '@/features/productTour/productTourStorage'

describe('product tour', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps the requested seven-step order and targets', () => {
    expect(PRODUCT_TOUR_STEPS).toHaveLength(7)
    expect(PRODUCT_TOUR_STEPS.map((step) => step.id)).toEqual([
      'open-file',
      'sidebar',
      'mode-switcher',
      'preview-edit',
      'ai-assistant',
      'fullscreen',
      'settings',
    ])
    expect(PRODUCT_TOUR_STEPS[0].target).toEqual([
      '[data-product-tour="open-file"]',
      '[data-product-tour="open-folder"]',
    ])
  })

  it('marks the first-run invite as shown without affecting replay', () => {
    expect(hasShownProductTourInvite()).toBe(false)
    markProductTourInviteShown()
    expect(localStorage.getItem(PRODUCT_TOUR_INVITE_KEY)).toBe('1')
    expect(hasShownProductTourInvite()).toBe(true)
  })
})
