export const FOCUSABLE_ELEMENT_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Returns tabbable descendants that should participate in an overlay focus trap.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENT_SELECTOR)).filter(
    (element) => isFocusableElement(element),
  )
}

/**
 * Moves focus into an overlay, preferring the first actionable control.
 */
export function focusFirstElement(container: HTMLElement): void {
  const [firstFocusable] = getFocusableElements(container)
  ;(firstFocusable ?? container).focus()
}

/**
 * Restores focus to the opener when that element still exists in the document.
 */
export function restoreFocus(element: Element | null): void {
  if (element instanceof HTMLElement && document.contains(element)) {
    element.focus()
  }
}

/**
 * Keeps Tab and Shift+Tab navigation inside a modal overlay.
 */
export function trapTabKey(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') {
    return
  }

  const focusableElements = getFocusableElements(container)
  if (focusableElements.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }

  const firstFocusable = focusableElements[0]!
  const lastFocusable = focusableElements[focusableElements.length - 1]!
  const activeElement = document.activeElement

  if (event.shiftKey && activeElement === firstFocusable) {
    event.preventDefault()
    lastFocusable.focus()
    return
  }

  if (!event.shiftKey && activeElement === lastFocusable) {
    event.preventDefault()
    firstFocusable.focus()
  }
}

function isFocusableElement(element: HTMLElement): boolean {
  if (element.hasAttribute('disabled')) {
    return false
  }

  if (element.getAttribute('aria-hidden') === 'true') {
    return false
  }

  if (element.tabIndex < 0) {
    return false
  }

  return true
}
