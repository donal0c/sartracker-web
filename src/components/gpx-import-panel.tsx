import { useMemo, useState } from 'react'

import { createDesktopGpxImportSource } from '../infrastructure/gpx-import-source/desktop-gpx-import-source'
import { getGpxImportColor } from '../features/gpx/gpx-style'
import { useGpxStore } from '../features/gpx/gpx-store'
import { isTauriRuntimeAvailable } from '../lib/tauri-runtime'
import { isElectronRuntimeAvailable } from '../lib/desktop-runtime'
import { ColorPaletteInput } from './color-palette-input'

const gpxImportSource = createDesktopGpxImportSource()

/**
 * Renders GPX import and watched-folder controls for operational track ingest.
 */
export function GpxImportPanel() {
  const controller = useGpxStore((state) => state.controller)
  const imports = useGpxStore((state) => state.imports)
  const outings = useGpxStore((state) => state.outings)
  const watchedDirectories = useGpxStore((state) => state.watchedDirectories)
  const importIssues = useGpxStore((state) => state.importIssues)
  const importPageNumber = useGpxStore((state) => state.importPageNumber)
  const hasMoreImports = useGpxStore((state) => state.hasMoreImports)
  const loadingMoreImports = useGpxStore((state) => state.loadingMoreImports)
  const hasMoreImportIssues = useGpxStore((state) => state.hasMoreImportIssues)
  const loading = useGpxStore((state) => state.loading)
  const importing = useGpxStore((state) => state.importing)
  const error = useGpxStore((state) => state.error)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [assignmentActor, setAssignmentActor] = useState('')

  const desktopAvailable = isTauriRuntimeAvailable() || isElectronRuntimeAvailable()
  const canImport = controller !== null && desktopAvailable && !loading && !importing
  const importSummary = useMemo(
    () => `${imports.length}${hasMoreImports ? '+' : ''} shown · page ${importPageNumber} · ${watchedDirectories.length} watched`,
    [hasMoreImports, importPageNumber, imports.length, watchedDirectories.length],
  )

  return (
    <section
      className="rounded-2xl border border-stone-800/60 bg-stone-950/30 p-4 text-sm"
      data-testid="gpx-import-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-stone-300">
            GPX Tracks
          </h3>
          <p className="mt-1 text-xs text-stone-300">
            Import files, ingest folders, and watch operational refresh paths.
          </p>
        </div>
        <span className="rounded-full border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-300">
          {importSummary}
        </span>
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

  async function handleImportFiles(): Promise<void> {
    if (controller === null) {
      return
    }

    const paths = await gpxImportSource.chooseFilePaths()
    if (paths.length === 0) {
      return
    }

    const imported = isElectronRuntimeAvailable()
      ? await controller.importPaths(paths)
      : await controller.importFiles(await gpxImportSource.readFiles(paths))
    setStatusMessage(
      imported.length === 0
        ? 'No new GPX files were imported.'
        : `Imported ${imported.length} GPX file${imported.length === 1 ? '' : 's'}.`,
    )
  }

  async function handleImportFolder(): Promise<void> {
    if (controller === null) {
      return
    }

    const directoryPath = await gpxImportSource.chooseDirectoryPath()
    if (directoryPath === null) {
      return
    }

    const imported = isElectronRuntimeAvailable() && gpxImportSource.listDirectoryPaths !== undefined
      ? await controller.importPaths(await gpxImportSource.listDirectoryPaths(directoryPath))
      : await controller.importFiles(await gpxImportSource.listDirectoryFiles(directoryPath))
    setStatusMessage(
      imported.length === 0
        ? `No new GPX files were found in ${directoryPath}.`
        : `Imported ${imported.length} GPX file${imported.length === 1 ? '' : 's'} from ${directoryPath}.`,
    )
  }

  async function handleWatchFolder(): Promise<void> {
    if (controller === null) {
      return
    }

    const directoryPath = await gpxImportSource.chooseDirectoryPath()
    if (directoryPath === null) {
      return
    }

    const imported = await controller.addWatchedDirectory(directoryPath)
    setStatusMessage(
      imported.length === 0
        ? `Watching ${directoryPath}. No new GPX files were imported.`
        : `Watching ${directoryPath}. Imported ${imported.length} GPX file${imported.length === 1 ? '' : 's'}.`,
    )
  }

  async function handleRescan(): Promise<void> {
    if (controller === null) {
      return
    }

    const imported = await controller.rescanWatchedDirectories()
    setStatusMessage(
      imported.length === 0
        ? 'Rescan complete. No new GPX files were found.'
        : `Rescan imported ${imported.length} new GPX file${imported.length === 1 ? '' : 's'}.`,
    )
  }

  async function handleDeleteImport(importId: string, displayName: string): Promise<void> {
    if (controller === null) {
      return
    }

    const didDelete = await controller.deleteImport(importId)
    setStatusMessage(
      didDelete
        ? `Retired GPX import ${displayName}. Its evidence remains in mission history.`
        : `GPX import ${displayName} was already retired.`,
    )
  }

  async function handleAssignOuting(importId: string, outingId: string): Promise<void> {
    if (controller === null || outingId === '' || assignmentActor.trim() === '') return
    const updated = await controller.assignImportToOuting(importId, outingId, assignmentActor)
    setStatusMessage(updated === null
      ? 'GPX outing assignment was unavailable.'
      : `Assigned ${updated.display_name} to the selected outing as a new evidence revision.`)
  }
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
