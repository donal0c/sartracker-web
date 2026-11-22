/**
 * Where the one side panel sits in the simplified workspace.
 *
 * - `right`: panel on the right, open on People by default (trial layout A).
 * - `left`: panel on the left, open on People by default (trial layout B).
 * - `map-first`: panel on the right, closed by default so the map fills the screen (trial layout C).
 */
export type PanelArrangement = 'right' | 'left' | 'map-first'

/**
 * The one place the desktop arrangement is chosen.
 *
 * The team lead approved the simplified layout on 21 Nov 2026 but has not yet
 * said which trial letter he used (DON-341). `right` (A) is the default until he
 * confirms; changing this constant is the whole change.
 */
export const DESKTOP_PANEL_ARRANGEMENT: PanelArrangement = 'right'

/** Which side of the map the panel sits on. */
export function panelSide(arrangement: PanelArrangement): 'left' | 'right' {
  return arrangement === 'left' ? 'left' : 'right'
}

/** Whether the panel starts open on People, or closed so the map fills the screen. */
export function panelOpenByDefault(arrangement: PanelArrangement): boolean {
  return arrangement !== 'map-first'
}
