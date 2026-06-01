import type { HelicopterSlotKey } from '../../infrastructure/mission-store/tauri-mission-store'

/**
 * Canonical display order for the four reserved helicopter slots. The order is
 * fixed so the panel, the layer tree, and the map overlay never disagree about
 * which slot is which.
 */
export const HELICOPTER_SLOT_ORDER: readonly HelicopterSlotKey[] = [
  'slot_1',
  'slot_2',
  'slot_3',
  'slot_4',
]

/** Inputs that decide which helicopter slots the panel renders. */
export type HelicopterPanelSlotsInput = {
  /** Slot keys that currently hold an assigned helicopter. */
  readonly assignedSlots: readonly HelicopterSlotKey[]
  /** Whether the operator has chosen to reveal the empty reserve slots. */
  readonly showEmptySlots: boolean
}

/** Result describing the slots to render and how many empties stay hidden. */
export type HelicopterPanelSlotsResult = {
  /** Slot keys to render, always in {@link HELICOPTER_SLOT_ORDER}. */
  readonly visibleSlots: readonly HelicopterSlotKey[]
  /** Number of slots that currently hold a helicopter. */
  readonly assignedCount: number
  /** Number of empty slots hidden behind the deliberate-reveal control. */
  readonly hiddenEmptyCount: number
}

/**
 * Decide which helicopter slots the Tracking-tab panel should show.
 *
 * Helicopters are operationally important but opt-in (DON-75): an assigned
 * slot is always visible, while empty reserve slots stay collapsed until the
 * operator deliberately reveals them. This keeps the default Tracking view
 * uncluttered without ever hiding an aircraft that is actually in use.
 *
 * @param input - Assigned slot keys plus the reveal-empties flag.
 * @returns The ordered slots to render and the hidden-empty slot count.
 */
export function selectHelicopterPanelSlots(
  input: HelicopterPanelSlotsInput,
): HelicopterPanelSlotsResult {
  const assigned = new Set(input.assignedSlots)
  const assignedCount = assigned.size
  const hiddenEmptyCount = input.showEmptySlots
    ? 0
    : HELICOPTER_SLOT_ORDER.length - assignedCount

  const visibleSlots = HELICOPTER_SLOT_ORDER.filter(
    (slotKey) => input.showEmptySlots || assigned.has(slotKey),
  )

  return {
    visibleSlots,
    assignedCount,
    hiddenEmptyCount,
  }
}
