import type { RefreshOperation } from './live-refresh.ts'

export const knownNetworkName = (chainId: string): string => {
	if (chainId === '1') return 'Ethereum Mainnet'
	if (chainId === '11155111') return 'Sepolia'
	return `Chain ${chainId}`
}

/** Explains that a linked network is not indexed here and names the network shown instead. */
export const unavailableNetworkNotice = (requestedChainId: string, shownNetworkName: string): string => `Chain ${requestedChainId} is not indexed by this scanner. Showing ${shownNetworkName} instead.`

/** Native currency symbol shown for a chain; only Ethereum mainnet is labelled plain ETH. */
export const nativeSymbolFor = (chainId: string | number): string => (String(chainId) === '1' ? 'ETH' : 'SepoliaETH')

interface NetworkStatusPresentation {
	readonly chain_id?: string
	readonly name?: string
	readonly explorer_base_url?: string
	readonly start_block?: string
	readonly indexed_block?: string | null
	readonly indexed_hash?: string | null
	readonly indexed_timestamp?: string | null
	readonly observed_block?: string | null
	readonly phase?: string
	readonly consecutive_failures?: number
	readonly next_retry_at?: string | null
	readonly last_error?: string | null
}

const networkStatusPresentationKey = (network: NetworkStatusPresentation): string =>
	JSON.stringify([network.chain_id, network.name, network.explorer_base_url, network.start_block, network.indexed_block, network.indexed_hash, network.indexed_timestamp, network.observed_block, network.phase, network.consecutive_failures, network.next_retry_at, network.last_error])

export const canReuseNetworkStatusPresentation = (previous: NetworkStatusPresentation, current: NetworkStatusPresentation, renderedChainId: string | undefined, renderedFreshness: string | undefined, expectedChainId: string, expectedFreshness: 'current' | 'stale'): boolean =>
	renderedChainId === expectedChainId && renderedFreshness === expectedFreshness && networkStatusPresentationKey(previous) === networkStatusPresentationKey(current)

export const refreshRouteAlongsideNetworkStatus = <T>(refreshNetworkStatus: RefreshOperation<unknown>, refreshRoute: RefreshOperation<T>): Promise<T> => {
	void Promise.resolve()
		.then(refreshNetworkStatus)
		.catch(() => undefined)
	return Promise.resolve(refreshRoute())
}

const restoredNetworkSnapshotMaxAgeMs = 30_000

export const restoredNetworkSnapshotIsCurrent = (writtenAt: number | undefined, now = Date.now()): boolean => {
	if (writtenAt === undefined || !Number.isFinite(writtenAt)) return false
	const ageMs = now - writtenAt
	return ageMs >= 0 && ageMs <= restoredNetworkSnapshotMaxAgeMs
}

export const loadInitialNetworkStatus = async (restoredSnapshot: boolean, load: RefreshOperation<unknown>): Promise<void> => {
	if (!restoredSnapshot) await load()
}

export interface NetworkFreshnessRecord {
	phase?: 'backfilling' | 'degraded' | 'live' | string
	start_block?: string | number | null
	indexed_block?: string | number | null
	observed_block?: string | number | null
	indexed_timestamp?: string | null | undefined
}

export interface IndexerProgressSample {
	indexedBlock: number
	sampledAt: number
	blocksPerSecond?: number | undefined
}

export const indexerConnectionStatus = (network: NetworkFreshnessRecord | undefined, streamState: 'open' | 'closed' | 'connecting', networkRequestFailed: boolean, streamHasOpened = false) => {
	if (networkRequestFailed) return { label: 'Status unavailable', tone: 'error' }
	const waitingForStart = indexerWaitingForStart(network)
	if (streamHasOpened && streamState !== 'open') {
		if (network?.phase === 'degraded') return { label: 'Indexer retrying · Reconnecting', tone: 'error' }
		if (waitingForStart && network !== undefined) return { label: `Waiting for #${network.start_block} · Reconnecting`, tone: 'error' }
		if (network?.indexed_block === null) return { label: 'Indexer starting · Reconnecting', tone: 'error' }
		if (network?.phase === 'backfilling') return { label: 'Backfilling · Reconnecting', tone: 'error' }
		return { label: 'Reconnecting', tone: 'error' }
	}
	if (network?.phase === 'degraded') return { label: 'Indexer retrying', tone: 'error' }
	if (waitingForStart && network !== undefined) return { label: `Waiting for start block #${network.start_block}`, tone: 'pending' }
	if (network?.indexed_block === null) return { label: 'Indexer starting', tone: 'pending' }
	if (network?.phase === 'backfilling') return { label: 'Backfilling', tone: 'pending' }
	if (streamState === 'open') return { label: 'Live connection', tone: 'live' }
	if (network !== undefined) return { label: 'Reconnecting', tone: 'error' }
	return { label: 'Connecting', tone: 'pending' }
}

const decimalBlock = (value: string | number | bigint | null | undefined): bigint | undefined => {
	const text = String(value)
	return /^\d+$/.test(text) ? BigInt(text) : undefined
}

const indexerWaitingForStart = (network: NetworkFreshnessRecord | undefined): boolean => {
	if (network === undefined || (network.indexed_block !== null && network.indexed_block !== undefined)) return false
	const startBlock = decimalBlock(network.start_block)
	const observedBlock = decimalBlock(network.observed_block)
	return startBlock !== undefined && observedBlock !== undefined && observedBlock < startBlock
}

const chainHeadFreshnessThresholdMs = 60_000

export const indexerHeadFreshness = (network: NetworkFreshnessRecord | undefined, now = Date.now()): { stale: boolean; ageMs?: number } => {
	if (network?.phase !== 'live') return { stale: false }
	const indexedBlock = decimalBlock(network?.indexed_block)
	const observedBlock = decimalBlock(network?.observed_block)
	if (indexedBlock === undefined || observedBlock === undefined || indexedBlock !== observedBlock || !network.indexed_timestamp) return { stale: false }
	const timestamp = new Date(network.indexed_timestamp).getTime()
	if (!Number.isFinite(timestamp)) return { stale: false }
	const ageMs = Math.max(0, now - timestamp)
	return ageMs > chainHeadFreshnessThresholdMs ? { stale: true, ageMs } : { stale: false }
}

export const indexerHeadFreshnessTransitionDelay = (network: NetworkFreshnessRecord | undefined, now = Date.now()): number | undefined => {
	if (network?.phase !== 'live') return undefined
	const indexedBlock = decimalBlock(network?.indexed_block)
	const observedBlock = decimalBlock(network?.observed_block)
	if (indexedBlock === undefined || observedBlock === undefined || indexedBlock !== observedBlock || !network.indexed_timestamp) return undefined
	const timestamp = new Date(network.indexed_timestamp).getTime()
	if (!Number.isFinite(timestamp)) return undefined
	const delayMs = timestamp + chainHeadFreshnessThresholdMs + 1 - now
	return delayMs > 0 ? delayMs : undefined
}

export const indexerLagLabel = (network: NetworkFreshnessRecord): string => {
	const observedBlock = decimalBlock(network.observed_block)
	if (observedBlock === undefined) return 'head unknown'
	if (indexerWaitingForStart(network)) return `head #${network.observed_block} · starts at #${network.start_block}`
	const indexedBlock = decimalBlock(network.indexed_block)
	if (indexedBlock === undefined) return `head #${network.observed_block} · awaiting first indexed block`
	const lag = observedBlock > indexedBlock ? observedBlock - indexedBlock : 0n
	return `${lag.toLocaleString('en-US')} ${lag === 1n ? 'block' : 'blocks'} behind`
}

export const showIndexerSyncDetails = (network: NetworkFreshnessRecord, sampledAt = Date.now()): boolean => {
	if (network.phase !== 'live' || indexerWaitingForStart(network) || indexerHeadFreshness(network, sampledAt).stale) return true
	const observedBlock = decimalBlock(network.observed_block)
	const indexedBlock = decimalBlock(network.indexed_block)
	return observedBlock === undefined || indexedBlock === undefined || indexedBlock < observedBlock
}

const compactIndexerDuration = (seconds: number): string => {
	const rounded = Math.max(1, Math.ceil(seconds))
	if (rounded < 60) return `${rounded}s`
	if (rounded < 3_600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`
	const totalHours = Math.ceil(rounded / 3_600)
	if (totalHours < 24) {
		const totalMinutes = Math.ceil(rounded / 60)
		const minutes = totalMinutes % 60
		return `${Math.floor(totalMinutes / 60)}h${minutes === 0 ? '' : ` ${minutes}m`}`
	}
	const hours = totalHours % 24
	return `${Math.floor(totalHours / 24)}d${hours === 0 ? '' : ` ${hours}h`}`
}

/** Age of the indexed block relative to the server clock, distinct from catch-up ETA. */
export const indexerTimeLagLabel = (network: NetworkFreshnessRecord, now: number): string | undefined => {
	if (!network.indexed_timestamp) return undefined
	const timestamp = new Date(network.indexed_timestamp).getTime()
	if (!Number.isFinite(timestamp)) return undefined
	const seconds = Math.max(0, (now - timestamp) / 1_000)
	return `${seconds === 0 ? '0s' : compactIndexerDuration(seconds)} behind`
}

const exactIndexedBlockFor = (indexedBlock: string | number | bigint | null | undefined, exactStartBlock: bigint | undefined) => {
	if (indexedBlock !== null && indexedBlock !== undefined) return decimalBlock(indexedBlock)
	return exactStartBlock === undefined ? undefined : exactStartBlock - 1n
}

const clampBigint = (value: bigint, minimum: bigint, maximum: bigint) => {
	if (value > maximum) return maximum
	return value < minimum ? minimum : value
}

export const indexerProgressEstimate = (network: NetworkFreshnessRecord, previousSample: IndexerProgressSample | undefined = undefined, sampledAt = Date.now()) => {
	if (network.start_block === null || network.start_block === undefined || network.observed_block === null || network.observed_block === undefined) return { percentage: undefined, eta: 'Estimating ETA' }
	const startBlock = Number(network.start_block)
	const observedBlock = Number(network.observed_block)
	const indexedBlock = network.indexed_block === null || network.indexed_block === undefined ? startBlock - 1 : Number(network.indexed_block)
	if (![startBlock, indexedBlock, observedBlock].every(Number.isSafeInteger)) return { percentage: undefined, eta: 'Estimating ETA' }
	const exactStartBlock = decimalBlock(network.start_block)
	const exactObservedBlock = decimalBlock(network.observed_block)
	const exactIndexedBlock = exactIndexedBlockFor(network.indexed_block, exactStartBlock)
	if (exactStartBlock === undefined || exactObservedBlock === undefined || exactIndexedBlock === undefined) return { percentage: undefined, eta: 'Estimating ETA' }
	if (exactObservedBlock < exactStartBlock) return { percentage: '100.00', eta: 'Caught up' }
	const boundedHead = observedBlock
	const boundedIndexed = Math.min(boundedHead, Math.max(startBlock - 1, indexedBlock))
	const completedBlocks = boundedIndexed - startBlock + 1
	const totalBlocks = boundedHead - startBlock + 1
	const remainingBlocks = totalBlocks - completedBlocks
	const exactBoundedIndexed = clampBigint(exactIndexedBlock, exactStartBlock - 1n, exactObservedBlock)
	const exactCompletedBlocks = exactBoundedIndexed - exactStartBlock + 1n
	const exactTotalBlocks = exactObservedBlock - exactStartBlock + 1n
	const roundedHundredths = (exactCompletedBlocks * 10_000n + exactTotalBlocks / 2n) / exactTotalBlocks
	const hundredths = remainingBlocks > 0 && roundedHundredths >= 10_000n ? 9_999n : roundedHundredths
	const percentage = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`
	if (remainingBlocks === 0) return { percentage: '100.00', eta: indexerHeadFreshness(network, sampledAt).stale ? 'RPC head stale' : 'Caught up' }
	let blocksPerSecond = previousSample !== undefined && boundedIndexed >= previousSample.indexedBlock ? previousSample.blocksPerSecond : undefined
	if (previousSample !== undefined && boundedIndexed > previousSample.indexedBlock && sampledAt - previousSample.sampledAt >= 1_000) {
		const observedRate = (boundedIndexed - previousSample.indexedBlock) / ((sampledAt - previousSample.sampledAt) / 1_000)
		blocksPerSecond = blocksPerSecond === undefined ? observedRate : blocksPerSecond * 0.7 + observedRate * 0.3
	}
	const sample =
		previousSample !== undefined && boundedIndexed === previousSample.indexedBlock
			? previousSample
			: {
					indexedBlock: boundedIndexed,
					sampledAt,
					blocksPerSecond,
				}
	return {
		percentage,
		eta: blocksPerSecond === undefined ? 'Estimating ETA' : `ETA ${compactIndexerDuration(remainingBlocks / blocksPerSecond)}`,
		sample,
	}
}
