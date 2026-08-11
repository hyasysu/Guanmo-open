export const PRODUCT_TOUR_INVITE_KEY = 'guanmo-product-tour-invite-v1'

export function hasShownProductTourInvite(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(PRODUCT_TOUR_INVITE_KEY) === '1'
  } catch {
    return false
  }
}

export function markProductTourInviteShown(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PRODUCT_TOUR_INVITE_KEY, '1')
  } catch {
    // A storage failure must not prevent the first-run prompt from appearing.
  }
}
