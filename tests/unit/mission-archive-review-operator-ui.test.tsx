// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  Mission,
  MissionArchiveInfo,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import type {
  ArchiveReviewPublicSession as MissionArchiveReviewSession,
} from '../../src/infrastructure/archive-review/archive-review-types'
import {
  MissionArchiveReviewBanner,
  MissionArchiveReviewControl,
  type MissionArchiveReviewBannerProps,
  type MissionArchiveReviewControlProps,
} from '../../src/features/mission-review/mission-archive-review-operator-ui'
import type { MissionArchiveReviewTimelineEntry } from '../../src/features/mission-review/start-mission-archive-review-runtime'

const PASSPHRASE = 'Review-Archive-Passphrase-2026!'
const RECOVERY_SECRET = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const PRIVATE_ARCHIVE_PATH = '/private/archive-custody/verified-v2.sararch'
const PRIVATE_SESSION_PATH = '/private/tmp/sartracker/archive-review/session/mission-store.sqlite'
const VERIFIED_V2_ID = 'archive-v2-verified'
const SUPERSEDED_V2_ID = 'archive-v2-superseded-verified'
const LEGACY_V1_ID = 'archive-v1-legacy'
const UNVERIFIED_V2_ID = 'archive-v2-unverified'
const MISSING_V2_ID = 'archive-v2-missing'
const NEWER_V3_ID = 'archive-v3-newer'
const MACHINE_ONLY_V2_ID = 'archive-v2-machine-only'
const CIPHERTEXT_SHA256 = 'a'.repeat(64)

const MISSION_ONE: Mission = {
  id: 'mission-archive-one',
  name: 'Glenveagh Search',
  status: 'finalized',
  start_time: '2026-08-28T08:00:00.000Z',
  pause_time: null,
  finish_time: '2026-08-28T18:00:00.000Z',
  paused_seconds: 0,
  notes: null,
  schema_version: 13,
  storage_state: 'live',
}

const MISSION_TWO: Mission = {
  ...MISSION_ONE,
  id: 'mission-archive-two',
  name: 'Errigal Search',
  start_time: '2026-08-20T06:30:00.000Z',
  finish_time: '2026-08-20T15:20:00.000Z',
  storage_state: 'archived',
}

const VERIFIED_V2 = archive({
  id: VERIFIED_V2_ID,
  mission_id: MISSION_ONE.id,
  archive_path: PRIVATE_ARCHIVE_PATH,
  previous_archive_id: SUPERSEDED_V2_ID,
  previous_archive_sha256: 'b'.repeat(64),
  revision_sequence: 2,
  revision_count: 2,
  supplement_authority: 'Duty Admin',
  supplement_reason: 'Correct the clue description recorded during review.',
  supplement_created_at: '2026-08-30T10:30:00.000Z',
} as Partial<MissionArchiveInfo> & Record<string, unknown>)
const SUPERSEDED_VERIFIED_V2 = archive({
  id: SUPERSEDED_V2_ID,
  mission_id: MISSION_ONE.id,
  ciphertext_sha256: 'b'.repeat(64),
  status: 'superseded',
  created_at: '2026-08-28T18:30:00.000Z',
  revision_sequence: 1,
  revision_count: 2,
} as Partial<MissionArchiveInfo> & Record<string, unknown>)
const LEGACY_V1 = archive({
  id: LEGACY_V1_ID,
  mission_id: MISSION_TWO.id,
  container_version: 1,
  archive_path: '/private/archive-custody/legacy-v1.zip',
  ciphertext_sha256: null,
  verified_at: null,
  status: 'sealed',
  slots: [],
})
const UNVERIFIED_V2 = archive({
  id: UNVERIFIED_V2_ID,
  status: 'sealed',
  verified_at: null,
})
const MISSING_V2 = archive({
  id: MISSING_V2_ID,
  availability: 'missing',
  availability_reason: 'Archive bytes are missing.',
})
const NEWER_V3 = archive({
  id: NEWER_V3_ID,
  container_version: 3 as never,
})
const MACHINE_ONLY_V2 = archive({
  id: MACHINE_ONLY_V2_ID,
  slots: [{ slotId: 'machine-slot', slotType: 'machine' }],
})

const TIMELINE: readonly MissionArchiveReviewTimelineEntry[] = [
  {
    mission: MISSION_ONE,
    archives: [
      VERIFIED_V2,
      SUPERSEDED_VERIFIED_V2,
      UNVERIFIED_V2,
      MISSING_V2,
      NEWER_V3,
      MACHINE_ONLY_V2,
    ],
  },
  { mission: MISSION_TWO, archives: [LEGACY_V1] },
]

const V2_SESSION: MissionArchiveReviewSession = Object.freeze({
  sessionId: '987c24da-d3cf-4cac-84d2-b1df45a0e94c',
  archiveId: VERIFIED_V2_ID,
  missionId: MISSION_ONE.id,
  containerVersion: 2,
  encrypted: true,
  verified: true,
  immutable: true,
  ciphertextSha256: CIPHERTEXT_SHA256,
  previousArchiveId: null,
  openedAt: '2026-08-30T09:00:00.000Z',
  plaintextResidual: 'permission_restricted_session_open',
})

const V1_SESSION: MissionArchiveReviewSession = Object.freeze({
  ...V2_SESSION,
  sessionId: '6ac35569-dbbd-4f20-8d5a-36ac07ac3b5e',
  archiveId: LEGACY_V1_ID,
  missionId: MISSION_TWO.id,
  containerVersion: 1,
  encrypted: false,
  verified: false,
  ciphertextSha256: null,
})

describe('Mission archive review operator UI [DON-253 / BCP-16]', () => {
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
    vi.restoreAllMocks()
  })

  it('lists every saved mission and retained archive without a deletion or private-path affordance', () => {
    renderControl(createControlProps())

    expect(text()).toContain(MISSION_ONE.name)
    expect(text()).toContain(MISSION_TWO.name)
    expect(text()).toMatch(/retained indefinitely/iu)
    for (const archiveId of [
      VERIFIED_V2_ID,
      SUPERSEDED_V2_ID,
      LEGACY_V1_ID,
      UNVERIFIED_V2_ID,
      MISSING_V2_ID,
      NEWER_V3_ID,
      MACHINE_ONLY_V2_ID,
    ]) {
      expect(query(`[data-testid="archive-review-select-${archiveId}"]`)).not.toBeNull()
    }

    expect(text()).not.toContain(PRIVATE_ARCHIVE_PATH)
    expect(text()).not.toMatch(/archive path|scratch path|session directory/iu)
    expect(buttonLabels()).not.toMatch(/delete|purge|remove evidence|edit|unlock|re-finali[sz]e/iu)
  })

  it('shows explicit storage state and targets cleanup only to the selected finalized-live mission', () => {
    const onRequestCleanup = vi.fn()
    renderControl(createControlProps({ onRequestCleanup }))

    expect(text()).toContain('Storage: live')
    expect(text()).toContain('Storage: archived')
    expect(query(`[data-testid="archive-cleanup-open-${MISSION_ONE.id}"]`)).not.toBeNull()
    expect(query(`[data-testid="archive-cleanup-open-${MISSION_TWO.id}"]`)).toBeNull()
    click(`archive-cleanup-open-${MISSION_ONE.id}`)
    expect(onRequestCleanup).toHaveBeenCalledWith(MISSION_ONE)
  })

  it('keeps an interrupted cleanup visibly resumable from Saved Mission Archives', () => {
    const interruptedMission: Mission = {
      ...MISSION_ONE,
      id: 'mission-cleanup-in-progress',
      name: 'Interrupted Cleanup Mission',
      storage_state: 'cleanup_in_progress',
    }
    const interruptedArchive = archive({
      id: 'archive-cleanup-in-progress',
      mission_id: interruptedMission.id,
    })
    const onRequestCleanup = vi.fn()
    renderControl(createControlProps({
      onRequestCleanup,
      timeline: [{ mission: interruptedMission, archives: [interruptedArchive] }],
    }))

    const resume = query(
      `[data-testid="archive-cleanup-resume-open-${interruptedMission.id}"]`,
    )
    expect(resume).not.toBeNull()
    expect(query(`[data-testid="archive-cleanup-open-${interruptedMission.id}"]`)).toBeNull()
    ;(resume as HTMLButtonElement).click()
    expect(onRequestCleanup).toHaveBeenCalledWith(interruptedMission)
  })

  it('renders the immutable supplemental chain with predecessor hash, reason, authority, and date', () => {
    renderControl(createControlProps())

    expect(text()).toMatch(/original revision 1 of 2/iu)
    expect(text()).toMatch(/supplement 2 of 2/iu)
    expect(text()).toContain(`SHA-256 ${'b'.repeat(12)}`)
    expect(text()).toContain('Correct the clue description recorded during review.')
    expect(text()).toContain('Duty Admin')
    expect(text()).toMatch(/30\/08\/2026/iu)
    expect(text()).not.toContain('b'.repeat(64))
  })

  it('opens verified v2 with one masked passphrase-or-recovery selection and clears the secret', async () => {
    const onOpenArchive = vi.fn().mockResolvedValue(undefined)
    const onCloseArchiveReview = vi.fn().mockResolvedValue(undefined)
    renderControl(createControlProps({ onOpenArchive, onCloseArchiveReview }))

    click(`archive-review-select-${VERIFIED_V2_ID}`)
    const secret = input('archive-review-secret')
    expect(secret.type).toBe('password')
    expect(input('archive-review-slot-passphrase').checked).toBe(true)
    expect(input('archive-review-slot-recovery').checked).toBe(false)
    expect(checkedCredentialCount()).toBe(1)

    click('archive-review-slot-recovery')
    expect(input('archive-review-slot-passphrase').checked).toBe(false)
    expect(input('archive-review-slot-recovery').checked).toBe(true)
    expect(checkedCredentialCount()).toBe(1)
    changeInput('archive-review-secret', RECOVERY_SECRET)
    expect(text()).not.toContain(RECOVERY_SECRET)

    await clickAndFlush('archive-review-open')
    expect(onOpenArchive).toHaveBeenCalledWith({
      archiveId: VERIFIED_V2_ID,
      containerVersion: 2,
      slotType: 'recovery',
      secret: RECOVERY_SECRET,
    })
    expect(input('archive-review-secret').value).toBe('')

    click(`archive-review-select-${SUPERSEDED_V2_ID}`)
    expect(button(`archive-review-select-${SUPERSEDED_V2_ID}`).disabled).toBe(false)
    expect(input('archive-review-secret').type).toBe('password')

    renderControl(createControlProps({
      phase: 'open',
      activeSession: V2_SESSION,
      onOpenArchive,
      onCloseArchiveReview,
    }))
    expect(query('[data-testid="archive-review-secret"]')).toBeNull()
    await clickAndFlush('archive-review-close')
    expect(onCloseArchiveReview).toHaveBeenCalledOnce()

    renderControl(createControlProps({ onOpenArchive, onCloseArchiveReview }))
    click(`archive-review-select-${VERIFIED_V2_ID}`)
    expect(input('archive-review-secret').value).toBe('')
  })

  it('offers a credentialed restore-for-correction action only inside an open archive session', async () => {
    const restore = vi.fn().mockResolvedValue(undefined)
    renderControl(createControlProps({
      activeSession: V2_SESSION,
      onRestoreForCorrection: restore,
    }))

    expect(query('[data-testid="archive-review-restore-correction"]')).not.toBeNull()
    expect(query('[data-testid="archive-review-correction-admin"]')).not.toBeNull()
    expect(query('[data-testid="archive-review-correction-reason"]')).not.toBeNull()
    changeInput('archive-review-correction-admin', 'Duty Admin')
    changeInput('archive-review-correction-reason', 'Correct a recorded clue.')
    await clickAndFlush('archive-review-restore-correction')
    expect(restore).toHaveBeenCalledWith({
      admin_name: 'Duty Admin',
      reason: 'Correct a recorded clue.',
    })
  })

  it('opens a supported v1 archive credential-free and labels it Legacy unencrypted', async () => {
    const onOpenArchive = vi.fn().mockResolvedValue(undefined)
    renderControl(createControlProps({ onOpenArchive }))

    click(`archive-review-select-${LEGACY_V1_ID}`)
    expect(text()).toContain('Legacy unencrypted')
    expect(query('[data-testid="archive-review-secret"]')).toBeNull()
    expect(query('[data-testid="archive-review-slot-passphrase"]')).toBeNull()
    expect(query('[data-testid="archive-review-slot-recovery"]')).toBeNull()

    await clickAndFlush('archive-review-open')
    expect(onOpenArchive).toHaveBeenCalledWith({
      archiveId: LEGACY_V1_ID,
      containerVersion: 1,
    })
  })

  it('fails closed in the control for unverified, missing, newer, and machine-only v2 archives', () => {
    const onOpenArchive = vi.fn().mockResolvedValue(undefined)
    const onRequestVerification = vi.fn()
    renderControl(createControlProps({ onOpenArchive, onRequestVerification }))

    for (const archiveId of [
      UNVERIFIED_V2_ID,
      MISSING_V2_ID,
      NEWER_V3_ID,
      MACHINE_ONLY_V2_ID,
    ]) {
      const select = button(`archive-review-select-${archiveId}`)
      expect(select.disabled).toBe(true)
      act(() => select.click())
    }
    expect(onOpenArchive).not.toHaveBeenCalled()
    expect(query(`[data-testid="archive-verify-retry-${UNVERIFIED_V2_ID}"]`)).not.toBeNull()
    for (const archiveId of [MISSING_V2_ID, NEWER_V3_ID, MACHINE_ONLY_V2_ID]) {
      expect(query(`[data-testid="archive-verify-retry-${archiveId}"]`)).toBeNull()
    }
    click(`archive-verify-retry-${UNVERIFIED_V2_ID}`)
    expect(onRequestVerification).toHaveBeenCalledWith(UNVERIFIED_V2)
    expect(text()).toMatch(/verification required/iu)
    expect(text()).toMatch(/archive file missing/iu)
    expect(text()).toMatch(/newer.*not supported|unsupported.*newer/iu)
    expect(text()).toMatch(/passphrase or recovery.*unavailable|credential.*unavailable/iu)
  })

  it('clears a failed secret, never reflects backend detail, and remounts with no retained secret', async () => {
    const onOpenArchive = vi.fn().mockRejectedValue(
      new Error(`backend rejected reflected secret ${PASSPHRASE}`),
    )
    const props = createControlProps({ onOpenArchive })
    renderControl(props)
    click(`archive-review-select-${VERIFIED_V2_ID}`)
    changeInput('archive-review-secret', PASSPHRASE)

    await clickAndFlush('archive-review-open')
    expect(input('archive-review-secret').value).toBe('')
    expect(text()).not.toContain(PASSPHRASE)
    expect(text()).not.toContain('backend rejected reflected secret')
    expect(text()).toMatch(/could not be opened safely|failed safely/iu)

    changeInput('archive-review-secret', PASSPHRASE)
    act(() => root.unmount())
    root = createRoot(host)
    renderControl(props)
    click(`archive-review-select-${VERIFIED_V2_ID}`)
    expect(input('archive-review-secret').value).toBe('')
  })

  it('keeps the archive banner persistent, read-only, path-free, and explicit about plaintext', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    renderBanner({
      session: {
        ...V2_SESSION,
        sessionDirectory: PRIVATE_SESSION_PATH,
      } as MissionArchiveReviewSession,
      closing: false,
      error: null,
      recoveryRequired: 'none',
      onCloseArchiveReview: close,
    })

    const banner = element('mission-review-archive-banner')
    expect(banner.textContent).toContain('Archived mission - read-only')
    expect(banner.textContent).toContain(`Verified archive · SHA-256 ${CIPHERTEXT_SHA256.slice(0, 12)}`)
    expect(banner.textContent).not.toContain(CIPHERTEXT_SHA256)
    expect(banner.textContent).toMatch(
      /permission-restricted temporary plaintext.*while.*open.*close archive review.*remove/iu,
    )
    expect(banner.textContent).not.toContain(PRIVATE_SESSION_PATH)
    expect(buttonLabels()).not.toMatch(/delete|purge|edit|unlock|re-finali[sz]e/iu)

    await clickAndFlush('mission-review-close-archive')
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps a cleanup-failure warning visible and labels the mandatory close action as a retry', async () => {
    const close = vi.fn().mockRejectedValue(new Error('plaintext sweep unavailable'))
    renderBanner({
      session: V2_SESSION,
      closing: false,
      error: 'Archive Review plaintext cleanup failed safely.',
      recoveryRequired: 'plaintext_cleanup',
      onCloseArchiveReview: close,
    })

    const banner = element('mission-review-archive-banner')
    expect(banner.textContent).toMatch(/permission-restricted temporary plaintext/iu)
    expect(banner.textContent).toMatch(/plaintext cleanup failed safely/iu)
    expect(button('mission-review-close-archive').textContent)
      .toMatch(/retry close archive review/iu)

    await clickAndFlush('mission-review-close-archive')

    expect(close).toHaveBeenCalledOnce()
    expect(banner.textContent).toMatch(/permission-restricted temporary plaintext/iu)
    expect(banner.textContent).toMatch(/plaintext cleanup failed safely/iu)
    expect(button('mission-review-close-archive').textContent)
      .toMatch(/retry close archive review/iu)
  })

  it('uses the persistent banner to distinguish legacy v1 without a false verification claim', () => {
    renderBanner({
      session: V1_SESSION,
      closing: false,
      error: null,
      recoveryRequired: 'none',
      onCloseArchiveReview: vi.fn().mockResolvedValue(undefined),
    })

    const bannerText = element('mission-review-archive-banner').textContent ?? ''
    expect(bannerText).toContain('Archived mission - read-only')
    expect(bannerText).toContain('Legacy unencrypted')
    expect(bannerText).not.toMatch(/verified archive/iu)
    expect(bannerText).toMatch(/permission-restricted temporary plaintext/iu)
  })

  it('keeps opening-cleanup ownership visible even before a public session exists', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    renderBanner({
      session: null,
      closing: false,
      error: 'Archive Review plaintext cleanup failed safely.',
      recoveryRequired: 'plaintext_cleanup',
      onCloseArchiveReview: close,
    })

    const bannerText = element('mission-review-archive-banner').textContent ?? ''
    expect(bannerText).toMatch(/archive review cleanup required/iu)
    expect(bannerText).toMatch(/temporary plaintext.*may remain|plaintext.*cleanup/iu)
    expect(button('mission-review-close-archive').textContent)
      .toMatch(/retry close archive review/iu)

    await clickAndFlush('mission-review-close-archive')
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports a live-source resume retry without falsely claiming plaintext remains', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    renderBanner({
      session: null,
      closing: false,
      error: 'Live mission review failed to resume after archive cleanup.',
      recoveryRequired: 'live_source_resume',
      onCloseArchiveReview: close,
    })

    const bannerText = element('mission-review-archive-banner').textContent ?? ''
    expect(bannerText).toMatch(/archive review closed|plaintext.*removed/iu)
    expect(bannerText).toMatch(/live mission review.*resume/iu)
    expect(bannerText).not.toMatch(/plaintext.*may remain|plaintext cleanup failed/iu)
    expect(button('mission-review-close-archive').textContent)
      .toMatch(/retry live review/iu)

    await clickAndFlush('mission-review-close-archive')
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports a durable audit retry without falsely claiming plaintext remains', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    renderBanner({
      session: null,
      closing: false,
      error: 'Archive Review plaintext was removed; mutation-denial audit completion is pending.',
      recoveryRequired: 'audit_retry',
      onCloseArchiveReview: close,
    })

    const bannerText = element('mission-review-archive-banner').textContent ?? ''
    expect(bannerText).toMatch(/archive review closed|plaintext.*removed/iu)
    expect(bannerText).toMatch(/audit.*pending|audit.*completion/iu)
    expect(bannerText).not.toMatch(/plaintext.*may remain|plaintext cleanup failed/iu)
    expect(button('mission-review-close-archive').textContent)
      .toMatch(/retry audit|complete audit/iu)

    await clickAndFlush('mission-review-close-archive')
    expect(close).toHaveBeenCalledOnce()
  })

  function renderControl(props: MissionArchiveReviewControlProps): void {
    act(() => root.render(createElement(MissionArchiveReviewControl, props)))
  }

  function renderBanner(props: MissionArchiveReviewBannerProps): void {
    act(() => root.render(createElement(MissionArchiveReviewBanner, props)))
  }

  function createControlProps(
    overrides: Partial<MissionArchiveReviewControlProps> = {},
  ): MissionArchiveReviewControlProps {
    return {
      timeline: TIMELINE,
      phase: 'idle',
      activeSession: null,
      progress: null,
      recoveryRequired: 'none',
      error: null,
      onOpenArchive: vi.fn().mockResolvedValue(undefined),
      onCloseArchiveReview: vi.fn().mockResolvedValue(undefined),
      onRequestVerification: vi.fn(),
      onRequestCleanup: vi.fn(),
      onRestoreForCorrection: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
  }

  function text(): string {
    return host.textContent ?? ''
  }

  function buttonLabels(): string {
    return Array.from(host.querySelectorAll('button'))
      .map((candidate) => candidate.textContent ?? '')
      .join(' ')
  }

  function checkedCredentialCount(): number {
    return host.querySelectorAll(
      '[data-testid="archive-review-slot-passphrase"]:checked, '
      + '[data-testid="archive-review-slot-recovery"]:checked',
    ).length
  }

  function query(selector: string): Element | null {
    return host.querySelector(selector)
  }

  function element(testId: string): HTMLElement {
    const candidate = query(`[data-testid="${testId}"]`)
    if (!(candidate instanceof HTMLElement)) {
      throw new Error(`Expected ${testId} to be rendered.`)
    }
    return candidate
  }

  function button(testId: string): HTMLButtonElement {
    const candidate = element(testId)
    if (!(candidate instanceof HTMLButtonElement)) {
      throw new Error(`Expected ${testId} to be a button.`)
    }
    return candidate
  }

  function input(testId: string): HTMLInputElement {
    const candidate = element(testId)
    if (!(candidate instanceof HTMLInputElement)) {
      throw new Error(`Expected ${testId} to be an input.`)
    }
    return candidate
  }

  function click(testId: string): void {
    act(() => element(testId).click())
  }

  async function clickAndFlush(testId: string): Promise<void> {
    await act(async () => {
      element(testId).click()
      await Promise.resolve()
    })
  }

  function changeInput(testId: string, value: string): void {
    const candidate = input(testId)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(candidate, value)
      candidate.dispatchEvent(new Event('input', { bubbles: true }))
      candidate.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
})

/** Creates a renderer-facing archive timeline fixture. */
function archive(overrides: Partial<MissionArchiveInfo> = {}): MissionArchiveInfo {
  return {
    id: 'archive-default',
    mission_id: MISSION_ONE.id,
    protected_finalization_epoch: 1,
    archive_kind: 'finalized',
    container_version: 2,
    archive_path: `/private/archive-custody/${overrides.id ?? 'archive-default'}.sararch`,
    ciphertext_sha256: CIPHERTEXT_SHA256,
    size_bytes: 4096,
    created_at: '2026-08-28T19:00:00.000Z',
    verified_at: '2026-08-28T19:05:00.000Z',
    previous_archive_id: null,
    previous_archive_sha256: null,
    revision_sequence: 1,
    revision_count: 1,
    supplement_authority: null,
    supplement_reason: null,
    supplement_created_at: null,
    status: 'verified',
    availability: 'present',
    availability_reason: null,
    slots: [
      { slotId: 'passphrase-slot', slotType: 'passphrase' },
      { slotId: 'recovery-slot', slotType: 'recovery' },
    ],
    last_non_machine_unwrap_at: null,
    ...overrides,
  }
}
