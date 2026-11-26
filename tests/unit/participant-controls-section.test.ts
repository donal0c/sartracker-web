import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ParticipantControlsSection } from '../../src/components/participant-controls-section'
import { historyLoaded, historySettled, historyStillLoading, noEarlierHistoryAsked } from '../../scripts/team-smoke/lib/history-status.mjs'
import { useMissionStore } from '../../src/features/mission/mission-store'
import type { ParticipantRuntimeController } from '../../src/features/participants/start-participant-runtime'
import { useParticipantStore } from '../../src/features/participants/participant-store'
import type { ParticipantRemovalPreview } from '../../src/features/participants/participant-removal-prompt'
import { MissionSectionDisclosure } from '../../src/components/mission-section-disclosure'
import { SectionBodyOpenContext } from '../../src/components/section-body-open'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import type { MissionSectionSummary } from '../../src/features/mission/mission-section-summary'
import type { MissionParticipant } from '../../src/infrastructure/mission-store/tauri-mission-store'
import type { NormalizedTrackingDevice } from '../../src/features/tracking/tracking-types'

let root: Root | null = null
let host: HTMLDivElement | null = null

describe('ParticipantControlsSection [DON-271]', () => {
  it('offers explicit recovery for removed unknown legacy groups', () => {
    useParticipantStore.setState({ participants: [{
      id: 'legacy', mission_id: 'mission', kind: 'group', traccar_device_id: null,
      mission_team_id: 'team', provenance: 'explicit', effective_from: '2026-08-20T08:00:00Z',
      added_at: '2026-08-20T09:00:00Z', added_by: 'A', removed_at: '2026-08-20T10:00:00Z', removed_by: 'A',
      starting_member_device_ids_json: null, backfill_scope_unknown: true,
    }] })
    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
    expect(document.querySelector('[data-testid="legacy-roster-recovery"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[data-testid="legacy-roster-confirm"]')?.disabled).toBe(true)
  })

  it('keeps corruption errors visible for removed groups without offering attestation', () => {
    useParticipantStore.setState({ participants: [{ id: 'broken', mission_id: 'mission', kind: 'group',
      traccar_device_id: null, mission_team_id: 'team', provenance: 'explicit',
      effective_from: '2026-08-20T08:00:00Z', added_at: '2026-08-20T09:00:00Z', added_by: 'A',
      removed_at: '2026-08-20T10:00:00Z', removed_by: 'A', backfill_scope_unknown: true,
      backfill_scope_error: 'Stored roster attestation is invalid. Retain this mission for repair.' }] })
    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
    expect(document.querySelector('[data-testid="participant-management"]')?.textContent).toContain('Stored roster attestation is invalid')
    expect(document.querySelector('[data-testid="legacy-roster-recovery"]')).toBeNull()
  })
  it('shows explicit zero-member backfill status', () => {
    useParticipantStore.setState({ participants: [{
      id: 'empty-group', mission_id: 'mission', kind: 'group',
      traccar_device_id: null, mission_team_id: 'team', traccar_group_id: '1', team_name: 'Empty team',
      provenance: 'explicit', effective_from: '2026-09-13T08:00:00Z', added_at: '2026-09-13T09:00:00Z',
      added_by: 'Coordinator', removed_at: null, removed_by: null,
      backfill_member_count: 0, backfill_completed_count: 0, backfill_scope_unknown: false,
    }] })
    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
    expect(document.querySelector('[data-testid="participant-backfill-status"]')?.textContent)
      .toContain('complete for 0/0 required group members')
  })

  afterEach(() => {
    if (root !== null) act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    useParticipantStore.setState(useParticipantStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
    useTrackingStore.setState(useTrackingStore.getInitialState())
  })

  describe('team default group at Start [DON-296]', () => {
    const groups = [
      { group_id: 'group-kmrt', name: 'KMRT', parent_group_id: null },
      { group_id: 'group-other', name: 'Other team', parent_group_id: null },
    ]

    it('marks the pre-ticked team default group and says it can be unticked', () => {
      useParticipantStore.setState({
        availableGroups: groups, draftGroupIds: ['group-kmrt'], defaultGroupId: 'group-kmrt', defaultGroupMissing: false,
      })
      render(React.createElement(ParticipantControlsSection, { phase: 'idle' }))
      const step = document.querySelector('[data-testid="participant-selection-step"]')?.textContent ?? ''
      expect(step).toContain("Your team's default group is ticked")
      expect(step).not.toContain('Nothing is pre-selected')
      const picker = document.querySelector('[data-testid="participant-group-picker"]')?.textContent ?? ''
      expect(picker).toContain('team default')
    })

    it('keeps the original wording when no default group is set', () => {
      useParticipantStore.setState({ availableGroups: groups, defaultGroupId: null, defaultGroupMissing: false })
      render(React.createElement(ParticipantControlsSection, { phase: 'idle' }))
      expect(document.querySelector('[data-testid="participant-selection-step"]')?.textContent)
        .toContain('Nothing is pre-selected')
    })

    it('does not claim the default is ticked after the coordinator unticks it', () => {
      useParticipantStore.setState({
        availableGroups: groups, draftGroupIds: [], defaultGroupId: 'group-kmrt', defaultGroupMissing: false,
      })
      render(React.createElement(ParticipantControlsSection, { phase: 'idle' }))
      expect(document.querySelector('[data-testid="participant-selection-step"]')?.textContent)
        .not.toContain("Your team's default group is ticked")
    })

    it('says when the default group is not on the tracking server', () => {
      useParticipantStore.setState({ availableGroups: groups.slice(1), defaultGroupId: 'group-kmrt', defaultGroupMissing: true })
      render(React.createElement(ParticipantControlsSection, { phase: 'idle' }))
      expect(document.querySelector('[data-testid="participant-default-group-missing"]')?.textContent)
        .toContain('is not on the tracking server')
    })
  })

  describe('history start for participants added after Start [DON-291]', () => {
    const missionStart = '2026-09-27T06:10:39.479Z'

    function renderActiveMission(addParticipant: ParticipantRuntimeController['addParticipant']): void {
      useMissionStore.setState({
        phase: 'active',
        currentMission: { id: 'mission-1', name: 'Lookback', start_time: missionStart } as never,
      })
      useParticipantStore.setState({
        controller: { addParticipant } as unknown as ParticipantRuntimeController,
        availableDevices: [{
          device_id: '11', name: 'History Hotel', status: 'offline', last_seen: null,
          unique_id: 'hist-11', category: null, group_id: null,
        } as never],
      })
      render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
      changeSelect('[data-testid="participant-add-ref"]', '11')
    }

    it('keeps Add disabled until the coordinator chooses where history starts', () => {
      renderActiveMission(async () => null)
      expect(addButton().disabled).toBe(true)
      expect(document.querySelector('[data-testid="participant-history-start-mission"]')?.closest('label')?.textContent)
        .toContain(new Date(missionStart).toLocaleString())
      click('[data-testid="participant-history-start-now"]')
      expect(addButton().disabled).toBe(false)
    })

    it('adds a late participant from the exact mission start when chosen', async () => {
      const calls: unknown[] = []
      renderActiveMission(async (input) => {
        calls.push(input)
        return null
      })
      click('[data-testid="participant-history-start-mission"]')
      await act(async () => addButton().click())
      expect(calls).toEqual([expect.objectContaining({ kind: 'device', ref: '11', effective_from: missionStart })])
    })

    it('adds From now without an effective time so the store stamps the add time', async () => {
      const calls: Array<Record<string, unknown>> = []
      renderActiveMission(async (input) => {
        calls.push(input as Record<string, unknown>)
        return null
      })
      click('[data-testid="participant-history-start-now"]')
      await act(async () => addButton().click())
      expect(calls).toHaveLength(1)
      expect(calls[0]).not.toHaveProperty('effective_from')
    })

    it('says no earlier history was requested instead of claiming backfill complete', () => {
      useParticipantStore.setState({ participants: [{
        id: 'late', mission_id: 'mission-1', kind: 'device', traccar_device_id: '11', mission_team_id: null,
        provenance: 'explicit', effective_from: '2026-09-29T06:13:04.050Z', added_at: '2026-09-29T06:13:04.050Z',
        added_by: 'Mission coordinator', removed_at: null, removed_by: null, backfill_completed: 1,
      }] })
      render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
      const status = document.querySelector('[data-testid="participant-backfill-status"]')?.textContent ?? ''
      expect(status).toContain('no earlier history requested')
      expect(status).not.toContain('complete')
    })

    it('warns on the start step that a lookback only applies to selected participants', () => {
      render(React.createElement(ParticipantControlsSection, { phase: 'idle', lookbackRequested: true }))
      expect(document.querySelector('[data-testid="participant-lookback-notice"]')?.textContent)
        .toContain('Earlier history is only fetched for participants selected here')
    })

    it('shows no lookback notice when the mission starts now', () => {
      render(React.createElement(ParticipantControlsSection, { phase: 'idle', lookbackRequested: false }))
      expect(document.querySelector('[data-testid="participant-lookback-notice"]')).toBeNull()
    })
  })

  describe('simplified running panel: warnings above the fold, changes inside it [DON-368]', () => {
    const group = {
      id: 'hill', mission_id: 'mission-1', kind: 'group' as const, traccar_device_id: null, mission_team_id: 'team',
      traccar_group_id: '101', team_name: 'Hill Team', provenance: 'explicit' as const,
      effective_from: '2026-11-24T05:37:16.000Z', added_at: '2026-11-24T07:37:16.000Z', added_by: 'Mission coordinator',
      removed_at: null, removed_by: null, backfill_member_count: 6, backfill_completed_count: 0,
      backfill_scope_unknown: false, starting_member_device_ids_json: '[]',
    }

    it('shows every warning, in plain words, and none of the admin form', () => {
      useParticipantStore.setState({
        participants: [{ ...group, backfill_scope_error: 'Group roster could not be read.' }],
        envelope: { activeDeviceCount: 6, warning: 'Tracking scope is wider than this mission.' } as never,
        membershipNotices: ['6 devices in Hill Team are missing from the tracking server.'],
        rosterError: 'Group membership could not be recorded: disk busy',
      })
      render(React.createElement(ParticipantControlsSection, { phase: 'active', variant: 'simplified', part: 'warnings' }))
      const text = document.body.textContent ?? ''
      expect(text).toContain('Tracking scope is wider than this mission.')
      expect(text).toContain('missing from the tracking server')
      expect(text).toContain('disk busy')
      expect(text).toContain('Earlier positions for Hill Team could not be loaded: Group roster could not be read.')
      expect(document.querySelector('[data-testid="participant-add-btn"]')).toBeNull()
      expect(document.querySelector('[data-testid="participant-active-list"]')).toBeNull()
    })

    it('renders nothing when there is nothing to warn about', () => {
      useParticipantStore.setState({ participants: [group] })
      render(React.createElement(ParticipantControlsSection, { phase: 'active', variant: 'simplified', part: 'warnings' }))
      expect(host?.textContent).toBe('')
    })

    it('lists people with Remove and the add form in plain words, without repeating the warnings', () => {
      useParticipantStore.setState({
        participants: [group],
        envelope: { activeDeviceCount: 6, warning: 'Tracking scope is wider than this mission.' } as never,
      })
      render(React.createElement(ParticipantControlsSection, { phase: 'active', variant: 'simplified', part: 'admin' }))
      const management = document.querySelector('[data-testid="participant-management"]')?.textContent ?? ''
      expect(management).toContain('Hill Team')
      expect(management).toContain('Remove')
      expect(document.querySelector('[data-testid="participant-add-btn"]')).not.toBeNull()
      expect(management).not.toContain('Tracking scope is wider')
      expect(management).not.toMatch(/explicit|backfill|effective|Traccar group|Individual device/)
      expect(document.querySelector('[data-testid="participant-backfill-status"]')?.textContent)
        .toContain('Earlier positions: loading for 6 of 6 people')
    })

    it('says in plain words when an older version, not a coordinator, put someone on the mission', () => {
      useParticipantStore.setState({ participants: [
        { ...group, provenance: 'grandfathered' as const },
        { ...group, id: 'auto', team_name: 'Auto Team', provenance: 'legacy_auto' as const },
      ] as never })
      render(React.createElement(ParticipantControlsSection, { phase: 'active', variant: 'simplified', part: 'admin' }))
      const list = document.querySelector('[data-testid="participant-active-list"]')?.textContent ?? ''
      expect(list).toContain('Group · carried over from an older version · from')
      expect(list).toContain('Group · added automatically by an older version · from')
    })

    it('keeps where a group\'s member list came from on screen, also for a removed group', () => {
      useParticipantStore.setState({ participants: [
        { ...group, backfill_scope_inferred: true, backfill_completed_count: 6 },
        { ...group, id: 'old', team_name: 'Old Team', removed_at: '2026-11-24T08:00:00.000Z', removed_by: 'Coordinator',
          backfill_scope_attested: true, backfill_completed_count: 2 },
      ] as never })
      render(React.createElement(ParticipantControlsSection, { phase: 'active', variant: 'simplified', part: 'admin' }))
      expect(document.querySelector('[data-testid="participant-backfill-status"]')?.textContent)
        .toContain('loaded for 6 people (members worked out from saved records)')
      act(() => root?.unmount())
      render(React.createElement(ParticipantControlsSection, { phase: 'active', variant: 'simplified', part: 'warnings' }))
      expect(document.querySelector('[data-testid="participant-warnings"]')?.textContent)
        .toContain('Removed group Old Team: Earlier positions: loading for 4 of 6 people (members confirmed by a coordinator)')
    })

    it('shows why a removed group\'s earlier positions could not load, not only a pointer to it', () => {
      useParticipantStore.setState({ participants: [
        { ...group, id: 'old', team_name: 'Old Team', removed_at: '2026-11-24T08:00:00.000Z', removed_by: 'Coordinator',
          backfill_scope_unknown: true, backfill_scope_error: 'Stored roster attestation is invalid.' },
      ] as never })
      render(React.createElement(ParticipantControlsSection, { phase: 'active', variant: 'simplified', part: 'warnings' }))
      const warnings = document.querySelector('[data-testid="participant-warnings"]')?.textContent ?? ''
      expect(warnings).toContain('Earlier positions for removed group Old Team could not be loaded: Stored roster attestation is invalid.')
      expect(warnings).toContain('Removed group Old Team: Earlier positions: could not be loaded (see the warning above)')
    })
  })

  describe('Remove asks before it stops tracking anyone [DON-373]', () => {
    const groupRow: MissionParticipant = {
      id: 'part-kmrt', mission_id: 'mission', kind: 'group', traccar_device_id: null,
      mission_team_id: 'team-kmrt', traccar_group_id: '7', team_name: 'KMRT', provenance: 'explicit',
      effective_from: '2026-11-26T08:00:00Z', added_at: '2026-11-26T08:00:00Z', added_by: 'A',
      removed_at: null, removed_by: null,
    }
    const deviceRow: MissionParticipant = {
      id: 'part-alice', mission_id: 'mission', kind: 'device', traccar_device_id: '31',
      mission_team_id: null, traccar_group_id: null, team_name: null, provenance: 'explicit',
      effective_from: '2026-11-26T08:00:00Z', added_at: '2026-11-26T08:00:00Z', added_by: 'A',
      removed_at: null, removed_by: null,
    }
    const alice: NormalizedTrackingDevice = {
      device_id: '31', name: 'Alice', status: 'online', last_seen: null, unique_id: 'u-31', category: null, group_id: null,
    }
    const previews: Record<string, ParticipantRemovalPreview> = {
      'part-kmrt': { stopsTrackingCount: 3, rosterConfirmed: true },
      'part-alice': { stopsTrackingCount: 1, rosterConfirmed: true },
    }

    function renderRunning(
      removeParticipant: ParticipantRuntimeController['removeParticipant'],
      element: React.ReactElement = React.createElement(ParticipantControlsSection, { phase: 'active' }),
    ): void {
      const controller: Pick<ParticipantRuntimeController, 'removeParticipant' | 'previewRemoval'> = {
        removeParticipant,
        previewRemoval: (participantId) => previews[participantId] ?? null,
      }
      useParticipantStore.setState({
        controller: controller as ParticipantRuntimeController,
        participants: [groupRow, deviceRow],
        availableDevices: [alice],
      })
      useTrackingStore.setState({ status: { ...useTrackingStore.getInitialState().status, mode: 'online' } })
      render(element)
    }

    function removeCalls(): { calls: unknown[][]; fn: ParticipantRuntimeController['removeParticipant'] } {
      const calls: unknown[][] = []
      const fn: ParticipantRuntimeController['removeParticipant'] = async (...args) => {
        calls.push(args)
        return null
      }
      return { calls, fn }
    }

    it('one click on Remove does not remove; it asks, naming the group and how many people', () => {
      const remove = removeCalls()
      renderRunning(remove.fn)
      click('[data-testid="participant-remove-part-kmrt"]')
      expect(remove.calls).toHaveLength(0)
      const confirm = document.querySelector('[data-testid="participant-remove-confirmation"]')
      expect(confirm?.textContent).toContain('Stop tracking KMRT (3 people)? Their positions stop being recorded.')
      expect(confirm?.querySelector('[data-testid="participant-remove-confirm-btn"]')?.textContent).toBe('Remove')
      expect(confirm?.querySelector('[data-testid="participant-remove-keep-btn"]')?.textContent).toBe('Keep')
    })

    it('names one person for a single device', () => {
      const remove = removeCalls()
      renderRunning(remove.fn)
      click('[data-testid="participant-remove-part-alice"]')
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')?.textContent)
        .toContain('Stop tracking Alice (1 person)? Their positions stop being recorded.')
    })

    it('Keep closes the question, removes nobody and returns focus to Remove', () => {
      const remove = removeCalls()
      renderRunning(remove.fn)
      click('[data-testid="participant-remove-part-kmrt"]')
      expect(document.activeElement?.getAttribute('data-testid')).toBe('participant-remove-keep-btn')
      click('[data-testid="participant-remove-keep-btn"]')
      expect(remove.calls).toHaveLength(0)
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')).toBeNull()
      expect(document.activeElement?.getAttribute('data-testid')).toBe('participant-remove-part-kmrt')
    })

    it('confirming removes exactly that participant with the unchanged audit actor and reason', () => {
      const remove = removeCalls()
      renderRunning(remove.fn)
      click('[data-testid="participant-remove-part-kmrt"]')
      click('[data-testid="participant-remove-confirm-btn"]')
      expect(remove.calls).toEqual([['part-kmrt', 'Mission coordinator', 'Coordinator removed participant']])
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')).toBeNull()
    })

    it('links the question to the confirm group for screen readers', () => {
      renderRunning(removeCalls().fn)
      click('[data-testid="participant-remove-part-kmrt"]')
      const confirm = document.querySelector('[data-testid="participant-remove-confirmation"]')
      const questionId = confirm?.getAttribute('aria-describedby') ?? ''
      expect(document.getElementById(questionId)?.textContent).toContain('Stop tracking KMRT')
    })

    it('says the number is not known when the runtime cannot preview the removal', () => {
      renderRunning(removeCalls().fn)
      act(() => useParticipantStore.setState({ controller: {
        removeParticipant: removeCalls().fn,
        previewRemoval: () => null,
      } as Pick<ParticipantRuntimeController, 'removeParticipant' | 'previewRemoval'> as ParticipantRuntimeController }))
      click('[data-testid="participant-remove-part-kmrt"]')
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')?.textContent)
        .toContain('Stop tracking KMRT (number of people not known)?')
    })

    it('gives a group count as a minimum while tracking is offline', () => {
      renderRunning(removeCalls().fn)
      act(() => useTrackingStore.setState({ status: { ...useTrackingStore.getInitialState().status, mode: 'offline' } }))
      click('[data-testid="participant-remove-part-kmrt"]')
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')?.textContent)
        .toContain('Stop tracking KMRT (at least 3 people)?')
    })

    it('keeps focus on the row when Keep is pressed while a save disables Remove', () => {
      renderRunning(removeCalls().fn)
      click('[data-testid="participant-remove-part-kmrt"]')
      act(() => useParticipantStore.setState({ saving: true }))
      click('[data-testid="participant-remove-keep-btn"]')
      expect(document.activeElement?.getAttribute('data-participant-kind')).toBe('group')
    })

    it('closes the question when the panel holding it is hidden', () => {
      function Panel(props: { readonly shown: boolean }) {
        return React.createElement(SectionBodyOpenContext.Provider, { value: props.shown },
          React.createElement(MissionSectionDisclosure, {
            collapsible: true,
            foldLabel: "Change who's taking part",
            section: { summary: '1 group', attention: [] } satisfies MissionSectionSummary,
            testId: 'mission-participants-section',
            title: 'People on this mission',
            children: React.createElement(ParticipantControlsSection, { phase: 'active', part: 'admin', variant: 'simplified' }),
          }))
      }
      renderRunning(removeCalls().fn, React.createElement(Panel, { shown: true }))
      click('[data-testid="mission-participants-section-toggle"]')
      click('[data-testid="participant-remove-part-kmrt"]')
      act(() => root?.render(React.createElement(Panel, { shown: false })))
      act(() => root?.render(React.createElement(Panel, { shown: true })))
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')).toBeNull()
    })

    it('keeps keyboard focus in the list after confirming', () => {
      renderRunning(removeCalls().fn)
      click('[data-testid="participant-remove-part-kmrt"]')
      click('[data-testid="participant-remove-confirm-btn"]')
      act(() => useParticipantStore.setState({ participants: [deviceRow] }))
      expect(document.activeElement?.getAttribute('data-testid')).toBe('participant-active-list')
    })

    it('gives a group count as a minimum while the device list is not current', () => {
      renderRunning(removeCalls().fn)
      act(() => useTrackingStore.setState({ status: {
        ...useTrackingStore.getInitialState().status, mode: 'online', warningCodes: ['roster_unavailable'],
      } }))
      click('[data-testid="participant-remove-part-kmrt"]')
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')?.textContent)
        .toContain('Stop tracking KMRT (at least 3 people)?')
    })

    it('closes the question when a reload drops the row, so it does not come back armed', () => {
      renderRunning(removeCalls().fn)
      click('[data-testid="participant-remove-part-kmrt"]')
      act(() => useParticipantStore.setState({ participants: [deviceRow] }))
      act(() => useParticipantStore.setState({ participants: [groupRow, deviceRow] }))
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')).toBeNull()
    })

    it('closes the question when Change who\'s taking part is folded', () => {
      renderRunning(removeCalls().fn, React.createElement(MissionSectionDisclosure, {
        collapsible: true,
        foldLabel: "Change who's taking part",
        section: { summary: '1 group', attention: [] } satisfies MissionSectionSummary,
        testId: 'mission-participants-section',
        title: 'People on this mission',
        children: React.createElement(ParticipantControlsSection, { phase: 'active', part: 'admin', variant: 'simplified' }),
      }))
      click('[data-testid="mission-participants-section-toggle"]')
      click('[data-testid="participant-remove-part-kmrt"]')
      click('[data-testid="mission-participants-section-toggle"]')
      click('[data-testid="mission-participants-section-toggle"]')
      expect(document.querySelector('[data-testid="participant-remove-confirmation"]')).toBeNull()
      expect(document.querySelector('[data-testid="participant-remove-part-kmrt"]')).not.toBeNull()
    })
  })

  describe('release smoke reads the history lines the operator sees [DON-368]', () => {
    const base = {
      mission_id: 'mission-1', mission_team_id: null, provenance: 'explicit' as const,
      added_by: 'Mission coordinator', removed_at: null, removed_by: null,
    }
    const earlier = { effective_from: '2026-11-24T05:00:00.000Z', added_at: '2026-11-24T07:00:00.000Z' }
    const now = { effective_from: '2026-11-24T07:00:00.000Z', added_at: '2026-11-24T07:00:00.000Z' }
    const participants = [
      { ...base, ...earlier, id: 'loaded', kind: 'device', traccar_device_id: '1', backfill_completed: 1 },
      { ...base, ...earlier, id: 'loading', kind: 'device', traccar_device_id: '2', backfill_completed: 0 },
      { ...base, ...now, id: 'none', kind: 'device', traccar_device_id: '3', backfill_completed: 1 },
      { ...base, ...earlier, id: 'group-loading', kind: 'group', traccar_device_id: null, traccar_group_id: '9',
        team_name: 'Hill Team', backfill_member_count: 3, backfill_completed_count: 1, backfill_scope_unknown: false },
      { ...base, ...earlier, id: 'group-loaded', kind: 'group', traccar_device_id: null, traccar_group_id: '8',
        team_name: 'Lake Team', backfill_member_count: 2, backfill_completed_count: 2, backfill_scope_unknown: false },
    ]

    for (const variant of ['simplified', 'standard'] as const) {
      it(`classifies every ${variant} status line the smoke waits on`, () => {
        useParticipantStore.setState({ participants: participants as never })
        render(React.createElement(ParticipantControlsSection, variant === 'simplified'
          ? { phase: 'active', variant: 'simplified', part: 'admin' }
          : { phase: 'active' }))
        const statuses = [...document.querySelectorAll('[data-testid="participant-backfill-status"]')]
          .map((element) => element.textContent ?? '')
        expect(statuses).toHaveLength(5)
        const [loaded, loading, none, groupLoading, groupLoaded] = statuses
        expect([loaded, groupLoaded].every(historyLoaded)).toBe(true)
        expect([loading, groupLoading].every(historyStillLoading)).toBe(true)
        expect([loading, groupLoading].some(historyLoaded)).toBe(false)
        expect(noEarlierHistoryAsked(none)).toBe(true)
        expect(historyLoaded(none)).toBe(false)
        expect(statuses.filter(historySettled)).toEqual([loaded, none, groupLoaded])
      })
    }

    it('never reads a group that could not load as loaded', () => {
      expect(historyLoaded('Earlier positions: could not be loaded (see the warning above)')).toBe(false)
      expect(historySettled('Earlier positions: who was in this group earlier is unknown; check before finishing')).toBe(false)
    })
  })

  it('surfaces active-mission membership bookkeeping failures', () => {
    useParticipantStore.setState({
      rosterError: 'Group membership could not be recorded: disk busy',
    })

    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))

    expect(document.querySelector('[data-testid="participant-roster-error"]')?.textContent)
      .toContain('disk busy')
  })

  it('exposes bounded participant identity for packaged readiness checks', () => {
    useParticipantStore.setState({
      participants: [{
        id: 'participant-device-991',
        mission_id: 'mission-1',
        kind: 'device',
        traccar_device_id: '991',
        mission_team_id: null,
        traccar_group_id: null,
        team_name: null,
        provenance: 'explicit',
        effective_from: '2026-09-05T08:00:00.000Z',
        added_at: '2026-09-05T08:00:00.000Z',
        added_by: 'Mission coordinator',
        removed_at: null,
        removed_by: null,
      }],
    })

    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))

    const row = document.querySelector('[data-testid="participant-active-list"] > .sar-readout')
    expect(row?.getAttribute('data-participant-kind')).toBe('device')
    expect(row?.getAttribute('data-traccar-device-id')).toBe('991')
  })
})

function addButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="participant-add-btn"]')
  if (button === null) throw new Error('Add participant button is missing.')
  return button
}

function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`${selector} is missing.`)
  act(() => element.click())
}

function changeSelect(selector: string, value: string): void {
  const select = document.querySelector<HTMLSelectElement>(selector)
  if (select === null) throw new Error(`${selector} is missing.`)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function render(element: React.ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
}
