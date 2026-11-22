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

/** How a remedy-bearing headline is fitted: whether the alarm lead gives way, and how many words show. */
export type RemedyFit = { readonly skipLead: boolean; readonly shown: number; readonly compact?: true }

/**
 * Fits words that include a remedy, the thing the operator must do (DON-353).
 * Ranking is never reordered: person-safety words ranked before the remedy
 * (stale, not moving) win, because a coordinator must tell a person who has
 * stopped moving apart from positions that are only ageing because tracking
 * failed. In order:
 * 1. every word that fits from the front, when that already includes the remedy;
 * 2. otherwise the alarm lead gives way, since the alarm strip always shows it,
 *    and the rest fit from the front: the remedy shows if it fits after the
 *    safety words, or is counted in "+N more" (the Tracking panel and the
 *    button's label still name it);
 * 3. when no whole word fits beside "+N more", the first word beside a short
 *    "+N", so a safety word stays on screen when Settings narrows the bar;
 * 4. a count instead of any word, rather than a clipped word.
 *
 * @param widths the width of each word, most urgent first
 * @param options remedy: the remedy word's index; dropLead: the first word is
 *   the alarm strip's own lead, so it may give way (it is never counted)
 * @param separator the width of the separator between words
 * @param more the width of the "+N more" count
 * @param available the width the words may use
 * @param compact the width of the short "+N" count
 * @returns whether to leave out the lead, how many of the remaining words to show, and whether the count is short
 */
export function fitKeepingRemedy(
  widths: readonly number[],
  options: { readonly remedy: number; readonly dropLead: boolean },
  separator: number,
  more: number,
  available: number,
  compact: number,
): RemedyFit {
  const shown = fitProblemWords(widths, separator, more, available)
  if (!options.dropLead || shown > options.remedy || widths.length < 2) return { skipLead: false, shown }
  const rest = fitProblemWords(widths.slice(1), separator, more, available)
  if (rest > 0) return { skipLead: true, shown: rest }
  const short = fitProblemWords(widths.slice(1), separator, compact, available)
  if (short > 0) return { skipLead: true, shown: short, compact: true }
  // No whole word fits even without the lead: count every problem, lead included.
  return { skipLead: false, shown: 0 }
}

/**
 * Text for the shown words and the count of the rest.
 *
 * @param words the problem words, most urgent first
 * @param shown how many whole words fit
 * @param compact count the rest as a short "+N"
 * @returns e.g. "History failed · 2 stale · +2 more"; "3 problems" when none fit
 */
export function problemWordsText(words: readonly string[], shown: number, compact = false): string {
  if (shown >= words.length) return words.join(PROBLEM_WORD_SEPARATOR)
  // A single word is shown even when it cannot fit; nothing else could say it.
  if (shown === 0) return words.length === 1 ? (words[0] ?? '') : `${words.length} problems`
  const hidden = words.length - shown
  return [...words.slice(0, shown), compact ? `+${hidden}` : `+${hidden} more`].join(PROBLEM_WORD_SEPARATOR)
}
