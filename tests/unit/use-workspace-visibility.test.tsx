import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { useWorkspaceVisibility } from '../../src/features/mission/use-workspace-visibility'

for (const transition of ['mission:paused', 'mission:recovery', 'none:idle', 'other:active']) {
  it(`does not reuse hiding choices across ${transition}`, () => {
    const root = createRoot(document.createElement('div'))
    let model!: ReturnType<typeof useWorkspaceVisibility>
    /** Captures the rendered hook result while exercising real React updates. */
    function Harness({ context, blocked = null }: { context: string; blocked?: string | null }) {
      const value = useWorkspaceVisibility(context, blocked)
      useEffect(() => { model = value }, [value])
      return null
    }
    act(() => root.render(<Harness context="mission:active" />))
    act(() => { model.minimize(true) })
    act(() => { model.collapse() })
    expect(model.collapsed).toBe(true)
    act(() => root.render(<Harness context={transition} blocked="Safety controls required" />))
    expect(model.collapsed).toBe(false)
    expect(model.minimized).toBe(false)
    act(() => { model.collapse(); model.minimize(true) })
    expect(model.collapsed).toBe(false)
    act(() => root.render(<Harness context="mission:active" />))
    expect(model.collapsed).toBe(false)
    expect(model.minimized).toBe(false)
    act(() => root.unmount())
  })
}

it('an open decision cancels a hiding choice within the same mission context', () => {
  const root = createRoot(document.createElement('div'))
  let model!: ReturnType<typeof useWorkspaceVisibility>
  /** Presents one mission while its inline decision opens and closes. */
  function Harness({ blocked }: { blocked: string | null }) {
    const value = useWorkspaceVisibility('mission:active', blocked)
    useEffect(() => { model = value }, [value])
    return null
  }
  act(() => root.render(<Harness blocked={null} />))
  act(() => model.minimize(true))
  act(() => root.render(<Harness blocked="Decision open" />))
  expect(model.minimized).toBe(false)
  act(() => root.render(<Harness blocked={null} />))
  expect(model.minimized).toBe(false)
  act(() => root.unmount())
})
