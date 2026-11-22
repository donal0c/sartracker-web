/** Independently check known source coordinates/times and actual rendered state transitions. */
export function validateAttentionSurface(facts) {
  const source = facts?.source
  if (!source || source.stationary?.length !== 2 || source.moving?.length !== 2
      || source.stationary[0].latitude !== 52 || source.stationary[1].latitude !== 52.00001
      || source.moving[0].latitude !== 52.001 || source.moving[1].latitude !== 52.00101
      || [...source.stationary, ...source.moving].some(row => row.longitude !== -9.7 || row.accuracy !== 4 || row.deviceId !== 1)
      || source.stale?.deviceId !== 2 || source.stale.latitude !== 52.002 || source.stale.longitude !== -9.7
      || source.stale.fixTime !== source.stationary[0].fixTime
      || Date.parse(source.stationary[1].fixTime) - Date.parse(source.stationary[0].fixTime) !== 20 * 60_000
      || Date.parse(source.moving[0].fixTime) - Date.parse(source.stationary[1].fixTime) !== 10_000
      || Date.parse(source.moving[1].fixTime) - Date.parse(source.moving[0].fixTime) !== 10_000) {
    throw new Error('Attention source does not match the independent twenty-minute accuracy/movement oracle.')
  }
  const down = trackingWentDown(facts)
  if (down !== null) throw new Error(`Attention tracking-loss transition failed: ${down}`)
  const back = trackingCameBack(facts)
  if (back !== null) throw new Error(`Attention tracking-recovery transition failed: ${back}`)
  if (!/stationary attention/i.test(facts.attention) || !/acknowledged/i.test(facts.acknowledged)
      || !/stale|offline/i.test(facts.stale)
      || facts.cleared !== true || facts.currentVisible !== true || facts.renderedCurrent?.attention !== false
      || JSON.stringify(facts.renderedCurrent?.coordinates) !== '[-9.7,52.00101]') throw new Error('Attention rendered transitions or current-fix visibility are incomplete.')
  if (!/^[a-f0-9]{64}$/u.test(facts.evidenceBeforeAck ?? '') || facts.evidenceBeforeAck !== facts.evidenceAfterAck) {
    throw new Error('Attention acknowledgement changed durable breadcrumb evidence.')
  }
  return { passed: true, scope: 'packaged synthetic attention boundary; deterministic edge corpus and field GPS evidence are separate' }
}

const DOWN_WORDS = /offline|disconnected|not connected|lost/iu
/** Words that name a state other than live tracking, which recovery must not show. */
const NOT_LIVE_WORDS = /offline|disconnected|not connected|lost|paused|needs resuming|record not saved/iu

/** Words each down condition must show, in the visible headline and its label. */
const DOWN_CONDITION_WORDS = { lost: /TRACKING LOST/u, disconnected: DOWN_WORDS }

/** Quotes what was observed, so a failed receipt says which words were wrong. */
function observed(condition, label, words) {
  return `condition ${JSON.stringify(condition)}, label ${JSON.stringify(label)}, visible words ${JSON.stringify(words)}`
}

/**
 * The tracking state after the source dropped. The old mode chip said it in
 * words; the new top bar (DON-341) names the condition ("lost" or
 * "disconnected") and shows short problem words. The condition, the label and
 * the visible words must all agree.
 *
 * @returns null when it agrees, otherwise why not
 */
function trackingWentDown(facts) {
  const { disconnectedCondition: condition, disconnected: label, disconnectedWords: words } = facts
  if (condition === undefined) {
    return /offline|disconnected|not connected/i.test(label) ? null : `the old mode chip read ${JSON.stringify(label)}`
  }
  const expected = DOWN_CONDITION_WORDS[condition]
  if (expected === undefined) return `expected condition lost or disconnected; ${observed(condition, label, words)}`
  if (typeof label !== 'string' || !expected.test(label)) return `the label does not say tracking is down; ${observed(condition, label, words)}`
  if (typeof words !== 'string' || !expected.test(words)) return `the visible words do not say tracking is down; ${observed(condition, label, words)}`
  return null
}

/**
 * The tracking state after the source returned: live again. "ok" must read
 * "Tracking OK"; "attention" must name a live-tracking problem. Neither may
 * show words for a lost, paused or unsaved state.
 *
 * @returns null when it agrees, otherwise why not
 */
function trackingCameBack(facts) {
  const { recoveredCondition: condition, recovered: label, recoveredWords: words } = facts
  if (condition === undefined) {
    return typeof label === 'string' && !/offline|disconnected|not connected/i.test(label) && /online|live|connected/i.test(label)
      ? null : `the old mode chip read ${JSON.stringify(label)}`
  }
  if (condition !== 'ok' && condition !== 'attention') return `expected condition ok or attention; ${observed(condition, label, words)}`
  for (const [name, text] of [['label', label], ['visible words', words]]) {
    if (typeof text !== 'string' || text.trim() === '') return `the ${name} are empty; ${observed(condition, label, words)}`
    if (NOT_LIVE_WORDS.test(text)) return `the ${name} still name a state that is not live; ${observed(condition, label, words)}`
    if (condition === 'ok' && !/^Tracking OK\b/u.test(text.trim())) return `condition ok but the ${name} do not read "Tracking OK"; ${observed(condition, label, words)}`
    if (condition === 'attention' && /^Tracking OK\b/u.test(text.trim())) return `condition attention but the ${name} read "Tracking OK"; ${observed(condition, label, words)}`
  }
  return null
}
