/**
 * Remember the selected product between launches.
 *
 * The application document owns the selection: main owns the sidecar and the
 * native view but has no opinion about which product the user was last in. The
 * document is served from a fixed origin, so `localStorage` is the natural home
 * and survives an app upgrade the way the traffic-light and sidebar
 * preferences do. A missing, unreadable or malformed value falls back to
 * Superharness rather than failing activation.
 */
import type { ComposerProduct } from './composer-bridge.ts'

/** Storage key holding the last selected product. */
export const PRODUCT_STORAGE_KEY = 'dsh.productSwitcher.product'

/**
 * Read the product the user last selected.
 * @returns the stored product, or `superharness` when there is no usable value.
 */
export function readStoredProduct(): ComposerProduct {
  if (typeof localStorage === 'undefined') return 'superharness'
  try {
    return localStorage.getItem(PRODUCT_STORAGE_KEY) === 'composer' ? 'composer' : 'superharness'
  } catch {
    // Storage can be unavailable (disabled, quota, private mode); the default wins.
    return 'superharness'
  }
}

/**
 * Remember the selected product for the next launch.
 * @param product - product now selected.
 */
export function writeStoredProduct(product: ComposerProduct): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PRODUCT_STORAGE_KEY, product)
  } catch {
    // A failed write only costs the next launch its restored selection.
  }
}
