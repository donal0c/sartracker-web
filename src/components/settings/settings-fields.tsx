import type { ReactNode, Ref } from 'react'

/** A titled group of fields inside one Settings section. */
export function SettingsGroup(props: {
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
  readonly testId?: string
}) {
  return (
    <section className="sar-module p-5" data-testid={props.testId}>
      <div className="mb-4">
        <h4 className="text-[12px] font-bold uppercase tracking-wider text-stone-100">
          {props.title}
        </h4>
        {props.description === undefined ? null : (
          <p className="sar-helper-text mt-1">{props.description}</p>
        )}
      </div>
      <div className="space-y-4">{props.children}</div>
    </section>
  )
}

/** A labelled single-line text input with its validation message. */
export function TextField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId?: string
  readonly error: string | undefined
  readonly type?: string
}) {
  return (
    <label className="block space-y-2">
      <span className="sar-section-label">
        {props.label}
      </span>
      <input
        className="sar-input w-full px-3 py-2 text-sm"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value)}
        type={props.type ?? 'text'}
        value={props.value}
      />
      {props.error ? <span className="text-xs text-rose-300">{props.error}</span> : null}
    </label>
  )
}

/** A labelled number input with its validation message. */
export function NumberField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId?: string
  readonly error: string | undefined
}) {
  return <TextField {...props} type="number" />
}

/** A labelled multi-line input, used for rosters. */
export function TextAreaField({ ref, ...props }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId?: string
  readonly ref?: Ref<HTMLTextAreaElement>
}) {
  return (
    <label className="block space-y-2">
      <span className="sar-section-label">
        {props.label}
      </span>
      <textarea
        className="sar-input min-h-24 w-full px-3 py-2 text-sm"
        data-testid={props.testId}
        ref={ref}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

/** A labelled checkbox row. */
export function ToggleField(props: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean
  readonly testId?: string
}) {
  return (
    <label className="sar-toggle flex items-center justify-between gap-4 px-3 py-2">
      <span className="text-sm text-stone-100">{props.label}</span>
      <input
        checked={props.checked}
        className="h-4 w-4 cursor-pointer accent-amber-400"
        data-testid={props.testId}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  )
}

/** One option of a small set of mutually exclusive choices. */
export function ChoiceButton(props: {
  readonly active: boolean
  readonly label: string
  readonly onClick: () => void
  readonly testId?: string
}) {
  return (
    <button
      aria-pressed={props.active}
      className={`border px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition ${
        props.active
          ? 'border-amber-300/50 bg-amber-500 text-[#0c0a09]'
          : 'sar-button'
      }`}
      data-testid={props.testId}
      onClick={props.onClick}
      type="button"
    >
      {props.label}
    </button>
  )
}
