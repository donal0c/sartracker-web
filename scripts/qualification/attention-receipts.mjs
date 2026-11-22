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
  if (!/stationary attention/i.test(facts.attention) || !/acknowledged/i.test(facts.acknowledged)
      || !/stale|offline/i.test(facts.stale) || !trackingWentDown(facts) || !trackingCameBack(facts)
      || facts.cleared !== true || facts.currentVisible !== true || facts.renderedCurrent?.attention !== false
      || JSON.stringify(facts.renderedCurrent?.coordinates) !== '[-9.7,52.00101]') throw new Error('Attention rendered transitions or current-fix visibility are incomplete.')
  if (!/^[a-f0-9]{64}$/u.test(facts.evidenceBeforeAck ?? '') || facts.evidenceBeforeAck !== facts.evidenceAfterAck) {
    throw new Error('Attention acknowledgement changed durable breadcrumb evidence.')
  }
  return { passed: true, scope: 'packaged synthetic attention boundary; deterministic edge corpus and field GPS evidence are separate' }
}

const DOWN_WORDS = /offline|disconnected|not connected|lost/iu

/**
 * The tracking state after the source dropped. The old mode chip said it in
 * words; the new top bar (DON-341) names the condition, "lost" or "disconnected".
 */
function trackingWentDown(facts) {
  if (facts.disconnectedCondition === undefined) return /offline|disconnected|not connected/i.test(facts.disconnected)
  return ['lost', 'disconnected'].includes(facts.disconnectedCondition)
    && typeof facts.disconnected === 'string' && DOWN_WORDS.test(facts.disconnected)
}

/** The tracking state after the source returned: live again, with no down words left. */
function trackingCameBack(facts) {
  if (typeof facts.recovered !== 'string' || /offline|disconnected|not connected/i.test(facts.recovered)) return false
  if (facts.recoveredCondition === undefined) return /online|live|connected/i.test(facts.recovered)
  return ['ok', 'attention'].includes(facts.recoveredCondition) && !DOWN_WORDS.test(facts.recovered)
}
