import { useMemo, useRef, useState } from 'react'

import { createDesktopGpxImportSource } from '../infrastructure/gpx-import-source/desktop-gpx-import-source'
import { getGpxImportColor } from '../features/gpx/gpx-style'
import { useGpxStore } from '../features/gpx/gpx-store'
import type { GpxImportOperationResult } from '../features/gpx/start-gpx-runtime'
import { isTauriRuntimeAvailable } from '../lib/tauri-runtime'
import { isElectronRuntimeAvailable } from '../lib/desktop-runtime'
import { ColorPaletteInput } from './color-palette-input'
import { describeGpxMapVisibility, type GpxMapVisibility } from '../features/gpx/gpx-map-visibility'
import { useLayerCatalogStore } from '../features/layers/layer-catalog-store'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { revealGpxImportOnMap } from '../features/layers/layer-visibility-service'

const gpxImportSource = createDesktopGpxImportSource()

/**
 * Renders GPX import and watched-folder controls for operational track ingest.
 */
export function GpxImportPanel() {
  const controller = useGpxStore((state) => state.controller)
  const imports = useGpxStore((state) => state.imports)
  const outings = useGpxStore((state) => state.outings)
  const watchedDirectories = useGpxStore((state) => state.watchedDirectories)
  const gpxGroupVisibility = useLayerVisibilityStore((state) => state.groupVisibility)
  const hiddenGpxImportIds = useLayerVisibilityStore((state) => state.hiddenGpxImportIds)
  const importIssues = useGpxStore((state) => state.importIssues)
  const importPageNumber = useGpxStore((state) => state.importPageNumber)
  const hasMoreImports = useGpxStore((state) => state.hasMoreImports)
  const loadingMoreImports = useGpxStore((state) => state.loadingMoreImports)
  const hasMoreImportIssues = useGpxStore((state) => state.hasMoreImportIssues)
  const loading = useGpxStore((state) => state.loading)
  const importing = useGpxStore((state) => state.importing)
  const error = useGpxStore((state) => state.error)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  // Tracks shown on the map whose "shown" choice could not be saved yet.
  const [unsavedReveals, setUnsavedReveals] = useState<ReadonlySet<string>>(new Set())
  const [assignmentActor, setAssignmentActor] = useState('')
  const statusRequest = useRef(0)

  const desktopAvailable = isTauriRuntimeAvailable() || isElectronRuntimeAvailable()
  const canImport = controller !== null && desktopAvailable && !loading && !importing
  const importSummary = useMemo(
    () => {
      // Counts what is drawn, not what is listed: "5 shown" used to appear
      // while every track was hidden in Layers [DON-319].
      const onMap = imports.filter((entry) =>
        describeGpxMapVisibility(entry.id, gpxGroupVisibility, hiddenGpxImportIds) === 'on_map').length
      const hidden = imports.length - onMap
      const paging = hasMoreImports || importPageNumber > 1 ? ` · page ${importPageNumber}` : ''
      return `${imports.length}${hasMoreImports ? '+' : ''} listed · ${onMap} on map${hidden > 0 ? `, ${hidden} hidden in Layers` : ''}${paging} · ${watchedDirectories.length} watched`
    },
    [gpxGroupVisibility, hasMoreImports, hiddenGpxImportIds, importPageNumber, imports, watchedDirectories.length],
  )

  return (
    <section
      className="rounded-2xl border border-stone-800/60 bg-stone-950/30 p-4 text-sm"
      data-testid="gpx-import-panel"
    >
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-stone-300">
          GPX Tracks
        </h3>
        <p className="mt-1 text-xs text-stone-300">
          Import files, ingest folders, and watch operational refresh paths.
        </p>
        {/* A plain line: as a pill it wrapped onto three lines at 1440 px [DON-319]. */}
        <p className="mt-2 text-[11px] font-semibold text-stone-200" data-testid="gpx-import-summary">
          {importSummary}
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <ActionButton
          disabled={!canImport}
          label={importing ? 'Importing…' : 'Import Files'}
          onClick={() => void handleImportFiles()}
          testId="gpx-import-files"
        />
        <ActionButton
          disabled={!canImport}
          label="Import Folder"
          onClick={() => void handleImportFolder()}
          testId="gpx-import-folder"
        />
        <ActionButton
          disabled={!canImport}
          label="Watch Folder"
          onClick={() => void handleWatchFolder()}
          testId="gpx-watch-folder"
        />
        <ActionButton
          disabled={controller === null || importing || watchedDirectories.length === 0}
          label="Rescan Watches"
          onClick={() => void handleRescan()}
          testId="gpx-rescan-watches"
        />
      </div>

      {!desktopAvailable ? (
        <p className="sar-helper-text mt-3" data-testid="gpx-import-desktop-note">
          GPX import controls are available in the desktop app.
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-3 text-sm text-rose-300" data-testid="gpx-import-error">
          {error}
        </p>
      ) : null}
      {importIssues.length > 0 ? (
        <section
          aria-label="Retained GPX import issues"
          className="mt-3 rounded-xl border border-rose-500/40 bg-rose-950/20 p-3"
          data-testid="gpx-import-issues"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-200">
            Retained import issues
          </h4>
          <ul className="mt-2 space-y-2">
            {importIssues.map((issue) => (
              <li className="text-xs text-rose-100" key={`${issue.batch_id}:${issue.file_name}:${issue.recorded_at}`}>
                <strong>{issue.file_name}</strong>: {issue.reason}
                {(issue.rejection_count ?? 0) > 0 ? (
                  <span className="mt-1 block font-semibold">
                    {issue.rejection_count} rejected point/segment record{issue.rejection_count === 1 ? '' : 's'} retained with the exact source.
                  </span>
                ) : null}
                {issue.projection_warnings !== undefined && issue.projection_warnings.length > 0 ? (
                  <span className="mt-1 block font-semibold">
                    Some retained issue fields were shortened for safe display. The persisted record remains authoritative.
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {hasMoreImportIssues ? (
            <p className="mt-2 text-xs font-semibold text-rose-100" data-testid="gpx-import-issues-more">
              Additional retained issues exist beyond this bounded page. Review the persisted mission evidence record before closeout.
            </p>
          ) : null}
        </section>
      ) : null}
      {statusMessage !== null ? (
        <p className="mt-3 text-sm text-emerald-300" data-testid="gpx-import-status">
          {statusMessage}
        </p>
      ) : null}
      <input
        className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100"
        data-testid="gpx-outing-assigned-by"
        maxLength={120}
        onChange={(event) => setAssignmentActor(event.target.value)}
        placeholder="Coordinator name for outing assignments"
        value={assignmentActor}
      />

      <div className="mt-4 space-y-3">
        <PanelList
          emptyMessage="No watched folders. Use Watch Folder above to auto-import new tracks."
          items={watchedDirectories.map((directoryPath) => ({
            id: directoryPath,
            primary: directoryPath,
            secondary: 'Watched directory',
            actionLabel: 'Remove',
            onAction: () => {
              controller?.removeWatchedDirectory(directoryPath)
              setStatusMessage(`Stopped watching ${directoryPath}`)
            },
          }))}
          testId="gpx-watch-list"
          title="Watched Folders"
        />

        <PanelList
          emptyMessage="No GPX tracks imported. Use the buttons above to import files or folders."
          items={imports.map((entry) => ({
            id: entry.id,
            primary: entry.display_name,
            secondary: entry.source_path,
            color: getGpxImportColor(entry.metadata_json),
            onColorChange: (color) => void controller?.updateImportColor(entry.id, color),
            outingId: entry.outing_id ?? '',
            outings,
            outingAssignmentDisabled: assignmentActor.trim() === '',
            onOutingChange: (outingId: string) => void handleAssignOuting(entry.id, outingId),
            actionLabel: 'Retire',
            onAction: () => void handleDeleteImport(entry.id, entry.display_name),
            mapVisibility: describeGpxMapVisibility(entry.id, gpxGroupVisibility, hiddenGpxImportIds),
            onShowOnMap: () => showOnMap(entry.id),
            visibilityUnsaved: unsavedReveals.has(entry.id),
          }))}
          testId="gpx-import-list"
          title="Imported Tracks"
        />
        {hasMoreImports || importPageNumber > 1 ? (
          <div
            className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3"
            data-testid="gpx-import-pagination"
          >
            <p className="text-xs font-semibold text-amber-100">
              Showing bounded GPX page {importPageNumber} ({imports.length} track{imports.length === 1 ? '' : 's'}).
              {hasMoreImports ? ' More imported evidence is available.' : ' This is the final page.'}
            </p>
            <div className="mt-2 flex gap-2">
              {importPageNumber > 1 ? (
                <ActionButton
                  disabled={controller === null || loadingMoreImports}
                  label="Return to First Page"
                  onClick={() => void controller?.returnToFirstImports()}
                  testId="gpx-import-first-page"
                />
              ) : null}
              {hasMoreImports ? (
                <ActionButton
                  disabled={controller === null || loadingMoreImports}
                  label={loadingMoreImports ? 'Loading…' : 'Show Next Page'}
                  onClick={() => void controller?.loadNextImports()}
                  testId="gpx-import-next-page"
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )

  /** Shows one track on the map at once and saves the choice; a failed save is said, never hidden [DON-319]. */
  function showOnMap(importId: string): void {
    const catalog = useLayerCatalogStore.getState()
    void revealGpxImportOnMap(catalog.root, catalog.controller, importId, useLayerVisibilityStore.getState())
      .then(() => {
        setUnsavedReveals((current) => {
          if (!current.has(importId)) return current
          const next = new Set(current)
          next.delete(importId)
          return next
        })
      }, (error: unknown) => {
        setUnsavedReveals((current) => new Set(current).add(importId))
        setStatusMessage(`Track shown on the map, but that choice could not be saved: ${toErrorMessage(error)}. It may be hidden again after a restart; use Save again on the track.`)
      })
  }

  /**
   * A coordinator who imports a track expects to see it (Donal, 1 Oct). Only
   * tracks that are new to this panel are shown; an existing track the
   * operator hid stays hidden when a rescan returns it unchanged [DON-319].
   */
  function showImportedTracks(result: GpxImportOperationResult, startedAt: string): GpxImportOperationResult {
    const deliberatelyHidden = new Set(useLayerVisibilityStore.getState().hiddenGpxImportIds)
    for (const imported of result.imports) {
      // Created by this operation (stored after it started), judged
      // mission-wide rather than by the listed page. A track the operator
      // hid is never re-shown, even one imported moments ago.
      if (imported.imported_at === undefined || imported.imported_at < startedAt) continue
      if (deliberatelyHidden.has(imported.id)) continue
      showOnMap(imported.id)
    }
    return result
  }

  /** When an import operation starts; the store stamps new tracks after this. */
  function operationStart(): string {
    return new Date().toISOString()
  }

  async function handleImportFiles(): Promise<void> {
    if (controller === null) {
      return
    }

    const request = ++statusRequest.current
    const missionAtRequest = useGpxStore.getState().activeMissionId
    try {
      const paths = await gpxImportSource.chooseFilePaths()
      if (paths.length === 0) return
      if (hasMissionChanged(missionAtRequest)) {
        setStatusForRequest(request, describeImportResult({ outcome: 'stale', imports: [] }, 'GPX import'))
        return
      }
      const startedAt = operationStart()
      const result = showImportedTracks(isElectronRuntimeAvailable()
        ? await controller.importPaths(paths)
        : await importFilesForMission(paths, missionAtRequest), startedAt)
      setStatusForRequest(request, describeImportResult(result, 'GPX import'))
    } catch (error) {
      setStatusForRequest(request, `GPX import failed: ${toErrorMessage(error)}`)
    }
  }

  async function handleImportFolder(): Promise<void> {
    if (controller === null) {
      return
    }

    const request = ++statusRequest.current
    const missionAtRequest = useGpxStore.getState().activeMissionId
    try {
      const directoryPath = await gpxImportSource.chooseDirectoryPath()
      if (directoryPath === null) return
      if (hasMissionChanged(missionAtRequest)) {
        setStatusForRequest(request, describeImportResult({ outcome: 'stale', imports: [] }, `GPX folder ${directoryPath}`))
        return
      }
      let result: GpxImportOperationResult
      const startedAt = operationStart()
      if (isElectronRuntimeAvailable() && gpxImportSource.listDirectoryPaths !== undefined) {
        result = await importPathsForMission(await gpxImportSource.listDirectoryPaths(directoryPath), missionAtRequest)
      } else {
        const files = await gpxImportSource.listDirectoryFiles(directoryPath)
        result = hasMissionChanged(missionAtRequest)
          ? { outcome: 'stale', imports: [] }
          : await controller.importFiles(files)
      }
      showImportedTracks(result, startedAt)
      setStatusForRequest(request, describeImportResult(result, `GPX folder ${directoryPath}`))
    } catch (error) {
      setStatusForRequest(request, `GPX folder import failed: ${toErrorMessage(error)}`)
    }
  }

  async function handleWatchFolder(): Promise<void> {
    if (controller === null) {
      return
    }

    const request = ++statusRequest.current
    const missionAtRequest = useGpxStore.getState().activeMissionId
    try {
      const directoryPath = await gpxImportSource.chooseDirectoryPath()
      if (directoryPath === null) return
      if (hasMissionChanged(missionAtRequest)) {
        setStatusForRequest(request, describeImportResult({ outcome: 'stale', imports: [] }, `Watching ${directoryPath}`))
        return
      }
      const startedAt = operationStart()
      const result = showImportedTracks(await controller.addWatchedDirectory(directoryPath), startedAt)
      setStatusForRequest(request, describeImportResult(result, `Watching ${directoryPath}`))
    } catch (error) {
      setStatusForRequest(request, `Watch folder failed: ${toErrorMessage(error)}`)
    }
  }

  async function handleRescan(): Promise<void> {
    if (controller === null) {
      return
    }

    const request = ++statusRequest.current
    try {
      const startedAt = operationStart()
      const result = showImportedTracks(await controller.rescanWatchedDirectories(), startedAt)
      setStatusForRequest(request, describeImportResult(result, 'Rescan'))
    } catch (error) {
      setStatusForRequest(request, `Rescan failed: ${toErrorMessage(error)}`)
    }
  }

  async function handleDeleteImport(importId: string, displayName: string): Promise<void> {
    if (controller === null) {
      return
    }

    const request = ++statusRequest.current
    const didDelete = await controller.deleteImport(importId)
    setStatusForRequest(request,
      didDelete
        ? `Retired GPX import ${displayName}. Its evidence remains in mission history.`
        : `GPX import ${displayName} was already retired.`,
    )
  }

  async function handleAssignOuting(importId: string, outingId: string): Promise<void> {
    if (controller === null || outingId === '' || assignmentActor.trim() === '') return
    const request = ++statusRequest.current
    const updated = await controller.assignImportToOuting(importId, outingId, assignmentActor)
    setStatusForRequest(request, updated === null
      ? 'GPX outing assignment was unavailable.'
      : `Assigned ${updated.display_name} to the selected outing as a new evidence revision.`)
  }

  function setStatusForRequest(request: number, message: string): void {
    if (request === statusRequest.current) setStatusMessage(message)
  }

  /** Checks that an awaited picker or file read still belongs to the active mission. */
  function hasMissionChanged(missionAtRequest: string | null): boolean {
    return useGpxStore.getState().activeMissionId !== missionAtRequest
  }

  /** Reads browser-selected files only while the mission selected at click time remains active. */
  async function importFilesForMission(
    paths: readonly string[],
    missionAtRequest: string | null,
  ): Promise<GpxImportOperationResult> {
    if (hasMissionChanged(missionAtRequest)) return { outcome: 'stale', imports: [] }
    const files = await gpxImportSource.readFiles(paths)
    if (hasMissionChanged(missionAtRequest)) return { outcome: 'stale', imports: [] }
    return await controller!.importFiles(files)
  }

  /** Dispatches native paths only while the mission selected at click time remains active. */
  async function importPathsForMission(
    paths: readonly string[],
    missionAtRequest: string | null,
  ): Promise<GpxImportOperationResult> {
    if (hasMissionChanged(missionAtRequest)) return { outcome: 'stale', imports: [] }
    return await controller!.importPaths(paths)
  }
}

/** Produces an operator-facing status for each explicit import outcome. */
function describeImportResult(result: GpxImportOperationResult, context: string): string {
  switch (result.outcome) {
    case 'imported': {
      const imported = `${result.imports.length} GPX file${result.imports.length === 1 ? '' : 's'}`
      const failureSuffix = result.failures === undefined || result.failures.length === 0
        ? ''
        : ` ${result.failures.length} file${result.failures.length === 1 ? '' : 's'} failed; review the failure details above.`
      if (context === 'GPX import') return `Imported ${imported}.${failureSuffix}`
      if (context === 'Rescan') return `Rescan imported ${imported}.${failureSuffix}`
      if (context.startsWith('Watching ')) return `${context}. Imported ${imported}.${failureSuffix}`
      return `${context} imported ${imported}.${failureSuffix}`
    }
    case 'empty':
      return `${context} found no new GPX files.`
    case 'refused':
      return `${context} was deferred because another GPX import is in progress. Retry after it finishes.`
    case 'stale':
      return `${context} was not applied because the active mission changed. Select the files or folder again.`
    case 'failed': {
      const failed = result.failures?.length ?? 0
      return failed === 0
        ? `${context} could not import the selected GPX files. Review the failure details above.`
        : `${context} could not import ${failed} GPX file${failed === 1 ? '' : 's'}. Review the failure details above.`
    }
  }
}

/** Converts an import failure into safe text for the status line. */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation failed.'
}

function ActionButton(props: {
  readonly disabled: boolean
  readonly label: string
  readonly onClick: () => void
  readonly testId: string
}) {
  return (
    <button
      className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-200 disabled:cursor-not-allowed disabled:opacity-40"
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      {props.label}
    </button>
  )
}

function PanelList(props: {
  readonly title: string
  readonly testId: string
  readonly emptyMessage: string
  readonly items: readonly {
    readonly id: string
    readonly primary: string
    readonly secondary: string
    readonly color?: string
    readonly onColorChange?: (color: string) => void
    readonly outingId?: string
    readonly outings?: readonly { readonly id: string; readonly label: string }[]
    readonly outingAssignmentDisabled?: boolean
    readonly onOutingChange?: (outingId: string) => void
    readonly actionLabel: string
    readonly onAction: () => void
    readonly mapVisibility?: GpxMapVisibility
    readonly onShowOnMap?: () => void
    readonly visibilityUnsaved?: boolean
  }[]
}) {
  return (
    <div className="rounded-xl border border-stone-700 bg-stone-900/30 p-3">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-stone-200">
        {props.title}
      </p>
      <div className="mt-3 space-y-2" data-testid={props.testId}>
        {props.items.length === 0 ? (
          <p className="text-xs font-medium italic text-stone-300">{props.emptyMessage}</p>
        ) : (
          props.items.map((item) => (
            <div
              className="flex flex-col gap-3 rounded-lg border border-stone-700 bg-stone-950/40 px-3 py-2"
              key={item.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-100">{item.primary}</p>
                  <p className="truncate text-[11px] text-stone-300">{item.secondary}</p>
                </div>
                <button
                  className="rounded-lg border border-stone-500 bg-stone-800 px-2 py-1 text-[11px] font-semibold text-stone-100 hover:border-amber-300"
                  data-testid={`${props.testId}-${item.id.replace(/[^a-zA-Z0-9]+/g, '-')}`}
                  onClick={item.onAction}
                  type="button"
                >
                  {item.actionLabel}
                </button>
              </div>
              {item.mapVisibility !== undefined ? (
                <div className="flex items-center justify-between gap-3 text-[11px]" data-testid={`gpx-map-visibility-${item.id}`}>
                  {item.mapVisibility === 'on_map' && item.visibilityUnsaved === true ? (
                    <>
                      <span className="font-semibold text-amber-200">On map, but not saved (may be hidden after a restart)</span>
                      <button
                        className="rounded-lg border border-amber-300/60 bg-stone-800 px-2 py-1 font-semibold text-amber-100"
                        data-testid={`gpx-save-visibility-${item.id}`}
                        onClick={item.onShowOnMap}
                        type="button"
                      >
                        Save again
                      </button>
                    </>
                  ) : item.mapVisibility === 'on_map' ? (
                    <span className="text-stone-300">On map</span>
                  ) : (
                    <>
                      <span className="font-semibold text-amber-200">
                        Hidden on map ({item.mapVisibility === 'group_hidden' ? 'GPX Tracks is off in Layers' : 'this track is off in Layers'})
                      </span>
                      <button
                        className="rounded-lg border border-amber-300/60 bg-stone-800 px-2 py-1 font-semibold text-amber-100"
                        data-testid={`gpx-show-on-map-${item.id}`}
                        onClick={item.onShowOnMap}
                        type="button"
                      >
                        Show on map
                      </button>
                    </>
                  )}
                </div>
              ) : null}
              {item.color !== undefined && item.onColorChange !== undefined ? (
                <ColorPaletteInput
                  label="Track colour"
                  onChange={item.onColorChange}
                  testId={`gpx-import-color-${item.id}`}
                  value={item.color}
                />
              ) : null}
              {item.outings !== undefined && item.onOutingChange !== undefined ? (
                <label className="text-[11px] text-stone-300">Static evidence outing
                  <select
                    className="mt-1 w-full rounded border border-stone-700 bg-stone-950 p-2"
                    data-testid={`gpx-import-outing-${item.id}`}
                    disabled={item.outingAssignmentDisabled}
                    onChange={(event) => item.onOutingChange?.(event.target.value)}
                    value={item.outingId ?? ''}
                  >
                    <option value="">Unassigned — static evidence remains explicit</option>
                    {item.outings.map((outing) => <option key={outing.id} value={outing.id}>{outing.label}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
