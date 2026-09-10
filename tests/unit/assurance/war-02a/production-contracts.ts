export type Scope = { mission_id: string; scope_reason: string }
export type MissionStore = {
  close: () => void | Promise<void>
  createMission: (input: { name: string }) => Promise<{ id: string }>
  getActiveMission: () => Promise<{ id: string } | null>
  finishMission: (id: string) => Promise<unknown>
  syncBackup: () => Promise<string>
  listMissionEvents: (id: string) => Promise<{ event_type: string }[]>
  getIngestEvidenceHealth: (id: string) => Promise<{ state: string; reason: string | null }>
  listRendererEvidenceScopesAwaitingClosure: () => Promise<Scope[]>
  listMissionIdsAwaitingEvidenceClosure: () => Promise<string[]>
  stageRendererEvidenceIncident: (input: { incident_id: string; scopes: Scope[] }) => Promise<unknown>
  resolveRendererEvidenceIncidents: (input: { outcome: string }) => Promise<unknown>
  recordIngestEvidenceLoss: (input: { mission_id: string; reason: string }) => Promise<unknown>
}
export type MissionStoreModule = {
  createElectronMissionStore: (options: { userDataPath: string }) => Promise<MissionStore>
}
export type RendererCoordinatorModule = {
  createRendererTeardownCoordinator: (dependencies: {
    ipcMain: { on: (channel: string, listener: (event: unknown, input: unknown) => void) => void; removeListener: (channel: string, listener: (event: unknown, input: unknown) => void) => void }
    missionStore: Pick<MissionStore, 'listRendererEvidenceScopesAwaitingClosure' | 'listMissionIdsAwaitingEvidenceClosure' | 'stageRendererEvidenceIncident' | 'resolveRendererEvidenceIncidents' | 'recordIngestEvidenceLoss'>
    createRequestId: () => string
    setTimeout: (callback: () => void, delay: number) => unknown
    clearTimeout: (id: unknown) => void
    timeoutMs: number
  }) => {
    prepare: (window: unknown, reason: string) => Promise<unknown>
    markRendererUnavailable: () => Promise<unknown>
    markRendererAvailable: () => Promise<unknown>
    dispose: () => void
  }
}
