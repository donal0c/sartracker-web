import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import {
  getDeviceFeatureNodeId,
  TRACKING_DEVICES_LAYER_NODE_ID,
  TRACKING_GROUP_NODE_ID,
} from '../../src/features/layers/layer-catalog-ids'
import { queueLayerSubtreeVisibility, setLayerSubtreeVisibility, StaleLayerVisibilityChangeError } from '../../src/features/layers/layer-subtree-visibility'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'

const root = buildLayerCatalogTree({
  missionId: 'mission-1', devices: [], markers: [], drawings: [], helicopters: [],
  gpxImports: [], measurements: [], metadataEntries: [],
  coverage: { devices: [], periods: [] },
})

afterEach(() => {
  useLayerVisibilityStore.getState().setGroupVisibility('tracking', true)
  useLayerVisibilityStore.setState({ hiddenDeviceIds: [] })
})

const device = (id: string) => ({
  id: `device-${id}`, mission_id: 'mission-1', device_id: id, name: `Team ${id}`,
  color: '#38bdf8', last_seen: '2026-04-10T10:00:00.000Z', status: 'online' as const,
})
const rootWithPeople = buildLayerCatalogTree({
  missionId: 'mission-1', devices: [device('1'), device('2')], markers: [], drawings: [], helicopters: [],
  gpxImports: [], measurements: [],
  // The Current Location layer itself was hidden on the old screen.
  metadataEntries: [{
    missionId: 'mission-1', nodeId: TRACKING_DEVICES_LAYER_NODE_ID, parentNodeId: TRACKING_GROUP_NODE_ID,
    nodeKind: 'layer', alias: null, isFavorite: false, isVisible: false, displayOrder: 10,
    metadataJson: null, updatedAt: '2026-04-10T10:00:00.000Z',
  }],
  coverage: { devices: [], periods: [] },
} as never)

describe('switching a layer on in the simplified workspace [DON-341]', () => {
  it('also switches its hidden Tracking group back on, so the map is not left empty', async () => {
    // The simplified Layers panel does not list the Tracking group, so a group
    // hidden on the old screen could otherwise never be switched back on.
    useLayerVisibilityStore.getState().setGroupVisibility('tracking', false)
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)

    await setLayerSubtreeVisibility({
      root, controller: { setNodeVisibilities } as never,
      nodeId: TRACKING_DEVICES_LAYER_NODE_ID, visible: true, revealAncestors: true,
    })

    expect(useLayerVisibilityStore.getState().groupVisibility.tracking).toBe(true)
    expect(setNodeVisibilities).toHaveBeenCalledWith([TRACKING_GROUP_NODE_ID], true)
  })

  it('leaves the group alone when switching off, or when not asked to reveal', async () => {
    useLayerVisibilityStore.getState().setGroupVisibility('tracking', false)
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)

    await setLayerSubtreeVisibility({
      root, controller: { setNodeVisibilities } as never,
      nodeId: TRACKING_DEVICES_LAYER_NODE_ID, visible: true,
    })
    await setLayerSubtreeVisibility({
      root, controller: { setNodeVisibilities } as never,
      nodeId: TRACKING_DEVICES_LAYER_NODE_ID, visible: false, revealAncestors: true,
    })

    expect(useLayerVisibilityStore.getState().groupVisibility.tracking).toBe(false)
    expect(setNodeVisibilities).not.toHaveBeenCalledWith([TRACKING_GROUP_NODE_ID], true)
  })

  it('switching one person on never switches on other hidden people', async () => {
    useLayerVisibilityStore.getState().setGroupVisibility('tracking', false)
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1', '2'] })
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)

    await setLayerSubtreeVisibility({
      root: rootWithPeople, controller: { setNodeVisibilities } as never,
      nodeId: getDeviceFeatureNodeId('1'), visible: true, revealAncestors: true,
    })

    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual(['2'])
    expect(useLayerVisibilityStore.getState().groupVisibility.tracking).toBe(true)
    // Person 2 only inherited the hidden layer; it is saved hidden before the
    // layer is saved visible, so reopening the mission does not reveal them.
    const calls = setNodeVisibilities.mock.calls.map(([ids, visible]) => [ids, visible])
    const hideSibling = calls.findIndex(([ids, visible]) => visible === false && (ids as string[]).includes(getDeviceFeatureNodeId('2')))
    const showLayer = calls.findIndex(([ids, visible]) => visible === true && (ids as string[]).includes(TRACKING_DEVICES_LAYER_NODE_ID))
    expect(hideSibling).toBeGreaterThanOrEqual(0)
    expect(showLayer).toBeGreaterThan(hideSibling)
  })
})

/**
 * A fake catalog runtime: each write is held until released, then saved and the
 * catalog rebuilt from what was saved, as the real runtime does.
 */
function heldCatalog(options: {
  readonly failWhen?: (ids: readonly string[], visible: boolean) => boolean
  readonly initial?: ReadonlyArray<readonly [string, boolean]>
} = {}) {
  const saved = new Map<string, boolean>(options.initial ?? [[TRACKING_DEVICES_LAYER_NODE_ID, false]])
  const pending: Array<() => void> = []
  const build = () => buildLayerCatalogTree({
    missionId: 'mission-1', devices: [device('1'), device('2')], markers: [], drawings: [], helicopters: [],
    gpxImports: [], measurements: [],
    metadataEntries: [...saved].map(([nodeId, isVisible]) => ({
      missionId: 'mission-1', nodeId, parentNodeId: nodeId === TRACKING_DEVICES_LAYER_NODE_ID ? TRACKING_GROUP_NODE_ID : TRACKING_DEVICES_LAYER_NODE_ID,
      nodeKind: nodeId === TRACKING_DEVICES_LAYER_NODE_ID ? 'layer' : 'feature', alias: null, isFavorite: false, isVisible,
      displayOrder: 10, metadataJson: null, updatedAt: '2026-04-10T10:00:00.000Z',
    })),
    coverage: { devices: [], periods: [] },
  } as never)
  let root = build()
  const setNodeVisibilities = vi.fn((ids: readonly string[], visible: boolean) => new Promise<void>((resolve, reject) => {
    pending.push(() => {
      if (options.failWhen?.(ids, visible) === true) { reject(new Error('disk unavailable')); return }
      for (const id of ids) saved.set(id, visible)
      root = build()
      resolve()
    })
  }))
  const releaseAll = async () => {
    for (let round = 0; round < 50; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      const next = pending.shift()
      if (next === undefined) continue
      next()
    }
  }
  return { controller: { setNodeVisibilities } as never, setNodeVisibilities, readRoot: () => root, saved, releaseAll }
}

describe('People visibility writes [DON-341]', () => {
  it('two people ticked before the first reveal is saved both stay shown, now and after reopening', async () => {
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1', '2'] })
    const catalog = heldCatalog()
    const first = queueLayerSubtreeVisibility({ readMissionId: () => 'mission-1', readRoot: catalog.readRoot, controller: catalog.controller, nodeId: getDeviceFeatureNodeId('1'), visible: true, revealAncestors: true })
    const second = queueLayerSubtreeVisibility({ readMissionId: () => 'mission-1', readRoot: catalog.readRoot, controller: catalog.controller, nodeId: getDeviceFeatureNodeId('2'), visible: true, revealAncestors: true })
    await catalog.releaseAll()
    await Promise.all([first, second])

    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual([])
    expect(catalog.saved.get(TRACKING_DEVICES_LAYER_NODE_ID)).toBe(true)
    expect(catalog.saved.get(getDeviceFeatureNodeId('1'))).not.toBe(false)
    expect(catalog.saved.get(getDeviceFeatureNodeId('2'))).not.toBe(false)
  })

  it('a failed save is reported, and the map goes back to what was saved', async () => {
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1', '2'] })
    const catalog = heldCatalog({ failWhen: (ids, visible) => visible && ids.includes(TRACKING_DEVICES_LAYER_NODE_ID) })
    const reveal = queueLayerSubtreeVisibility({ readMissionId: () => 'mission-1', readRoot: catalog.readRoot, controller: catalog.controller, nodeId: getDeviceFeatureNodeId('1'), visible: true, revealAncestors: true })
    const outcome = reveal.then(() => 'saved', (error: unknown) => error instanceof Error ? error.message : 'failed')
    await catalog.releaseAll()

    expect(await outcome).toBe('disk unavailable')
    // The Current Location layer was never saved visible, so nobody shows as visible.
    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual(expect.arrayContaining(['1', '2']))
  })

  it('a failed save puts back each person as saved: shown people shown, hidden people hidden', async () => {
    // Location layer shown, person 1 shown, person 2 saved hidden.
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['2'] })
    const catalog = heldCatalog({
      initial: [[TRACKING_DEVICES_LAYER_NODE_ID, true], [getDeviceFeatureNodeId('2'), false]],
      failWhen: () => true,
    })
    const hideEveryone = queueLayerSubtreeVisibility({ readMissionId: () => 'mission-1', readRoot: catalog.readRoot, controller: catalog.controller, nodeId: TRACKING_DEVICES_LAYER_NODE_ID, visible: false, revealAncestors: true })
    const outcome = hideEveryone.then(() => 'saved', () => 'failed')
    await catalog.releaseAll()

    expect(await outcome).toBe('failed')
    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual(['2'])
  })

  it('changes queued for one mission never touch the next mission', async () => {
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1', '2'] })
    const catalog = heldCatalog()
    let missionId = 'mission-1'
    const readMissionId = () => missionId
    // A reveal that needs several saves, and a second change queued behind it.
    const reveal = queueLayerSubtreeVisibility({ readMissionId, readRoot: catalog.readRoot, controller: catalog.controller, nodeId: getDeviceFeatureNodeId('1'), visible: true, revealAncestors: true })
    const queued = queueLayerSubtreeVisibility({ readMissionId, readRoot: catalog.readRoot, controller: catalog.controller, nodeId: getDeviceFeatureNodeId('2'), visible: true, revealAncestors: true })
    const outcomes = Promise.all([reveal, queued].map((change) => change.then(() => 'saved', (error: unknown) => error)))
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The operator finishes the mission and starts a new one while the first save is held.
    missionId = 'mission-2'
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1', '2'] })
    await catalog.releaseAll()

    const [first, second] = await outcomes
    expect(first).toBeInstanceOf(StaleLayerVisibilityChangeError)
    expect(second).toBeInstanceOf(StaleLayerVisibilityChangeError)
    // Only the save already under way reached the store; nothing after it ran.
    expect(catalog.setNodeVisibilities).toHaveBeenCalledTimes(1)
    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual(['1', '2'])
  })

  it('a save that fails after the mission changed leaves the new mission alone', async () => {
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1', '2'] })
    const catalog = heldCatalog({ failWhen: () => true })
    let missionId = 'mission-1'
    const reveal = queueLayerSubtreeVisibility({ readMissionId: () => missionId, readRoot: catalog.readRoot, controller: catalog.controller, nodeId: getDeviceFeatureNodeId('1'), visible: true, revealAncestors: true })
    const outcome = reveal.then(() => 'saved', (error: unknown) => error)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A new mission opens, and the operator hides only person 1 there.
    missionId = 'mission-2'
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1'] })
    await catalog.releaseAll()

    expect(await outcome).toBeInstanceOf(StaleLayerVisibilityChangeError)
    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual(['1'])
  })
})
