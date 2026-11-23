import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

import { paletteThemeColors, paletteVariables } from './src/lib/theme-palette'

/**
 * The hues the chrome uses are served from CSS variables so the light theme
 * (DON-344) can restyle every component at once; see src/lib/theme-palette.ts.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: paletteThemeColors(),
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': paletteVariables('standard'),
        ":root[data-theme='light']": paletteVariables('light'),
      })
    }),
  ],
} satisfies Config
