/** Supplies only the browser timer surface required by the imported poller in Node tests. */
interface Window {
  readonly setTimeout: typeof globalThis.setTimeout
  readonly clearTimeout: typeof globalThis.clearTimeout
  readonly sessionStorage: {
    readonly getItem: (key: string) => string | null
    readonly setItem: (key: string, value: string) => void
    readonly removeItem: (key: string) => void
  }
}

declare const window: Window
