import { useState } from 'react'

import {
  buildPackageManifestEntry,
  buildReadinessCertificate,
  checkManifestCoverage,
  classifyPackageCategory,
  type PackageManifestCoverageCheck,
} from '../../features/map/official-map-manifest'
import type { AppSettingsDraft, OfficialMapPackageSettings } from '../../features/settings/settings-types'
import { loadAppSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { exportDiagnosticsReport } from '../../infrastructure/support-report/tauri-support-report-store'

/** Lists registered offline official map packages with readiness and coverage checks. */
export function OfficialMapPackageStatus({
  draft,
  onRemove,
}: {
  readonly draft: AppSettingsDraft
  readonly onRemove: (packageId: string) => void
}) {
  const packages = draft.officialMaps.packages
  const readyCount = packages.filter((mapPackage) => mapPackage.status === 'ready').length
  const [coverageChecks, setCoverageChecks] = useState<Record<string, PackageManifestCoverageCheck>>({})
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)

  function handleCoverageCheck(mapPackage: OfficialMapPackageSettings): void {
    const map = (window as Window & { __SARTRACKER_MAP__?: { getBounds: () => { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number } } }).__SARTRACKER_MAP__
    if (map === undefined) {
      setCoverageChecks((prev) => ({
        ...prev,
        [mapPackage.id]: {
          packageId: mapPackage.id,
          status: 'unknown',
          tone: 'neutral',
          label: 'Map not ready',
          detail: 'The map must be loaded to check coverage against the current view.',
        },
      }))
      return
    }

    try {
      const bounds = map.getBounds()
      const result = checkManifestCoverage(mapPackage, {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      })
      setCoverageChecks((prev) => ({ ...prev, [mapPackage.id]: result }))
    } catch {
      setCoverageChecks((prev) => ({
        ...prev,
        [mapPackage.id]: {
          packageId: mapPackage.id,
          status: 'unknown',
          tone: 'neutral',
          label: 'Map not ready',
          detail: 'The map must be loaded to check coverage against the current view.',
        },
      }))
    }
  }

  async function handleExportCertificate(): Promise<void> {
    setExporting(true)
    setExportFeedback(null)

    try {
      const generatedAt = new Date().toISOString()
      const currentSettings = await loadAppSettings()
      const certificate = buildReadinessCertificate(currentSettings.officialMaps.packages, generatedAt)
      const fileName = `readiness-certificate-${generatedAt.replaceAll(':', '-').replaceAll('.', '-')}.txt`
      const exportedPath = await exportDiagnosticsReport(fileName, certificate.reportText)
      setExportFeedback(`Certificate exported: ${exportedPath}`)
    } catch {
      setExportFeedback('Export failed. Try again or use the diagnostics workspace.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] px-4 py-3 text-sm text-stone-200"
      data-testid="official-map-package-status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-stone-100">Official offline packages</p>
        <span className="text-xs font-bold text-stone-300">
          {readyCount}/{packages.length} ready
        </span>
      </div>
      {packages.length === 0 ? (
        <p className="mt-2 text-xs text-stone-300">
          No local official map package is registered. Electron can still use a configured online MapGenie source when available.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-3">
            {packages.map((mapPackage) => (
              <OfficialMapPackageManifestCard
                key={mapPackage.id}
                mapPackage={mapPackage}
                coverageCheck={coverageChecks[mapPackage.id] ?? null}
                onCheckCoverage={() => handleCoverageCheck(mapPackage)}
                onRemove={() => onRemove(mapPackage.id)}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              className="sar-button px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40"
              data-testid="export-readiness-certificate"
              disabled={exporting}
              onClick={() => { void handleExportCertificate() }}
              type="button"
            >
              {exporting ? 'Exporting…' : 'Export Readiness Certificate'}
            </button>
            {exportFeedback !== null ? (
              <span className="text-xs text-stone-300" data-testid="certificate-export-feedback">
                {exportFeedback}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function OfficialMapPackageManifestCard({
  mapPackage,
  coverageCheck,
  onCheckCoverage,
  onRemove,
}: {
  readonly mapPackage: OfficialMapPackageSettings
  readonly coverageCheck: PackageManifestCoverageCheck | null
  readonly onCheckCoverage: () => void
  readonly onRemove: () => void
}) {
  const manifest = buildPackageManifestEntry(mapPackage)
  const categoryInfo = classifyPackageCategory(mapPackage.sizeBytes)

  return (
    <div
      className="border border-[var(--sar-line)] bg-stone-950/45 px-3 py-3 text-xs"
      data-testid={`package-manifest-${mapPackage.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-stone-100">{manifest.mapLabel}</p>
          <p className="mt-0.5 text-stone-400">{manifest.sourceType} · {manifest.tileFormat}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${packageCategoryBadgeClass(categoryInfo.tone)}`}
            data-testid={`package-category-${mapPackage.id}`}
          >
            {categoryInfo.label}
          </span>
          <span className={`border px-2 py-1 font-black uppercase tracking-[0.12em] ${officialPackageStatusClass(mapPackage.status)}`}>
            {formatOfficialPackageStatus(mapPackage.status)}
          </span>
        </div>
      </div>

      {categoryInfo.tone === 'warning' ? (
        <div
          className="mt-2 border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100"
          data-testid={`package-warning-${mapPackage.id}`}
        >
          {categoryInfo.guidance}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-stone-400" data-testid={`package-guidance-${mapPackage.id}`}>
          {categoryInfo.guidance}
        </p>
      )}

      {manifest.statusMessage !== '' && manifest.status !== 'ready' ? (
        <p className="mt-2 text-stone-300">{manifest.statusMessage}</p>
      ) : null}

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-stone-300 md:grid-cols-3" data-testid={`package-manifest-details-${mapPackage.id}`}>
        <div>
          <dt className="font-semibold text-stone-400">Zoom range</dt>
          <dd>{manifest.zoomRangeDisplay}</dd>
        </div>
        <div>
          <dt className="font-semibold text-stone-400">Tile count</dt>
          <dd>{manifest.tileCount > 0 ? manifest.tileCount.toLocaleString() : 'Unknown'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-stone-400">Package size</dt>
          <dd>{manifest.sizeDisplay}</dd>
        </div>
        {manifest.bounds !== null ? (
          <div className="md:col-span-3">
            <dt className="font-semibold text-stone-400">Coverage bounds</dt>
            <dd>{manifest.bounds.summary}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold text-stone-400">Created</dt>
          <dd>{manifest.createdAtDisplay}</dd>
        </div>
        <div>
          <dt className="font-semibold text-stone-400">Verified</dt>
          <dd>{manifest.verifiedAtDisplay}</dd>
        </div>
      </dl>

      {coverageCheck !== null ? (
        <div
          className={`mt-2 border px-3 py-2 ${coverageCheckClass(coverageCheck.tone)}`}
          data-testid={`coverage-check-result-${mapPackage.id}`}
        >
          <p className="font-semibold">{coverageCheck.label}</p>
          <p className="mt-0.5 text-stone-300">{coverageCheck.detail}</p>
        </div>
      ) : null}

      <div className="mt-2 flex gap-2">
        <button
          className="sar-button px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
          data-testid={`check-coverage-${mapPackage.id}`}
          onClick={onCheckCoverage}
          type="button"
        >
          Check View Coverage
        </button>
        <button
          className="sar-button px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
          data-testid={`remove-official-map-package-${mapPackage.id}`}
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function coverageCheckClass(tone: PackageManifestCoverageCheck['tone']): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-400/40 bg-emerald-950/40 text-emerald-100'
    case 'danger':
      return 'border-rose-400/40 bg-rose-950/40 text-rose-100'
    default:
      return 'border-stone-500/40 bg-stone-900/40 text-stone-200'
  }
}

function packageCategoryBadgeClass(tone: 'success' | 'warning' | 'neutral'): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-400/50 bg-emerald-950/50 text-emerald-200'
    case 'warning':
      return 'border-amber-400/50 bg-amber-950/50 text-amber-200'
    default:
      return 'border-sky-400/50 bg-sky-950/50 text-sky-200'
  }
}

function formatOfficialPackageStatus(
  status: AppSettingsDraft['officialMaps']['packages'][number]['status'],
): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'ready':
      return 'Ready'
    case 'missing':
      return 'Missing'
    case 'invalid':
      return 'Unreadable'
  }
}

function officialPackageStatusClass(
  status: AppSettingsDraft['officialMaps']['packages'][number]['status'],
): string {
  switch (status) {
    case 'pending':
      return 'border-sky-300/60 bg-sky-950/50 text-sky-100'
    case 'ready':
      return 'border-emerald-300/60 bg-emerald-950/50 text-emerald-100'
    case 'missing':
    case 'invalid':
      return 'border-rose-300/60 bg-rose-950/50 text-rose-50'
  }
}
