// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GpxImportPanel } from '../../src/components/gpx-import-panel'
import { useGpxStore } from '../../src/features/gpx/gpx-store'
import type { GpxRuntimeController } from '../../src/features/gpx/start-gpx-runtime'

describe('GPX import pagination', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('discloses bounded coverage and lets the operator request the next page [DON-274]', () => {
    const loadNextImports = vi.fn().mockResolvedValue(undefined)
    useGpxStore.setState({
      controller: { loadNextImports } as unknown as GpxRuntimeController,
      imports: [{
        id: 'gpx-1', mission_id: 'mission-1', source_path: '/field/track.gpx',
        file_name: 'track.gpx', display_name: 'Track',
        geometry_json: '{"type":"MultiLineString","coordinates":[]}', metadata_json: null,
        imported_at: '2026-08-28T10:00:00.000Z', updated_at: '2026-08-28T10:00:00.000Z',
      }],
      importPageNumber: 1,
      hasMoreImports: true,
      loadingMoreImports: false,
    })

    act(() => root.render(createElement(GpxImportPanel)))

    expect(host.querySelector('[data-testid="gpx-import-pagination"]')?.textContent)
      .toContain('More imported evidence is available')
    act(() => {
      ;(host.querySelector('[data-testid="gpx-import-next-page"]') as HTMLButtonElement).click()
    })
    expect(loadNextImports).toHaveBeenCalledOnce()
  })

  it('makes retained all-invalid GPX rejection provenance explicit [DON-274]', () => {
    useGpxStore.setState({
      importIssues: [{
        batch_id: 'batch-1',
        file_name: 'all-invalid.gpx',
        reason: 'GPX file does not contain any usable track segments.',
        rejection_count: 3,
        recorded_at: '2026-08-28T10:00:00.000Z',
      }],
      hasMoreImportIssues: false,
    })

    act(() => root.render(createElement(GpxImportPanel)))

    expect(host.querySelector('[data-testid="gpx-import-issues"]')?.textContent)
      .toContain('3 rejected point/segment records retained with the exact source')
  })
})
