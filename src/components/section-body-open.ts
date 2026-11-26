import { createContext, useContext } from 'react'

/** Whether the enclosing Mission Control section body is shown; true outside any fold. */
export const SectionBodyOpenContext = createContext(true)

/**
 * True while the enclosing Mission Control section body is shown. A control
 * inside a fold uses it to drop a half-finished question when folded, so a
 * hidden confirm is never left armed (DON-373).
 */
export function useSectionBodyOpen(): boolean {
  return useContext(SectionBodyOpenContext)
}
