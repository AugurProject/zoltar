import type { PublicOperatorSnapshot } from '#state/operator-state'

export type NetworkProfile = 'mainnet' | 'sepolia'

/** The dashboard page's mutable data and request latches; every view and controller reads and writes this one record. */
export type DashboardState = {
	latestSnapshot: PublicOperatorSnapshot | undefined
	connected: boolean
	settingsLoaded: boolean
	submissionLoaded: boolean
	connectivityLoaded: boolean
	connectivityRequestPending: boolean
	deploymentLoaded: boolean
	tokensLoaded: boolean
	focusedRuntimeLoaded: boolean
	configurationLoaded: boolean
	configurationLoading: boolean
	configurationLoadError: string | undefined
	configuredScanIntervalMilliseconds: number | undefined
	persistedNetwork: NetworkProfile | undefined
	pendingNetworkProfile: NetworkProfile | undefined
	pendingProfileStateConfirmed: boolean
	profileSwitchTimedOut: boolean
	/** Incremented whenever a profile switch starts or is abandoned, so responses to older requests are ignored. */
	profileRequestEpoch: number
	initialFragmentApplied: boolean
	approvedUniverseIds: Set<string>
	universeSavePending: boolean
	signerFeedback: { error: boolean; message: string } | undefined
	signerRequestPending: boolean
	pauseRequestPending: 'pause' | 'resume' | undefined
	/**
	 * The last rejected pause or resume request stays on the overview notice across polls until the operator retries or a poll shows the
	 * requested run state applied after all. A recovery refusal additionally retires itself once a poll has shown the recovery pending and
	 * a later poll shows it cleared, whichever client reconciled it.
	 */
	pauseFailure: { message: string; recoverySeen: boolean; requestedPaused: boolean } | undefined
}

export function createDashboardState(): DashboardState {
	return {
		latestSnapshot: undefined,
		connected: false,
		settingsLoaded: false,
		submissionLoaded: false,
		connectivityLoaded: false,
		connectivityRequestPending: false,
		deploymentLoaded: false,
		tokensLoaded: false,
		focusedRuntimeLoaded: false,
		configurationLoaded: false,
		configurationLoading: false,
		configurationLoadError: undefined,
		configuredScanIntervalMilliseconds: undefined,
		persistedNetwork: undefined,
		pendingNetworkProfile: undefined,
		pendingProfileStateConfirmed: false,
		profileSwitchTimedOut: false,
		profileRequestEpoch: 0,
		initialFragmentApplied: false,
		approvedUniverseIds: new Set<string>(),
		universeSavePending: false,
		signerFeedback: undefined,
		signerRequestPending: false,
		pauseRequestPending: undefined,
		pauseFailure: undefined,
	}
}
