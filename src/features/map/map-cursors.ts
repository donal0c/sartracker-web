const OPERATIONAL_CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%23FFFFFF' stroke-width='5'/%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%23EF4444' stroke-width='3'/%3E%3Cpath d='M16 2v10M16 20v10M2 16h10M20 16h10' stroke='%23FFFFFF' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M16 2v10M16 20v10M2 16h10M20 16h10' stroke='%23EF4444' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='16' cy='16' r='2.5' fill='%23DC2626' stroke='%23FFFFFF' stroke-width='1.5'/%3E%3C/svg%3E") 16 16, crosshair`

/**
 * Returns the high-contrast map cursor used for active map operations.
 */
export function createOperationalCrosshairCursor(): string {
  return OPERATIONAL_CROSSHAIR_CURSOR
}
