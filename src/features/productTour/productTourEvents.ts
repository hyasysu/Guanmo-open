export const OPEN_PRODUCT_TOUR_EVENT = 'guanmo:open-product-tour'

export function requestProductTour() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_PRODUCT_TOUR_EVENT))
}
