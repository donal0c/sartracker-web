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

/** Which problem words to show, by position, and how many to count as "+N more". */
export type WordSelection = { readonly indices: readonly number[]; readonly hidden: number; readonly compact?: true }

/**
 * Fits the words so the one thing the operator must do, the remedy, is never
 * hidden behind "+N more" (DON-353). The remedy is named by its position in
 * the ranked words, wherever the ranking put it; words ranked before it (a
 * person's safety, such as stale or not moving) keep their place in front.
 * In order of preference:
 * 1. every word that fits, from the front, when that already includes the remedy;
 * 2. the same without the alarm lead, which the flashing alarm strip always shows;
 * 3. as many of the words before the remedy as fit, then the remedy, counting the rest;
 * 4. the remedy and a short "+N" count, when "+N more" will not fit beside it;
 * 5. the remedy alone, when even that will not fit.
 *
 * @param widths the width of each word, most urgent first
 * @param options remedy: the remedy word's index; dropLead: the first word is
 *   the alarm strip's own lead, so it may give way (it is never counted)
 * @param separator the width of the separator between words
 * @param more the width of the "+N more" count
 * @param available the width the words may use
 * @param compact the width of the short "+N" count
 * @returns the words to show and how many to count
 */
export function fitKeepingRemedy(
  widths: readonly number[],
  options: { readonly remedy: number; readonly dropLead: boolean },
  separator: number,
  more: number,
  available: number,
  compact: number,
): WordSelection {
  const { remedy, dropLead } = options
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index)
  const shown = fitProblemWords(widths, separator, more, available)
  if (shown > remedy) return { indices: range(0, shown), hidden: widths.length - shown }
  const start = dropLead && remedy > 0 ? 1 : 0
  const pool = widths.length - start
  if (start === 1) {
    const rest = fitProblemWords(widths.slice(1), separator, more, available)
    if (1 + rest > remedy) return { indices: range(1, 1 + rest), hidden: pool - rest }
  }
  const width = (indices: readonly number[], hidden: number) =>
    indices.reduce((sum, index, at) => sum + (at === 0 ? 0 : separator) + (widths[index] ?? 0), 0)
    + (hidden > 0 ? separator + more : 0)
  for (let last = remedy - 1; last >= start - 1; last -= 1) {
    const indices = [...range(start, last + 1), remedy]
    const hidden = pool - indices.length
    if (width(indices, hidden) <= available + 0.5) return { indices, hidden }
  }
  const hidden = pool - 1
  if (hidden > 0 && (widths[remedy] ?? 0) + separator + compact <= available + 0.5) return { indices: [remedy], hidden, compact: true }
  // The bar cannot hold even a count beside the remedy; the button's label and
  // the Tracking panel list every problem.
  return { indices: [remedy], hidden: 0 }
}

/**
 * Text for a selection of words.
 *
 * @param words the problem words, most urgent first
 * @param selection the words to show and how many to count
 * @returns e.g. "1 stale · Re-enter password · +1 more", or "Re-enter password · +2" when compact
 */
export function selectedWordsText(words: readonly string[], selection: WordSelection): string {
  const parts = selection.indices.map((index) => words[index] ?? '')
  if (selection.hidden > 0) parts.push(selection.compact === true ? `+${selection.hidden}` : `+${selection.hidden} more`)
  return parts.join(PROBLEM_WORD_SEPARATOR)
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
