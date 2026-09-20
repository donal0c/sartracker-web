/** Creates exact synthetic input bytes in the producer runtime before crossing into Chromium. */
export function createReplayGeometryFixture() {
  /** Builds one closed large polygon without renderer-dependent transcendental rounding. */
  const polygon = (offset) => {
    const ring = Array.from({ length: 2000 }, (_, index) => [
      -9.7 + offset + Math.cos(index * Math.PI / 1000) * 0.01,
      52 + Math.sin(index * Math.PI / 1000) * 0.01,
    ])
    ring.push(ring[0])
    return JSON.stringify({ type: 'Polygon', coordinates: [ring] })
  }
  return { initialGeometry: polygon(0), updatedGeometry: polygon(0.002) }
}
