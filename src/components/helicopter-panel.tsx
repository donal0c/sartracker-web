import { useEffect, useMemo, useState } from 'react'

import type {
  Helicopter,
  HelicopterSlotKey,
} from '../infrastructure/mission-store/tauri-mission-store'
import { useHelicopterStore } from '../features/helicopters/helicopter-store'

const SLOT_CONFIG: readonly {
  readonly slotKey: HelicopterSlotKey
  readonly title: string
  readonly color: string
}[] = [
  { slotKey: 'slot_1', title: 'Rescue 118', color: 'bg-rose-400' },
  { slotKey: 'slot_2', title: 'Rescue 115', color: 'bg-emerald-400' },
  { slotKey: 'slot_3', title: 'Air Corps 1', color: 'bg-sky-400' },
  { slotKey: 'slot_4', title: 'Air Corps 2', color: 'bg-fuchsia-400' },
]

export function HelicopterPanel() {
  const controller = useHelicopterStore((state) => state.controller)
  const helicopters = useHelicopterStore((state) => state.helicopters)
  const activeMissionId = useHelicopterStore((state) => state.activeMissionId)
  const loading = useHelicopterStore((state) => state.loading)
  const saving = useHelicopterStore((state) => state.saving)
  const error = useHelicopterStore((state) => state.error)
  const [drafts, setDrafts] = useState<Record<HelicopterSlotKey, HelicopterDraftState>>(
    createEmptyDraftState,
  )

  const helicoptersBySlot = useMemo(
    () => new Map(helicopters.map((helicopter) => [helicopter.slot_key, helicopter])),
    [helicopters],
  )

  useEffect(() => {
    setDrafts(createDraftStateFromHelicopters(helicopters))
  }, [helicopters])

  return (
    <section
      className="rounded-2xl border border-stone-800 bg-stone-950/40 p-5 text-sm"
      data-testid="helicopter-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-stone-400">
            Helicopters
          </h3>
          <p className="mt-1 text-[10px] text-stone-600">
            Reserve four aviation slots with operational position details.
          </p>
        </div>
        <span className="rounded-full border border-stone-800 bg-stone-900 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
          {helicopters.length} active
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        {SLOT_CONFIG.map((slot) => {
          const helicopter = helicoptersBySlot.get(slot.slotKey) ?? null
          const draft = drafts[slot.slotKey]
          const values = draft
          const saveDisabled =
            controller === null ||
            activeMissionId === null ||
            loading ||
            saving ||
            !isRequiredText(values.call_sign) ||
            !isCoordinateValue(values.lat, -90, 90) ||
            !isCoordinateValue(values.lon, -180, 180)

          return (
            <div
              className="rounded-xl border border-stone-800/70 bg-stone-900/30 p-4"
              data-testid={`helicopter-slot-${slot.slotKey}`}
              key={slot.slotKey}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`h-3 w-3 rounded-full ${slot.color}`} />
                  <div>
                    <p className="text-sm font-semibold text-stone-100">{slot.title}</p>
                    <p className="text-[11px] text-stone-500">{slot.slotKey.replace('_', ' ')}</p>
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-stone-500">
                  {helicopter === null ? 'Empty slot' : 'Configured'}
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Field
                  label="Call Sign"
                  testId={`helicopter-call-sign-${slot.slotKey}`}
                  value={values.call_sign}
                  onChange={(value) => updateDraft(slot.slotKey, 'call_sign', value)}
                />
                <Field
                  label="HEX ID"
                  testId={`helicopter-hex-id-${slot.slotKey}`}
                  value={values.hex_id}
                  onChange={(value) => updateDraft(slot.slotKey, 'hex_id', value)}
                />
                <Field
                  label="Latitude"
                  testId={`helicopter-lat-${slot.slotKey}`}
                  value={values.lat}
                  onChange={(value) => updateDraft(slot.slotKey, 'lat', value)}
                />
                <Field
                  label="Longitude"
                  testId={`helicopter-lon-${slot.slotKey}`}
                  value={values.lon}
                  onChange={(value) => updateDraft(slot.slotKey, 'lon', value)}
                />
                <Field
                  label="Altitude"
                  testId={`helicopter-altitude-${slot.slotKey}`}
                  value={values.altitude}
                  onChange={(value) => updateDraft(slot.slotKey, 'altitude', value)}
                />
                <Field
                  label="Speed"
                  testId={`helicopter-speed-${slot.slotKey}`}
                  value={values.speed}
                  onChange={(value) => updateDraft(slot.slotKey, 'speed', value)}
                />
                <Field
                  label="Heading"
                  testId={`helicopter-heading-${slot.slotKey}`}
                  value={values.heading}
                  onChange={(value) => updateDraft(slot.slotKey, 'heading', value)}
                />
                <Field
                  label="Last Update"
                  testId={`helicopter-last-update-${slot.slotKey}`}
                  value={values.last_update}
                  onChange={(value) => updateDraft(slot.slotKey, 'last_update', value)}
                />
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300 disabled:opacity-40"
                  data-testid={`helicopter-save-${slot.slotKey}`}
                  disabled={saveDisabled}
                  onClick={() => void saveSlot(slot.slotKey)}
                  type="button"
                >
                  Save Slot
                </button>
                <button
                  className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300 disabled:opacity-40"
                  data-testid={`helicopter-clear-${slot.slotKey}`}
                  disabled={controller === null || helicopter === null || saving}
                  onClick={() => void clearSlot(slot.slotKey)}
                  type="button"
                >
                  Clear
                </button>
              </div>
              {!isCoordinateValue(values.lat, -90, 90) || !isCoordinateValue(values.lon, -180, 180) ? (
                <p className="mt-2 text-xs text-amber-300">
                  Enter a valid latitude/longitude before saving this slot.
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      {error !== null ? (
        <p className="mt-3 text-sm text-rose-300" data-testid="helicopter-error">
          {error}
        </p>
      ) : null}
    </section>
  )

  function updateDraft(
    slotKey: HelicopterSlotKey,
    field: keyof HelicopterDraftState,
    value: string,
  ): void {
    setDrafts((current) => ({
      ...current,
      [slotKey]: {
        ...current[slotKey],
        [field]: value,
      },
    }))
  }

  async function saveSlot(slotKey: HelicopterSlotKey): Promise<void> {
    if (controller === null) {
      return
    }

    const helicopter = helicoptersBySlot.get(slotKey) ?? null
    const draft = drafts[slotKey]
    await controller.upsertSlot({
      id: helicopter?.id ?? null,
      slot_key: slotKey,
      call_sign: draft.call_sign.trim(),
      hex_id: normalizeString(draft.hex_id),
      lat: parseNumber(draft.lat),
      lon: parseNumber(draft.lon),
      altitude: parseOptionalNumber(draft.altitude),
      speed: parseOptionalNumber(draft.speed),
      heading: parseOptionalNumber(draft.heading),
      last_update: normalizeString(draft.last_update),
    })
  }

  async function clearSlot(slotKey: HelicopterSlotKey): Promise<void> {
    if (controller === null) {
      return
    }

    await controller.clearSlot(slotKey)
  }
}

type HelicopterDraftState = {
  readonly call_sign: string
  readonly hex_id: string
  readonly lat: string
  readonly lon: string
  readonly altitude: string
  readonly speed: string
  readonly heading: string
  readonly last_update: string
}

function Field(props: {
  readonly label: string
  readonly testId: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1 text-[11px] uppercase tracking-wider text-stone-500">
      <span>{props.label}</span>
      <input
        className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

function createEmptyDraftState(): Record<HelicopterSlotKey, HelicopterDraftState> {
  return {
    slot_1: createEmptySlotDraft(),
    slot_2: createEmptySlotDraft(),
    slot_3: createEmptySlotDraft(),
    slot_4: createEmptySlotDraft(),
  }
}

function createEmptySlotDraft(): HelicopterDraftState {
  return {
    call_sign: '',
    hex_id: '',
    lat: '',
    lon: '',
    altitude: '',
    speed: '',
    heading: '',
    last_update: '',
  }
}

function parseNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeString(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function createDraftStateFromHelicopters(
  helicopters: readonly Helicopter[],
): Record<HelicopterSlotKey, HelicopterDraftState> {
  const drafts = createEmptyDraftState()
  for (const helicopter of helicopters) {
    drafts[helicopter.slot_key] = {
      call_sign: helicopter.call_sign,
      hex_id: helicopter.hex_id ?? '',
      lat: String(helicopter.lat),
      lon: String(helicopter.lon),
      altitude: helicopter.altitude === null ? '' : String(helicopter.altitude),
      speed: helicopter.speed === null ? '' : String(helicopter.speed),
      heading: helicopter.heading === null ? '' : String(helicopter.heading),
      last_update: helicopter.last_update,
    }
  }

  return drafts
}

function isRequiredText(value: string): boolean {
  return value.trim() !== ''
}

function isCoordinateValue(value: string, min: number, max: number): boolean {
  const trimmed = value.trim()
  if (trimmed === '') {
    return false
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
}
