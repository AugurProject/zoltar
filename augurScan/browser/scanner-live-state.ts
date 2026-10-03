export interface ScannerLiveState {
	pendingBlockUpdates: number
	blockRefreshTimer: number | undefined
	streamHasOpened: boolean
	stream: EventSource | undefined
	streamReconnectTimer: number | undefined
	streamReconnectAttempts: number
	lastStreamRefreshAt: number | undefined
	networkLoadPromise: Promise<boolean> | undefined
	networkFollowUpPromise: Promise<boolean> | undefined
	serverClockOffsetMs: number
	networkFreshnessThresholdMs: number
	lastNetworkRequestFailed: boolean
	awaitingResumedNetworkStatus: boolean
	networkResumeGeneration: number
	restoredCurrentNetworkSnapshot: boolean
	lastTimeTickAt: number
}

export const createScannerLiveState = (): ScannerLiveState => ({
	pendingBlockUpdates: 0,
	blockRefreshTimer: undefined,
	streamHasOpened: false,
	stream: undefined,
	streamReconnectTimer: undefined,
	streamReconnectAttempts: 0,
	lastStreamRefreshAt: undefined,
	networkLoadPromise: undefined,
	networkFollowUpPromise: undefined,
	serverClockOffsetMs: 0,
	networkFreshnessThresholdMs: 48_000,
	lastNetworkRequestFailed: false,
	awaitingResumedNetworkStatus: false,
	networkResumeGeneration: 0,
	restoredCurrentNetworkSnapshot: false,
	lastTimeTickAt: Date.now(),
})
