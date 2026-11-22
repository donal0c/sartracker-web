import { useLayoutEffect, useRef, useState } from 'react'

import { PROBLEM_WORD_SEPARATOR, fitProblemWords, problemWordsText } from '../../features/workspace/problem-word-fit'

/**
 * The problem words at the front of the tracking headline. Each word is shown
 * whole or counted in "+N more", so a problem is never hidden behind an
 * ellipsis and the top bar never grows (DON-261). The full sentence is in the
 * button's label and the Tracking panel.
 */
export function TrackingProblemWords(props: { readonly words: readonly string[] }) {
  const { words } = props
  const rowRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(words.length)
  const wordsKey = words.join('\n')

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    const line = row?.parentElement
    if (row === null || measure === null || line === null || line === undefined) return
    const fit = () => {
      const parts = Array.from(measure.children, (child) => child.getBoundingClientRect().width)
      const widths = parts.slice(0, words.length)
      const separator = parts[words.length] ?? 0
      const more = parts[words.length + 1] ?? 0
      const available = line.getBoundingClientRect().right - row.getBoundingClientRect().left
      setShown(fitProblemWords(widths, separator, more, available))
    }
    fit()
    // Without ResizeObserver (test DOMs) the words are fitted once, not on resize.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(line)
    return () => observer.disconnect()
    // wordsKey stands for the words' content; a new array with the same words needs no refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsKey])

  if (words.length === 0) return null
  return (
    <>
      <span className="ws-health-problems" data-testid="ws-tracking-problems" ref={rowRef}>
        {problemWordsText(words, shown)}
      </span>
      <span aria-hidden="true" className="ws-health-measure" ref={measureRef}>
        {words.map((word) => <span key={word}>{word}</span>)}
        <span>{PROBLEM_WORD_SEPARATOR}</span>
        <span>{`+${words.length} more`}</span>
      </span>
    </>
  )
}
