import { useState } from 'react'

import type { Mission } from '../../infrastructure/mission-store/tauri-mission-store'

/**
 * Start screen when the app opens with an unfinished mission (DON-342,
 * SAR-QA-026): Resume is the first and largest choice. Starting a new mission
 * instead finishes the old one, so it asks first and says the record is kept.
 */
export function ResumeMissionChoice(props: {
  readonly mission: Mission
  readonly busy: boolean
  readonly onResume: () => void
  readonly onStartNew: () => void
}) {
  const [confirmingNew, setConfirmingNew] = useState(false)
  const { mission } = props

  return (
    <div className="space-y-3" data-testid="start-screen-resume">
      <p className="text-[15px] font-bold">Carry on with your unfinished mission?</p>
      <div className="sar-readout p-3">
        <p className="text-[17px] font-black" data-testid="start-screen-resume-name">{mission.name}</p>
        <p className="mt-1 text-[13px] text-stone-300">Started {new Date(mission.start_time).toLocaleString()}</p>
        <p className="mt-1 text-[13px] text-stone-300">
          {/* Startup holds a running mission as paused, so the store cannot say which it was. */}
          If it was running, tracking carries on. If you had paused it, it stays paused until you resume it.
        </p>
      </div>
      <button
        className="sar-action-primary w-full px-4 py-3 text-[15px] font-black uppercase tracking-[0.1em] disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="start-screen-resume-btn"
        disabled={props.busy}
        onClick={props.onResume}
        type="button"
      >
        Resume {mission.name}
      </button>

      {confirmingNew ? (
        <div aria-label="Confirm starting a new mission" className="border border-amber-300 p-3" data-testid="start-screen-confirm-new" role="group">
          <p className="text-[14px] font-bold">Finish {mission.name} and start a new mission?</p>
          <p className="mt-1 text-[13px] text-stone-300">
            {mission.name} is finished first. Its record is kept and can still be reviewed.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              className="sar-button-focus px-3 py-2 text-[13px] font-bold disabled:opacity-40"
              data-testid="start-screen-confirm-new-yes"
              disabled={props.busy}
              onClick={() => { setConfirmingNew(false); props.onStartNew() }}
              type="button"
            >
              Finish it, start new
            </button>
            <button
              className="sar-button px-3 py-2 text-[13px] font-bold"
              data-testid="start-screen-confirm-new-no"
              onClick={() => setConfirmingNew(false)}
              type="button"
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <button
          className="sar-button w-full px-3 py-2 text-[13px] font-bold"
          data-testid="start-screen-start-new-instead"
          disabled={props.busy}
          onClick={() => setConfirmingNew(true)}
          type="button"
        >
          Start a new mission instead
        </button>
      )}
    </div>
  )
}
