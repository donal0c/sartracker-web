import { useLayoutEffect, useRef, useState } from 'react'

import { PROBLEM_WORD_SEPARATOR, fitProblemWords, fitWithYieldingLead, problemWordsText } from '../../features/workspace/problem-word-fit'

/**
 * The problem words at the front of the tracking headline. Each word is shown
 * whole or counted in "+N more", so a problem is never hidden behind an
 * ellipsis and the top bar never grows (DON-261). The full sentence is in the
 * button's label and the Tracking panel.
 */
export function TrackingProblemWords(props: { readonly words: readonly string[]; readonly leadInAlarm?: boolean }) {
  const { words } = props
  const leadInAlarm = props.leadInAlarm === true
  const rowRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState<{ readonly skipLead: boolean; readonly shown: number }>({ skipLead: false, shown: words.length })
  const wordsKey = `${leadInAlarm ? 'lead-in-alarm' : ''}\n${words.join('\n')}`

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    const line = row?.parentElement
    if (row === null || measure === null || line === null || line === undefined) return
    const refit = () => {
      const parts = Array.from(measure.children, (child) => child.getBoundingClientRect().width)
      const widths = parts.slice(0, words.length)
      const separator = parts[words.length] ?? 0
      const more = parts[words.length + 1] ?? 0
      const available = line.getBoundingClientRect().right - row.getBoundingClientRect().left
      // The alarm strip always says an alarm lead, so it may give way to the fix.
      setFit(leadInAlarm
        ? fitWithYieldingLead(widths, separator, more, available)
        : { skipLead: false, shown: fitProblemWords(widths, separator, more, available) })
    }
    refit()
    // Without ResizeObserver (test DOMs) the words are fitted once, not on resize.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(refit)
    observer.observe(line)
    return () => observer.disconnect()
    // wordsKey stands for the words' content; a new array with the same words needs no refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsKey])

  if (words.length === 0) return null
  return (
    <>
      <span className="ws-health-problems" data-testid="ws-tracking-problems" ref={rowRef}>
        {fit.skipLead ? problemWordsText(words.slice(1), fit.shown) : problemWordsText(words, fit.shown)}
      </span>
      <span aria-hidden="true" className="ws-health-measure" ref={measureRef}>
        {words.map((word) => <span key={word}>{word}</span>)}
        <span>{PROBLEM_WORD_SEPARATOR}</span>
        <span>{`+${words.length} more`}</span>
      </span>
    </>
  )
}
