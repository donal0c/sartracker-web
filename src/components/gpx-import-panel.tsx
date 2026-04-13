import { useMemo, useState } from 'react'

import { createTauriGpxImportSource } from '../infrastructure/gpx-import-source/tauri-gpx-import-source'
import { useGpxStore } from '../features/gpx/gpx-store'
import { isTauriRuntimeAvailable } from '../lib/tauri-runtime'

const gpxImportSource = createTauriGpxImportSource()

/**
 * Renders GPX import and watched-folder controls for operational track ingest.
 */
export function GpxImportPanel() {
  const controller = useGpxStore((state) => state.controller)
  const imports = useGpxStore((state) => state.imports)
  const watchedDirectories = useGpxStore((state) => state.watchedDirectories)
  const loading = useGpxStore((state) => state.loading)
  const importing = useGpxStore((state) => state.importing)
  const error = useGpxStore((state) => state.error)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const desktopAvailable = isTauriRuntimeAvailable()
  const canImport = controller !== null && desktopAvailable && !loading && !importing
  const importSummary = useMemo(
    () => `${imports.length} imported · ${watchedDirectories.length} watched`,
    [imports.length, watchedDirectories.length],
  )

  return (
    <section
      className="rounded-2xl border border-stone-800/60 bg-stone-950/30 p-4 text-sm"
      data-testid="gpx-import-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-stone-400">
            GPX Tracks
          </h3>
          <p className="mt-1 text-xs text-stone-400">
            Import files, ingest folders, and watch operational refresh paths.
          </p>
        </div>
        <span className="rounded-full border border-stone-800 bg-stone-900 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
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
        <p className="mt-3 text-xs text-stone-500" data-testid="gpx-import-desktop-note">
          GPX import controls are available in the Tauri desktop app.
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-3 text-sm text-rose-300" data-testid="gpx-import-error">
          {error}
        </p>
      ) : null}
      {statusMessage !== null ? (
        <p className="mt-3 text-sm text-emerald-300" data-testid="gpx-import-status">
          {statusMessage}
        </p>
      ) : null}

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
            actionLabel: 'Delete',
            onAction: () => void handleDeleteImport(entry.id, entry.display_name),
          }))}
          testId="gpx-import-list"
          title="Imported Tracks"
        />
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

    const files = await gpxImportSource.readFiles(paths)
    const imported = await controller.importFiles(files)
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

    const files = await gpxImportSource.listDirectoryFiles(directoryPath)
    const imported = await controller.importFiles(files)
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
        ? `Deleted GPX import ${displayName}.`
        : `GPX import ${displayName} was already removed.`,
    )
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
    readonly actionLabel: string
    readonly onAction: () => void
  }[]
}) {
  return (
    <div className="rounded-xl border border-stone-800/60 bg-stone-900/30 p-3">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-stone-400">
        {props.title}
      </p>
      <div className="mt-3 space-y-2" data-testid={props.testId}>
        {props.items.length === 0 ? (
          <p className="text-xs font-medium italic text-stone-500">{props.emptyMessage}</p>
        ) : (
          props.items.map((item) => (
            <div
              className="flex items-start justify-between gap-3 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2"
              key={item.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-100">{item.primary}</p>
                <p className="truncate text-[11px] text-stone-500">{item.secondary}</p>
              </div>
              <button
                className="rounded-lg border border-stone-600 bg-stone-800 px-2 py-1 text-[11px] font-semibold text-stone-200"
                data-testid={`${props.testId}-${item.id.replace(/[^a-zA-Z0-9]+/g, '-')}`}
                onClick={item.onAction}
                type="button"
              >
                {item.actionLabel}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
