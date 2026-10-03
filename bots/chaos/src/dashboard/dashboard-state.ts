import type { Configuration, Snapshot } from './dashboard-data.ts'

/** The dashboard page's mutable data and mutation latches; every view and controller reads and writes this one record. */
export type DashboardState = {
	snapshot: Snapshot | undefined
	snapshotStale: boolean
	configuration: Configuration | undefined
	settingsRevision: string | number | undefined
	connectivityDraftDirty: boolean
	connectivityDraftConflict: boolean
	connectivityDraftRevision: string | number | undefined
	/** The saved connectivity values the RPC draft started from; see `configuration-draft-scope.ts`. */
	connectivityDraftScope: string | undefined
	/** The saved policy values the execution policy draft started from. */
	settingsDraftScope: string | undefined
	pauseMutationPending: boolean
	pauseMutationUnreconciled: boolean
	settingsMutationUnreconciled: boolean
	connectivityMutationUnreconciled: boolean
	signerMutationUnreconciled: boolean
	/** Once set, every mutation control stays frozen for the life of the page. */
	configurationCommitIndeterminate: boolean
	selectionControlsAvailable: boolean
}

export function createDashboardState(): DashboardState {
	return {
		snapshot: undefined,
		snapshotStale: false,
		configuration: undefined,
		settingsRevision: undefined,
		connectivityDraftDirty: false,
		connectivityDraftConflict: false,
		connectivityDraftRevision: undefined,
		connectivityDraftScope: undefined,
		settingsDraftScope: undefined,
		pauseMutationPending: false,
		pauseMutationUnreconciled: false,
		settingsMutationUnreconciled: false,
		connectivityMutationUnreconciled: false,
		signerMutationUnreconciled: false,
		configurationCommitIndeterminate: false,
		selectionControlsAvailable: false,
	}
}
