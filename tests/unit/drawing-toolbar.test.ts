import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDrawingStore } from '../../src/features/drawings/drawing-store'
import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import { MAP_TOOLS_GROUP_NODE_ID, MEASUREMENTS_LAYER_NODE_ID, getDrawingLayerNodeId } from '../../src/features/layers/layer-catalog-ids'
import { useLayerCatalogStore } from '../../src/features/layers/layer-catalog-store'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'
import { useMeasurementStore } from '../../src/features/measurements/measurement-store'
import { useMissionStore } from '../../src/features/mission/mission-store'

/**
 * DON-72: the visible Map Tools list must not offer a "Select" button, while
 * the internal select mode remains the default/fallback after tools complete
 * or cancel (so editing existing drawings still works).
 */

describe('DrawingToolbar', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    useDrawingStore.setState({
      controller: { setActiveTool: vi.fn(), cancelActiveTool: vi.fn() } as never,
      activeTool: 'select',
      dialog: null,
    })
    useMeasurementStore.setState({ controller: null as never, mode: 'idle' as never })
    useMissionStore.setState({
      currentMission: { id: 'mission-1' } as never,
      phase: 'active' as never,
    })
  })

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.clearAllMocks()
    useDrawingStore.setState(useDrawingStore.getInitialState())
    useLayerCatalogStore.setState(useLayerCatalogStore.getInitialState())
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    useMeasurementStore.setState(useMeasurementStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
  })

  it('does not render a Select button in the expanded Map Tools list', async () => {
    const { DrawingToolbar } = await import('../../src/components/drawing-toolbar')
    render(React.createElement(DrawingToolbar))

    click('[data-testid="drawing-toolbar-expand"]')

    expect(document.querySelector('[data-testid="drawing-tool-select"]')).toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-line"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-range_ring"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-search_sector"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-text_label"]')).not.toBeNull()
  })

  it('still shows Select as the active-mode chip when select mode is the fallback', async () => {
    const { DrawingToolbar } = await import('../../src/components/drawing-toolbar')
    useDrawingStore.setState({ activeTool: 'select' })

    render(React.createElement(DrawingToolbar))

    const chip = document.querySelector('[data-testid="drawing-toolbar-active-mode"]')
    expect(chip?.textContent).toContain('Select')
  })

  it('reveals Map Tools and the selected drawing layer before arming a drawing tool', async () => {
    const { DrawingToolbar } = await import('../../src/components/drawing-toolbar')
    const setActiveTool = vi.fn()
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)
    useDrawingStore.setState({
      controller: { setActiveTool, cancelActiveTool: vi.fn() } as never,
      activeTool: 'select',
    })
    installHiddenMapToolsCatalog(setNodeVisibilities)

    render(React.createElement(DrawingToolbar))

    click('[data-testid="drawing-toolbar-expand"]')
    click('[data-testid="drawing-tool-line"]')
    await Promise.resolve()

    const visibility = useLayerVisibilityStore.getState()
    expect(visibility.groupVisibility.mapTools).toBe(true)
    expect(visibility.drawingTypeVisibility.line).toBe(true)
    expect(setNodeVisibilities).toHaveBeenCalledWith(
      [MAP_TOOLS_GROUP_NODE_ID, getDrawingLayerNodeId('line')],
      true,
    )
    expect(setActiveTool).toHaveBeenCalledWith('line')
  })

  it('reveals Map Tools and Measurements before arming Measure from the toolbar', async () => {
    const { DrawingToolbar } = await import('../../src/components/drawing-toolbar')
    const armMeasurement = vi.fn()
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)
    useMeasurementStore.setState({
      controller: {
        armMeasurement,
        cancelMeasurement: vi.fn(),
        registerPoint: vi.fn(),
        setHoverPoint: vi.fn(),
        clearMeasurements: vi.fn(),
      } as never,
      mode: 'idle' as never,
    })
    installHiddenMapToolsCatalog(setNodeVisibilities)

    render(React.createElement(DrawingToolbar))

    click('[data-testid="drawing-toolbar-expand"]')
    click('[data-testid="drawing-tool-measure"]')
    await Promise.resolve()

    const visibility = useLayerVisibilityStore.getState()
    expect(visibility.groupVisibility.mapTools).toBe(true)
    expect(visibility.measurementsVisible).toBe(true)
    expect(setNodeVisibilities).toHaveBeenCalledWith(
      [MAP_TOOLS_GROUP_NODE_ID, MEASUREMENTS_LAYER_NODE_ID],
      true,
    )
    expect(armMeasurement).toHaveBeenCalled()
  })

  function render(element: React.ReactElement): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(element)
    })
  }
})

function installHiddenMapToolsCatalog(
  setNodeVisibilities: (nodeIds: readonly string[], visible: boolean) => Promise<void>,
): void {
  const root = buildLayerCatalogTree({
    missionId: 'mission-1',
    devices: [],
    markers: [],
    drawings: [],
    helicopters: [],
    gpxImports: [],
    metadataEntries: [
      hiddenEntry(MAP_TOOLS_GROUP_NODE_ID, 'root:mission-catalog', 'group', 30),
      hiddenEntry(getDrawingLayerNodeId('line'), MAP_TOOLS_GROUP_NODE_ID, 'layer', 50),
      hiddenEntry(MEASUREMENTS_LAYER_NODE_ID, MAP_TOOLS_GROUP_NODE_ID, 'layer', 110),
    ],
  })

  useLayerCatalogStore.setState({
    missionId: 'mission-1',
    root,
    controller: {
      refreshCatalog: vi.fn(),
      forceRefresh: vi.fn(),
      selectNode: vi.fn(),
      renameNode: vi.fn(),
      setNodeVisibility: vi.fn(),
      setNodeVisibilities,
      reorderNode: vi.fn(),
    } as never,
  })
  useLayerVisibilityStore.getState().hydrateCatalogVisibility('mission-1', root)
}

function hiddenEntry(
  nodeId: string,
  parentNodeId: string,
  nodeKind: 'group' | 'layer',
  displayOrder: number,
) {
  return {
    missionId: 'mission-1',
    nodeId,
    parentNodeId,
    nodeKind,
    alias: null,
    isFavorite: false,
    isVisible: false,
    displayOrder,
    metadataJson: null,
    updatedAt: '2026-06-05T08:00:00.000Z',
  }
}

function click(selector: string): void {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to be an HTML element.`)
  }
  act(() => {
    element.click()
  })
}
