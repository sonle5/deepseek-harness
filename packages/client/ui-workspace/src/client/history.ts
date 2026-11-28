/** Back/forward stack of the views visited in one window. */

/**
 * Ordered visits with one current position, as in a browser tab: a new visit
 * drops every entry after the current one, and stepping moves the position
 * without changing the entries.
 */
export class NavigationHistory<T> {
  private entries: T[] = []
  private index = -1

  /** @param same - whether two entries name the same view; a visit equal to the current entry is not recorded. */
  constructor(private readonly same: (left: T, right: T) => boolean) {}

  /** @returns the entry at the current position, or undefined before the first visit. */
  get current(): T | undefined {
    return this.entries[this.index]
  }

  /** @returns whether an entry precedes the current one. */
  get canGoBack(): boolean {
    return this.index > 0
  }

  /** @returns whether an entry follows the current one. */
  get canGoForward(): boolean {
    return this.index < this.entries.length - 1
  }

  /**
   * Record a visit after the current entry, dropping the entries after it.
   * @param entry - the view now shown.
   * @returns false when the entry equals the current one, which records nothing.
   */
  push(entry: T): boolean {
    const current = this.current
    if (current !== undefined && this.same(current, entry)) return false
    this.entries = [...this.entries.slice(0, this.index + 1), entry]
    this.index = this.entries.length - 1
    return true
  }

  /**
   * Move to the nearest earlier entry that `show` accepts.
   * @param show - shows one entry and returns false when it can no longer be shown, which skips it.
   * @returns whether the position moved; it stays when `show` accepts no earlier entry.
   */
  back(show: (entry: T) => boolean): boolean {
    return this.step(-1, show)
  }

  /**
   * Move to the nearest later entry that `show` accepts.
   * @param show - shows one entry and returns false when it can no longer be shown, which skips it.
   * @returns whether the position moved; it stays when `show` accepts no later entry.
   */
  forward(show: (entry: T) => boolean): boolean {
    return this.step(1, show)
  }

  /**
   * Swap the current entry for another without adding a visit; records the first visit when empty.
   * @param entry - the view now shown in place of the current one.
   */
  replace(entry: T): void {
    if (this.index < 0) this.push(entry)
    else this.entries[this.index] = entry
  }

  /**
   * Record that the current entry was closed and `shown` is visible again: step back when `shown` is the
   * entry before the current one, keeping the closed entry ahead of the position; otherwise record a visit.
   * @param shown - the view the closed entry uncovered.
   */
  dismiss(shown: T): void {
    const previous = this.entries[this.index - 1]
    if (previous !== undefined && this.same(previous, shown)) this.index -= 1
    else this.push(shown)
  }

  private step(direction: 1 | -1, show: (entry: T) => boolean): boolean {
    for (let index = this.index + direction; index >= 0 && index < this.entries.length; index += direction) {
      if (show(this.entries[index] as T)) {
        this.index = index
        return true
      }
    }
    return false
  }
}
