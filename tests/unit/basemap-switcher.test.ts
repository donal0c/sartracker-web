import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BasemapSwitcher } from '../../src/components/basemap-switcher'

describe('BasemapSwitcher', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it('groups official maps separately from public fallback maps', () => {
    renderSwitcher()
    click('[data-testid="basemap-menu-toggle"]')

    expect(host.querySelector('[data-testid="map-catalogue-group-official"]')?.textContent).toContain(
      'Official maps',
    )
    expect(
      host.querySelector('[data-testid="map-catalogue-group-public-fallback"]')?.textContent,
    ).toContain('Public fallback maps')
    expect(host.querySelector('[data-testid="basemap-btn-official_discovery_topo"]')?.textContent).toContain(
      'Discovery Topo',
    )
  })

  it('renders official maps as not configured while keeping public maps selectable', () => {
    const onBasemapChange = vi.fn()
    renderSwitcher(onBasemapChange)
    click('[data-testid="basemap-menu-toggle"]')

    const discovery = host.querySelector('[data-testid="basemap-btn-official_discovery_topo"]')
    const publicFallback = host.querySelector('[data-testid="basemap-btn-esri_topo"]')

    expect(discovery).toBeInstanceOf(HTMLButtonElement)
    expect((discovery as HTMLButtonElement).disabled).toBe(true)
    expect(discovery?.textContent).toContain('Not configured')
    expect(publicFallback).toBeInstanceOf(HTMLButtonElement)
    expect((publicFallback as HTMLButtonElement).disabled).toBe(false)

    click('[data-testid="basemap-btn-esri_topo"]')

    expect(onBasemapChange).toHaveBeenCalledWith('esri_topo')
  })

  it('enables configured official maps and returns their map id on selection', () => {
    const onBasemapChange = vi.fn()
    renderSwitcher(onBasemapChange, [
      {
        id: 'official',
        label: 'Official maps',
        items: [
          {
            id: 'official_discovery_topo',
            mapId: 'official_discovery_topo',
            label: 'Discovery Topo',
            description: 'Default official operational map.',
            availability: 'available',
          },
        ],
      },
      {
        id: 'public-fallback',
        label: 'Public fallback maps',
        items: [],
      },
    ])
    click('[data-testid="basemap-menu-toggle"]')

    const discovery = host.querySelector('[data-testid="basemap-btn-official_discovery_topo"]')
    expect(discovery).toBeInstanceOf(HTMLButtonElement)
    expect((discovery as HTMLButtonElement).disabled).toBe(false)

    click('[data-testid="basemap-btn-official_discovery_topo"]')

    expect(onBasemapChange).toHaveBeenCalledWith('official_discovery_topo')
  })

  function renderSwitcher(
    onBasemapChange: (basemapId: never) => void = vi.fn(),
    catalogueGroups?: never,
  ): void {
    act(() => {
      root.render(
        React.createElement(BasemapSwitcher, {
          activeBasemapId: 'opentopomap',
          catalogueGroups,
          onBasemapChange,
        }),
      )
    })
  }

  function click(selector: string): void {
    const element = host.querySelector(selector)
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Expected ${selector} to be an HTML element.`)
    }

    act(() => {
      element.click()
    })
  }
})
