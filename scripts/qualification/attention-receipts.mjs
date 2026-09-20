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
      || !/stale|offline/i.test(facts.stale) || !/offline|disconnected|not connected/i.test(facts.disconnected)
      || !/online|live|connected/i.test(facts.recovered) || /offline|disconnected|not connected/i.test(facts.recovered)
      || facts.cleared !== true || facts.currentVisible !== true || facts.renderedCurrent?.attention !== false
      || JSON.stringify(facts.renderedCurrent?.coordinates) !== '[-9.7,52.00101]') throw new Error('Attention rendered transitions or current-fix visibility are incomplete.')
  if (!/^[a-f0-9]{64}$/u.test(facts.evidenceBeforeAck ?? '') || facts.evidenceBeforeAck !== facts.evidenceAfterAck) {
    throw new Error('Attention acknowledgement changed durable breadcrumb evidence.')
  }
  return { passed: true, scope: 'packaged synthetic attention boundary; deterministic edge corpus and field GPS evidence are separate' }
}
