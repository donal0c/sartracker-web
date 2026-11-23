/**
 * Theme-scoped Tailwind palette (DON-344).
 *
 * The app chrome was written with dark Tailwind classes (`bg-stone-950`,
 * `text-stone-200`, `text-amber-100` …) in about thirty components. Rather than
 * fork every component for the light theme, the hues those components use are
 * served from CSS variables. The standard theme keeps Tailwind's own values, so
 * it renders exactly as before; the light theme swaps in a light grey scale and
 * darker accent shades, so a "light text on dark panel" class becomes "dark text
 * on light panel" everywhere at once.
 *
 * Used only by `tailwind.config.ts` (build time) and the contrast tests; the
 * renderer never imports it.
 */
import colors from 'tailwindcss/colors'

export type ThemeName = 'standard' | 'light'

export const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const
export type Shade = (typeof SHADES)[number]

/** The neutral scale used for every panel, line and body text. */
export const NEUTRAL_HUE = 'stone'

/** Accent hues the chrome uses; each is served from variables. */
export const ACCENT_HUES = ['amber', 'cyan', 'emerald', 'fuchsia', 'red', 'rose', 'sky', 'violet'] as const

export const THEMED_HUES = [NEUTRAL_HUE, ...ACCENT_HUES] as const
export type ThemedHue = (typeof THEMED_HUES)[number]

/**
 * Light theme neutral scale: a cool light grey, as in the team's example window
 * (SAR-QA-029). The dark end of the class names (950/900/800) now names the
 * light panel greys, and the light end (50–400) names dark text.
 */
export const LIGHT_NEUTRAL: Readonly<Record<Shade, string>> = {
  50: '#0b0d10',
  100: '#15181c',
  200: '#22262b',
  300: '#2f353c',
  400: '#454c55',
  500: '#555d67',
  600: '#68707a',
  700: '#78818c',
  800: '#a7afb8',
  900: '#dde1e6',
  950: '#eef0f3',
}

/**
 * Which Tailwind shade an accent class shows in the light theme. Pale shades
 * (used as text on dark panels) become deep ones, deep tints (used as panel
 * backgrounds) become pale ones; the saturated middle (500–700, used as solid
 * buttons with white text) stays put so those pairings still read.
 */
export const LIGHT_ACCENT_SHADE: Readonly<Record<Shade, Shade>> = {
  50: '950',
  100: '900',
  200: '800',
  300: '800',
  400: '700',
  500: '500',
  600: '600',
  700: '700',
  800: '200',
  900: '100',
  950: '50',
}

/** CSS custom property for one hue/shade, as "r g b" channels. */
export function paletteVariable(hue: ThemedHue, shade: Shade): string {
  return `--sar-c-${hue}-${shade}`
}

/** Converts `#rrggbb` to Tailwind's space-separated channel form. */
export function hexToChannels(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (match === null) throw new Error(`Theme palette colour must be #rrggbb, got "${hex}"`)
  return [match[1], match[2], match[3]].map((part) => String(Number.parseInt(part ?? '', 16))).join(' ')
}

/** The hex colour a class such as `text-amber-200` resolves to in a theme. */
export function resolvePaletteHex(theme: ThemeName, hue: ThemedHue, shade: Shade): string {
  const scale = (colors as unknown as Record<string, Record<Shade, string>>)[hue]
  if (scale === undefined) throw new Error(`Unknown Tailwind hue "${hue}"`)
  if (theme === 'standard') return scale[shade]
  if (hue === NEUTRAL_HUE) return LIGHT_NEUTRAL[shade]
  return scale[LIGHT_ACCENT_SHADE[shade]]
}

/** Every palette variable with its channels for one theme. */
export function paletteVariables(theme: ThemeName): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const hue of THEMED_HUES) {
    for (const shade of SHADES) variables[paletteVariable(hue, shade)] = hexToChannels(resolvePaletteHex(theme, hue, shade))
  }
  return variables
}

/** Tailwind `theme.extend.colors` entries that read the variables, keeping `/opacity` modifiers. */
export function paletteThemeColors(): Record<string, Record<Shade, string>> {
  const result: Record<string, Record<Shade, string>> = {}
  for (const hue of THEMED_HUES) {
    const scale = {} as Record<Shade, string>
    for (const shade of SHADES) scale[shade] = `rgb(var(${paletteVariable(hue, shade)}) / <alpha-value>)`
    result[hue] = scale
  }
  return result
}
