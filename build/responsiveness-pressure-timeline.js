/** Keeps bounded whole-run coverage; decimation limits fine-grained causal precision. */
export function createPressureTimeline() {
  const limit = 512
  let samples = []
  let observedCount = 0
  let stride = 1
  let latest
  return {
    add(sample) {
      const index = observedCount++
      latest = { index, sample }
      if (index % stride !== 0) return
      samples.push(latest)
      if (samples.length >= limit) {
        stride *= 2
        samples = samples.filter(entry => entry.index % stride === 0)
      }
    },
    snapshot() {
      const retained = [...samples]
      if (latest && retained.at(-1)?.index !== latest.index) retained.push(latest)
      const values = retained.map(entry => entry.sample)
      const maximumSpacingMs = values.reduce((maximum, sample, index) => index === 0 ? maximum
        : Math.max(maximum, sample.startMs - values[index - 1].startMs), 0)
      return { policy: 'whole-run-progressive-decimation', samples: values, observedCount,
        decimatedCount: observedCount - values.length, sampleStride: stride, maximumSpacingMs }
    },
  }
}
