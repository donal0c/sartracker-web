/** Between problem words in the tracking headline. */
export const PROBLEM_WORD_SEPARATOR = ' · '

/**
 * Decides how many whole problem words fit, leaving room to count the rest.
 *
 * @param widths the width of each word, most urgent first
 * @param separator the width of the separator between words
 * @param more the width of the "+N more" count
 * @param available the width the words may use
 * @returns how many words to show; the rest are counted, never cut mid-word
 */
export function fitProblemWords(widths: readonly number[], separator: number, more: number, available: number): number {
  // Room for a "+N more" count is only kept when not every word fits.
  const all = widths.reduce((sum, width, index) => sum + (index === 0 ? 0 : separator) + width, 0)
  if (all <= available + 0.5) return widths.length
  let used = 0
  for (let shown = 0; shown < widths.length; shown += 1) {
    used += (shown === 0 ? 0 : separator) + (widths[shown] ?? 0)
    const remaining = widths.length - shown - 1
    const needed = used + (remaining === 0 ? 0 : separator + more)
    if (needed > available + 0.5) return shown
  }
  return widths.length
}

/** Which problem words to show when the first one may give way. */
export type YieldingLeadFit = { readonly skipLead: boolean; readonly shown: number }

/**
 * Fits the words when the first one is an alarm lead that the flashing alarm
 * strip always shows too (DON-353). The lead stays while the word after it,
 * the fix, also fits; otherwise the lead gives way, so the one thing the
 * operator must do is never hidden behind "+N more" in a narrow bar.
 *
 * @param widths the width of each word, the lead first
 * @param separator the width of the separator between words
 * @param more the width of the "+N more" count
 * @param available the width the words may use
 * @returns whether to drop the lead, and how many of the remaining words to show
 */
export function fitWithYieldingLead(widths: readonly number[], separator: number, more: number, available: number): YieldingLeadFit {
  const shown = fitProblemWords(widths, separator, more, available)
  if (shown >= 2 || widths.length < 2) return { skipLead: false, shown }
  return { skipLead: true, shown: fitProblemWords(widths.slice(1), separator, more, available) }
}

/**
 * Text for the shown words and the count of the rest.
 *
 * @param words the problem words, most urgent first
 * @param shown how many whole words fit
 * @returns e.g. "History failed · 2 stale · +2 more"; "3 problems" when none fit
 */
export function problemWordsText(words: readonly string[], shown: number): string {
  if (shown >= words.length) return words.join(PROBLEM_WORD_SEPARATOR)
  // A single word is shown even when it cannot fit; nothing else could say it.
  if (shown === 0) return words.length === 1 ? (words[0] ?? '') : `${words.length} problems`
  return [...words.slice(0, shown), `+${words.length - shown} more`].join(PROBLEM_WORD_SEPARATOR)
}
