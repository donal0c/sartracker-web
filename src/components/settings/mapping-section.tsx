import { useState } from 'react'

import type { AppSettingsDraft, CoordinateDisplayMode } from '../../features/settings/settings-types'
import type { SettingsValidationContext } from '../../features/settings/settings-validation'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { OfficialMapPackageStatus } from './official-map-settings'
import {
  addPendingOfficialMapPackage,
  formatOfficialMapStatus,
} from '../../features/settings/official-map-package-draft'
import {
  ChoiceButton,
  SettingsGroup,
  TextField,
} from './settings-fields'
import {
  updateDraft,
  type SettingsDraftSetter,
} from '../../features/settings/settings-draft-edit'

type MappingSectionProps = {
  readonly draft: AppSettingsDraft
  readonly setDraft: SettingsDraftSetter
  readonly validationContext: SettingsValidationContext | undefined
  readonly coordinateDisplayMode: CoordinateDisplayMode
  readonly onCoordinateDisplayModeChange: (mode: CoordinateDisplayMode) => void
  /** Reports a failure the operator must see, or clears it with null. */
  readonly onError: (message: string | null) => void
}

/**
 * Mapping: the official map source and offline packages, and how coordinates
 * are shown on screen.
 */
export function MappingSection(props: MappingSectionProps) {
  const { draft, setDraft, validationContext, onError } = props
  const [choosingSource, setChoosingSource] = useState(false)
  const [choosingPackage, setChoosingPackage] = useState(false)

  return (
    <>
      <SettingsGroup
        title="Official maps"
        description="The standard Kerry/West operating-area package is recommended for most operations. Mission-area or national packages can be imported for specific deployments but are larger and should be prepared in advance."
      >
        <div
          className="border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] px-4 py-3 text-sm text-stone-200"
          data-testid="official-map-source-status"
        >
          <p className="font-semibold text-stone-100">{draft.officialMaps.message}</p>
          <dl className="mt-2 grid gap-2 text-xs text-stone-300 md:grid-cols-3">
            <div>
              <dt className="sar-section-label">Status</dt>
              <dd>{formatOfficialMapStatus(draft.officialMaps.status)}</dd>
            </div>
            <div>
              <dt className="sar-section-label">Username</dt>
              <dd>{draft.officialMaps.username || 'Not configured'}</dd>
            </div>
            <div>
              <dt className="sar-section-label">Services</dt>
              <dd>{draft.officialMaps.serviceCount}</dd>
            </div>
          </dl>
        </div>

        {validationContext?.hostedBrowserMode === true ? (
          <div
            className="sar-inline-alert px-4 py-3 text-sm leading-relaxed"
            data-testid="hosted-official-map-guidance"
          >
            Hosted browser testing does not load private MapGenie credentials or licensed map files. Official maps stay not configured here unless a controlled hosted test source is added later.
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="sar-section-label">Official map source</p>
          <div className="flex gap-3">
            <ChoiceButton
              active={draft.officialMaps.sourceType === 'none'}
              label="None"
              onClick={() =>
                updateDraft(setDraft, (current) => ({
                  ...current,
                  officialMaps: { ...current.officialMaps, sourceType: 'none', sourcePath: '' },
                }))
              }
            />
            <ChoiceButton
              active={draft.officialMaps.sourceType === 'mapgenie_file'}
              label="MapGenie file"
              onClick={() =>
                updateDraft(setDraft, (current) => ({
                  ...current,
                  officialMaps: { ...current.officialMaps, sourceType: 'mapgenie_file' },
                }))
              }
            />
          </div>
        </div>

        <TextField
          label="MapGenie source file"
          testId="official-map-source-path"
          value={draft.officialMaps.sourcePath}
          error={undefined}
          onChange={(value) =>
            updateDraft(setDraft, (current) => ({
              ...current,
              officialMaps: {
                ...current.officialMaps,
                sourceType: value.trim() === '' ? current.officialMaps.sourceType : 'mapgenie_file',
                sourcePath: value,
              },
            }))
          }
        />

        {isElectronRuntimeAvailable() ? (
          <div className="grid gap-3 md:grid-cols-2">
            <button
              className="sar-button px-4 py-3 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
              data-testid="choose-official-map-source-file"
              disabled={choosingSource}
              onClick={() => {
                void handleChooseSourceFile()
              }}
              type="button"
            >
              {choosingSource ? 'Choosing…' : 'Choose MapGenie File'}
            </button>
            <button
              className="sar-button px-4 py-3 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
              data-testid="choose-official-map-package"
              disabled={choosingPackage}
              onClick={() => {
                void handleChoosePackage()
              }}
              type="button"
            >
              {choosingPackage ? 'Choosing…' : 'Add Discovery Package'}
            </button>
          </div>
        ) : null}

        <OfficialMapPackageStatus
          draft={draft}
          onRemove={(packageId) =>
            updateDraft(setDraft, (current) => ({
              ...current,
              officialMaps: {
                ...current.officialMaps,
                packages: current.officialMaps.packages.filter((mapPackage) => mapPackage.id !== packageId),
              },
            }))
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Coordinate display"
        description="Which coordinate format is shown first. Display only: stored positions do not change."
        testId="settings-coordinate-display-mode"
      >
        <div className="flex gap-3">
          <ChoiceButton
            active={props.coordinateDisplayMode === 'wgs84_first'}
            label="Lat/Lon first"
            testId="settings-coordinate-display-wgs84"
            onClick={() => props.onCoordinateDisplayModeChange('wgs84_first')}
          />
          <ChoiceButton
            active={props.coordinateDisplayMode === 'tm65_first'}
            label="TM65 first"
            testId="settings-coordinate-display-tm65"
            onClick={() => props.onCoordinateDisplayModeChange('tm65_first')}
          />
        </div>
      </SettingsGroup>
    </>
  )

  /** Lets the operator pick a MapGenie source file through the desktop chooser. */
  async function handleChooseSourceFile(): Promise<void> {
    setChoosingSource(true)
    onError(null)
    try {
      const chooser = window.sartrackerElectron?.chooseOfficialMapSourceFilePath
      if (chooser === undefined) {
        throw new Error('Official map source file chooser is only available in the Electron app.')
      }
      const sourcePath = await chooser()
      if (sourcePath !== null) {
        updateDraft(setDraft, (current) => ({
          ...current,
          officialMaps: { ...current.officialMaps, sourceType: 'mapgenie_file', sourcePath },
        }))
      }
    } catch (chooseError) {
      onError(toErrorMessage(chooseError))
    } finally {
      setChoosingSource(false)
    }
  }

  /** Imports an offline discovery package chosen through the desktop chooser. */
  async function handleChoosePackage(): Promise<void> {
    setChoosingPackage(true)
    onError(null)
    try {
      const chooser = window.sartrackerElectron?.chooseOfficialMapPackagePath
      if (chooser === undefined) {
        throw new Error('Official map package chooser is only available in the Electron app.')
      }
      const importer = window.sartrackerElectron?.importOfficialMapPackage
      if (importer === undefined) {
        throw new Error('Official map package import is only available in the Electron app.')
      }
      const packagePath = await chooser()
      if (packagePath !== null) {
        const imported = await importer({ sourcePath: packagePath, mapId: 'official_discovery_topo' })
        updateDraft(setDraft, (current) => ({
          ...current,
          officialMaps: {
            ...current.officialMaps,
            packages: addPendingOfficialMapPackage({
              packages: current.officialMaps.packages,
              packagePath: imported.packagePath,
              message: imported.message,
              sizeBytes: imported.sizeBytes,
            }),
          },
        }))
      }
    } catch (chooseError) {
      onError(toErrorMessage(chooseError))
    } finally {
      setChoosingPackage(false)
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
