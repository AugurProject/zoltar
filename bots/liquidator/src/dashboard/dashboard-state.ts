import type { Configuration, MarketSourceRow, Snapshot } from './api-validation.ts'

type NetworkProfile = 'mainnet' | 'sepolia'

/** The dashboard page's mutable data and request latches; every view and controller reads and writes this one record. */
export type DashboardState = {
	snapshot: Snapshot | undefined
	configuration: Configuration | undefined
	stateConnected: boolean
	configurationConnected: boolean
	pendingNetworkProfile: NetworkProfile | undefined
	pendingProfileStateConfirmed: boolean
	/** Incremented whenever a profile switch starts or is abandoned, so responses to older requests are ignored. */
	profileRequestEpoch: number
	approvedUniverses: Set<string>
	/** Lower-cased addresses of the pools the operator selected. */
	selectedPools: Set<string>
	pendingPoolMutations: number
	/** The last reconciliation outcome per lower-cased intent hash, kept across recovery re-renders. */
	recoveryActionStates: Map<string, { failed: boolean; message: string }>
	/** Rows from the latest market-source probe; while set they replace the configured source admission. */
	marketSourceProbeRows: MarketSourceRow[] | undefined
	initialFragmentApplied: boolean
	/** `true` while a pause request is pending and `false` while a resume request is pending. */
	pauseRequestPending: boolean | undefined
	/** A market-source probe is in flight; its button stays locked across polls until it settles. */
	marketSourceProbePending: boolean
	/** The operator-file revision the last rendered snapshot reported; a change reloads the configuration in the background. */
	configurationRevision: string | undefined
	/** A profile switch outlived its reconnect wait while the bot could not be asked which profile it runs. */
	profileSwitchStalled: boolean
}

export function createDashboardState(): DashboardState {
	return {
		snapshot: undefined,
		configuration: undefined,
		stateConnected: false,
		configurationConnected: false,
		pendingNetworkProfile: undefined,
		pendingProfileStateConfirmed: false,
		profileRequestEpoch: 0,
		approvedUniverses: new Set<string>(),
		selectedPools: new Set<string>(),
		pendingPoolMutations: 0,
		recoveryActionStates: new Map(),
		marketSourceProbeRows: undefined,
		initialFragmentApplied: false,
		pauseRequestPending: undefined,
		marketSourceProbePending: false,
		configurationRevision: undefined,
		profileSwitchStalled: false,
	}
}
