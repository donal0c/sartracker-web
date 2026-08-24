import { useState } from 'react'

import type { Outing } from '../infrastructure/mission-store/tauri-mission-store'
import {
  type OutingControlsViewModel,
  useOutingControlsViewModel,
} from '../features/outings/use-outing-controls-view-model'

/** Renders explicit coordinator-owned outing boundaries and truthful fix counts. */
export function OutingControlsSection() {
  const model = useOutingControlsViewModel()
  if (!model.enabled) return null
  return <MissionScopedOutingControls key={model.missionId ?? 'no-mission'} model={model} />
}

/** Owns edit drafts inside one explicit UI mission identity. */
function MissionScopedOutingControls({ model }: { readonly model: OutingControlsViewModel }) {
  const [newLabel, setNewLabel] = useState('')
  const [editing, setEditing] = useState<Outing | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const editingInScope = editing === null
    ? null
    : model.outings.find((outing) =>
      outing.id === editing.id && outing.mission_id === editing.mission_id) ?? null

  function beginEdit(outing: Outing): void {
    setEditing(outing)
    setEditLabel(outing.label)
    setEditStart(toLocalDateTimeInput(outing.started_at))
    setEditEnd(outing.ended_at === null ? '' : toLocalDateTimeInput(outing.ended_at))
  }

  async function saveEdit(): Promise<void> {
    if (editingInScope === null) return
    if (editLabel.trim() !== editingInScope.label) {
      const renamed = await model.renameOuting(editingInScope.id, editLabel.trim())
      if (!renamed) return
    }
    const corrected = await model.editBoundaries(
      editingInScope.id,
      toUtcIso(editStart),
      editEnd.trim() === '' ? null : toUtcIso(editEnd),
    )
    if (corrected) setEditing(null)
  }

  return (
    <section className="sar-module space-y-3 p-3" data-testid="outing-controls-section">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-300">Outings</p>
          <p className="mt-1 text-[11px] text-stone-300">Coordinator-defined operational periods</p>
        </div>
        {model.activeOuting !== null ? (
          <button
            className="sar-action-danger px-3 py-2 text-[11px] font-bold uppercase"
            data-testid="outing-end-btn"
            disabled={!model.canMutate || model.saving}
            onClick={() => void model.endOuting(model.activeOuting?.id ?? '')}
            type="button"
          >
            End now
          </button>
        ) : null}
      </div>

      {model.loading ? (
        <p className="text-xs text-stone-300" role="status">Loading outing lifecycle…</p>
      ) : model.error !== null ? (
        <p className="text-xs text-rose-300" role="status">Outing lifecycle unavailable.</p>
      ) : model.noActiveOutingNotice !== null ? (
        <p className="sar-inline-alert p-2 text-xs text-amber-200" data-testid="outing-no-active-notice" role="status">
          {model.noActiveOutingNotice}
        </p>
      ) : (
        <p className="text-xs font-semibold text-emerald-300" data-testid="active-outing-label">
          Active: {model.activeOuting?.label}
        </p>
      )}

      {model.activeOuting === null && model.canMutate ? (
        <div className="flex gap-2">
          <input
            aria-label="New outing label"
            className="sar-input min-w-0 flex-1 px-3 py-2 text-xs"
            data-testid="outing-label-input"
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder={model.nextDefaultLabel}
            value={newLabel}
          />
          <button
            className="sar-action-primary px-3 py-2 text-[11px] font-bold uppercase"
            data-testid="outing-start-btn"
            disabled={model.saving}
            onClick={() => {
              void model.startOuting(newLabel.trim() || model.nextDefaultLabel).then((started) => {
                if (started) setNewLabel('')
              })
            }}
            type="button"
          >
            Start outing
          </button>
        </div>
      ) : null}

      {model.error !== null ? (
        <p className="border border-rose-400/30 bg-rose-400/10 p-2 text-xs text-rose-300" role="alert">
          {model.error}
        </p>
      ) : null}

      <div className="space-y-2" data-testid="outing-fix-summary">
        {model.outings.map((outing) => (
          <div className="sar-readout p-2" data-testid={`outing-row-${outing.id}`} key={outing.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-stone-100">{outing.label}</p>
                <p className="mt-1 text-[10px] text-stone-300">
                  {formatLocal(outing.started_at)} — {outing.ended_at === null ? 'Open' : formatLocal(outing.ended_at)}
                </p>
                <p className="mt-1 font-mono text-[11px] text-sky-200">
                  Accepted fixes: {formatCount(model.fixCountFor(outing.id))}
                </p>
              </div>
              {model.canMutate ? (
                <button
                  className="sar-button px-2 py-1 text-[10px] uppercase"
                  data-testid={`outing-edit-${outing.id}`}
                  onClick={() => beginEdit(outing)}
                  type="button"
                >
                  Edit
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <div className="border border-amber-400/30 bg-amber-400/10 p-2" data-testid="outing-unassigned-row">
          <p className="text-xs font-bold text-amber-200">Unassigned</p>
          <p className="mt-1 text-[10px] text-stone-300">Accepted fixes outside every explicit outing window</p>
          <p className="mt-1 font-mono text-[11px] text-amber-100">Accepted fixes: {formatCount(model.unassignedFixCount)}</p>
        </div>
      </div>

      {editingInScope !== null ? (
        <div className="space-y-3 border border-sky-500/30 bg-sky-950/30 p-3" data-testid="outing-edit-panel">
          <label className="block text-[11px] text-stone-300">
            Label
            <input className="sar-input mt-1 w-full px-2 py-1" data-testid="outing-edit-label" onChange={(event) => setEditLabel(event.target.value)} value={editLabel} />
          </label>
          <label className="block text-[11px] text-stone-300">
            Start (local time)
            <input className="sar-input mt-1 w-full px-2 py-1" data-testid="outing-edit-start" onChange={(event) => setEditStart(event.target.value)} type="datetime-local" value={editStart} />
          </label>
          <label className="block text-[11px] text-stone-300">
            End (local time; blank keeps it open)
            <input className="sar-input mt-1 w-full px-2 py-1" data-testid="outing-edit-end" onChange={(event) => setEditEnd(event.target.value)} type="datetime-local" value={editEnd} />
          </label>
          <div className="flex gap-2">
            <button className="sar-action-primary flex-1 px-2 py-2 text-[11px] font-bold uppercase" data-testid="outing-edit-save" onClick={() => void saveEdit()} type="button">Save audited correction</button>
            <button className="sar-button flex-1 px-2 py-2 text-[11px]" onClick={() => setEditing(null)} type="button">Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** Offers, but never forces, closing an explicit outing before mission finish. */
export function OpenOutingFinishOffer() {
  const model = useOutingControlsViewModel()
  if (!model.enabled || model.activeOuting === null) return null
  return (
    <div className="mt-3 border border-amber-400/30 bg-amber-400/10 p-3" data-testid="outing-finish-offer">
      <p className="text-xs text-amber-100">
        {model.activeOuting.label} is still open. Finishing the mission won’t invent an end time.
      </p>
      <button className="sar-button mt-2 px-3 py-2 text-[11px] font-bold uppercase" disabled={!model.canMutate || model.saving} onClick={() => void model.endOuting(model.activeOuting?.id ?? '')} type="button">
        End outing now
      </button>
    </div>
  )
}

function formatCount(count: number | null): string {
  return count === null ? 'Loading…' : count.toLocaleString()
}

function formatLocal(timestamp: string): string {
  return new Date(timestamp).toLocaleString()
}

function toLocalDateTimeInput(timestamp: string): string {
  const date = new Date(timestamp)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toUtcIso(localTimestamp: string): string {
  const date = new Date(localTimestamp)
  if (Number.isNaN(date.getTime())) throw new Error('Outing boundary must be a valid local date and time.')
  return date.toISOString()
}
