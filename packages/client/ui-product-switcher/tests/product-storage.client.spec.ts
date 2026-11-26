// @vitest-environment jsdom
/** The persisted product selection: every unusable storage state falls back, none throws. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_STORAGE_KEY, readStoredProduct, writeStoredProduct } from '../src/client/product-storage.ts'

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks() })

/**
 * Run `body` with `window.localStorage` replaced by `stub`, then restore.
 *
 * jsdom's `Storage` is Proxy-backed: assigning to one of its methods leaves the
 * proxy's own read path untouched, so `vi.spyOn` cannot make it throw. A
 * disabled, partitioned or full store is exactly that case, and replacing the
 * property is the only faithful way to reach it. The property is an own
 * configurable accessor, and it is restored in `finally` so a failed assertion
 * cannot leave the next case without storage.
 * @param stub - value to expose as `localStorage`, or `undefined` for none.
 * @param body - assertions to run against it.
 */
function withLocalStorage(stub: unknown, body: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', { configurable: true, value: stub })
  try {
    body()
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(window, 'localStorage')
    else Object.defineProperty(window, 'localStorage', descriptor)
  }
}

/** A `Storage` whose every access throws, as a disabled or read-only store does. */
const throwingStorage = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('quota') },
  removeItem: () => { throw new Error('denied') },
  clear: () => { throw new Error('denied') },
  key: () => { throw new Error('denied') },
  length: 0,
}

describe('readStoredProduct', () => {
  it('restores the product the user last selected', () => {
    window.localStorage.setItem(PRODUCT_STORAGE_KEY, 'composer')
    expect(readStoredProduct()).toBe('composer')
  })

  it('falls back to Superharness when nothing is stored', () => {
    // The key is absent on a first launch after install or upgrade.
    expect(window.localStorage.getItem(PRODUCT_STORAGE_KEY)).toBeNull()
    expect(readStoredProduct()).toBe('superharness')
  })

  it('falls back for a value this build does not know', () => {
    // Storage outlives the build that wrote it, so a value from a newer or
    // hand-edited entry must not select a product that does not exist.
    window.localStorage.setItem(PRODUCT_STORAGE_KEY, 'something-else')
    expect(readStoredProduct()).toBe('superharness')
  })

  it('falls back when storage itself throws', () => {
    // A disabled or partitioned store throws on access rather than returning
    // null. Activation must still complete.
    withLocalStorage(throwingStorage, () => { expect(readStoredProduct()).toBe('superharness') })
  })

  it('falls back when there is no storage at all', () => {
    // Server-side rendering and the node e2e boot have no `localStorage`.
    withLocalStorage(undefined, () => { expect(readStoredProduct()).toBe('superharness') })
  })
})

describe('writeStoredProduct', () => {
  it('records the selection for the next launch', () => {
    writeStoredProduct('composer')
    expect(window.localStorage.getItem(PRODUCT_STORAGE_KEY)).toBe('composer')
    writeStoredProduct('superharness')
    expect(window.localStorage.getItem(PRODUCT_STORAGE_KEY)).toBe('superharness')
  })

  it('swallows a failed write', () => {
    // A full or read-only store costs the next launch its restored selection and
    // nothing else; the switch itself has already happened.
    withLocalStorage(throwingStorage, () => { expect(() => { writeStoredProduct('composer') }).not.toThrow() })
  })

  it('does nothing without storage', () => {
    withLocalStorage(undefined, () => { expect(() => { writeStoredProduct('composer') }).not.toThrow() })
  })
})
