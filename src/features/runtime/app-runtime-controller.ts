export type AppRuntimeController = {
  readonly reloadSettings: (options?: { readonly forceConnect?: boolean }) => Promise<void>
}

let controller: AppRuntimeController | null = null

export function applyAppRuntimeController(nextController: AppRuntimeController): void {
  controller = nextController
}

export function getAppRuntimeController(): AppRuntimeController | null {
  return controller
}
