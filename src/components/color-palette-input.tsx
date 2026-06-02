import { useState } from 'react'

/**
 * High-contrast SAR operational colour palette.
 * Chosen for visibility against satellite, topo, and dark basemaps.
 */
const SAR_PALETTE: readonly string[] = [
  '#FF0000', // red
  '#FF7A00', // orange
  '#FFB000', // amber
  '#F0E442', // yellow
  '#B8F000', // lime
  '#00E0A4', // mint
  '#00B8FF', // sky blue
  '#4363D8', // blue
  '#8B5CF6', // violet
  '#F032E6', // magenta
  '#FF4F79', // rose
  '#FFFFFF', // white
] as const

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

/**
 * Combined colour palette swatches + typed hex input.
 * Used across drawing, device, and marker styling surfaces.
 */
export function ColorPaletteInput(props: {
  readonly value: string
  readonly onChange: (color: string) => void
  readonly testId: string
  readonly label?: string
}) {
  const [hexInput, setHexInput] = useState(props.value)
  const [hexError, setHexError] = useState<string | null>(null)

  const normalizedValue = props.value.toUpperCase()

  return (
    <div className="space-y-2" data-testid={props.testId}>
      {props.label !== undefined ? (
        <span className="block text-xs uppercase tracking-[0.2em] text-stone-300">
          {props.label}
        </span>
      ) : null}
      <div
        className="flex flex-wrap gap-1"
        data-testid={`${props.testId}-swatches`}
        role="radiogroup"
        aria-label="Colour palette"
      >
        {SAR_PALETTE.map((color) => (
          <button
            aria-checked={normalizedValue === color}
            aria-label={color}
            className={`h-7 w-7 rounded border-2 transition-transform ${
              normalizedValue === color
                ? 'scale-110 border-white shadow-lg'
                : 'border-stone-700 hover:border-stone-400'
            }`}
            data-testid={`${props.testId}-swatch-${color.replace('#', '')}`}
            key={color}
            onClick={() => {
              props.onChange(color)
              setHexInput(color)
              setHexError(null)
            }}
            role="radio"
            style={{ backgroundColor: color }}
            type="button"
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label="Hex colour value"
          className="w-24 rounded border border-stone-700 bg-stone-950 px-2 py-1 font-mono text-xs text-stone-100"
          data-testid={`${props.testId}-hex`}
          onBlur={() => {
            const trimmed = hexInput.trim()
            if (trimmed === '') {
              setHexError(null)
              return
            }
            const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
            if (HEX_COLOR_PATTERN.test(withHash)) {
              props.onChange(withHash.toUpperCase())
              setHexInput(withHash.toUpperCase())
              setHexError(null)
            } else {
              setHexError('Invalid hex colour')
            }
          }}
          onChange={(event) => {
            setHexInput(event.target.value)
            setHexError(null)
            const trimmed = event.target.value.trim()
            const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
            if (HEX_COLOR_PATTERN.test(withHash)) {
              props.onChange(withHash.toUpperCase())
            }
          }}
          placeholder="#FF0000"
          value={hexInput}
        />
        <div
          className="h-7 w-7 rounded border border-stone-600"
          data-testid={`${props.testId}-preview`}
          style={{ backgroundColor: HEX_COLOR_PATTERN.test(props.value) ? props.value : '#000000' }}
        />
        {hexError !== null ? (
          <span className="text-xs text-rose-400" data-testid={`${props.testId}-error`}>
            {hexError}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export { SAR_PALETTE }
