export type LiveRecord = { key: string; signature: string }
export type ClassifiedLiveRecord = LiveRecord & { state: 'added' | 'changed' | 'unchanged' }
export type Page<T, Cursor = string> = { items: T[]; nextCursor?: Cursor }
export type RefreshOperation<T> = () => T | Promise<T>

export interface SessionSnapshotStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

export const availableSessionSnapshotStorage = (getStorage: () => SessionSnapshotStorage): SessionSnapshotStorage | undefined => {
	try {
		return getStorage()
	} catch (error) {
		void error
		return undefined
	}
}

export const createSessionSnapshotCache = <T>(storage: SessionSnapshotStorage | undefined, key: string, decode: (value: unknown) => T) => ({
	read: (): T | undefined => {
		if (storage === undefined) return undefined
		try {
			const serialized = storage.getItem(key)
			return serialized === null ? undefined : decode(JSON.parse(serialized))
		} catch (error) {
			void error
			try {
				storage.removeItem(key)
			} catch (removeError) {
				void removeError
			}
			return undefined
		}
	},
	write: (value: T): void => {
		if (storage === undefined) return
		try {
			const serialized = JSON.stringify(value)
			if (serialized !== undefined) storage.setItem(key, serialized)
		} catch (error) {
			void error
		}
	},
})

export const knownNetworkName = (chainId: string): string => {
	if (chainId === '1') return 'Ethereum Mainnet'
	if (chainId === '11155111') return 'Sepolia'
	return `Chain ${chainId}`
}

interface NetworkStatusPresentation {
	readonly chain_id?: unknown
	readonly name?: unknown
	readonly explorer_base_url?: unknown
	readonly start_block?: unknown
	readonly indexed_block?: unknown
	readonly indexed_hash?: unknown
	readonly indexed_timestamp?: unknown
	readonly observed_block?: unknown
	readonly phase?: unknown
	readonly consecutive_failures?: unknown
	readonly next_retry_at?: unknown
	readonly last_error?: unknown
}

export const networkStatusPresentationKey = (network: NetworkStatusPresentation): string =>
	JSON.stringify([
		network.chain_id,
		network.name,
		network.explorer_base_url,
		network.start_block,
		network.indexed_block,
		network.indexed_hash,
		network.indexed_timestamp,
		network.observed_block,
		network.phase,
		network.consecutive_failures,
		network.next_retry_at,
		network.last_error,
	])

export const canReuseNetworkStatusPresentation = (
	previous: NetworkStatusPresentation,
	current: NetworkStatusPresentation,
	renderedChainId: string | undefined,
	renderedFreshness: string | undefined,
	expectedChainId: string,
	expectedFreshness: 'current' | 'stale',
): boolean =>
	renderedChainId === expectedChainId &&
	renderedFreshness === expectedFreshness &&
	networkStatusPresentationKey(previous) === networkStatusPresentationKey(current)

export const refreshRouteAlongsideNetworkStatus = <T>(refreshNetworkStatus: RefreshOperation<unknown>, refreshRoute: RefreshOperation<T>): Promise<T> => {
	void Promise.resolve()
		.then(refreshNetworkStatus)
		.catch(() => undefined)
	return Promise.resolve(refreshRoute())
}

export const loadInitialNetworkStatus = async (restoredSnapshot: boolean, load: RefreshOperation<unknown>): Promise<void> => {
	if (!restoredSnapshot) await load()
}

export const operationsForkChildCount = (formattedCount: string, value: unknown): string => `${formattedCount} ${Number(value) === 1 ? 'child' : 'children'}`

export interface RefreshGate {
	runBackground<T>(operation: RefreshOperation<T>): Promise<T>
	runForeground<T>(operation: RefreshOperation<T>): Promise<T>
	reserve(): { ready: Promise<void>; release: () => void; completed: Promise<void> }
}

export interface NetworkFreshnessRecord {
	phase?: 'backfilling' | 'degraded' | 'live' | string
	start_block?: string | number | null
	indexed_block?: string | number | null
	observed_block?: string | number | null
	indexed_timestamp?: string | null
}

export interface IndexerProgressSample {
	indexedBlock: number
	sampledAt: number
	blocksPerSecond?: number
}

export interface ContractDeploymentRecord {
	deployment_block?: string | number | null
	deployment_checked_block?: string | number | null
	deployment_block_exact?: boolean | null
}

export interface TransactionDialogSnapshot {
	expandedKeys: string[]
	anchorKey?: string
	anchorTop?: number
	focusKey?: string
	focusIndex: number
	outsideFocus?: string
	scrollTop?: number
}

export type HistoryInvalidationReason = 'chain-reorg' | 'manifest-reset' | 'start-boundary-advanced' | 'abi-redecode' | 'projection-rebuild'

export const isHistoryInvalidationReason = (value: unknown): value is HistoryInvalidationReason =>
	value === 'chain-reorg' || value === 'manifest-reset' || value === 'start-boundary-advanced' || value === 'abi-redecode' || value === 'projection-rebuild'

export const historyInvalidationNotice = (reason: HistoryInvalidationReason, depth: string) => {
	const blocks = `${depth} indexed block${depth === '1' ? '' : 's'}`
	switch (reason) {
		case 'chain-reorg':
			return { title: 'Chain reorganization detected', detail: `${depth} block${depth === '1' ? '' : 's'} replaced; views are refreshing.` }
		case 'manifest-reset':
			return { title: 'Manifest history reset', detail: `${blocks} invalidated for manifest replay; views are refreshing.` }
		case 'start-boundary-advanced':
			return { title: 'History coverage reset', detail: `${blocks} invalidated after the retrievable history boundary advanced; views are refreshing.` }
		case 'abi-redecode':
			return { title: 'Historical ABI re-decode', detail: `${blocks} invalidated so historical evidence can be decoded again; views are refreshing.` }
		case 'projection-rebuild':
			return { title: 'Historical projection rebuild', detail: `${blocks} invalidated so historical views can be rebuilt; views are refreshing.` }
	}
}

export const classifyLiveRecords = (previous: ReadonlyMap<string, string>, current: readonly LiveRecord[]): ClassifiedLiveRecord[] =>
	current.map((record) => ({
		...record,
		state: previous.has(record.key) ? (previous.get(record.key) === record.signature ? 'unchanged' : 'changed') : 'added',
	}))

export const mergeUniqueRecords = <T>(primary: readonly T[], retained: readonly T[], keyFor: (record: T) => string): T[] => {
	const seen = new Set<string>()
	return [...primary, ...retained].filter((record) => {
		const key = keyFor(record)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export const operationsCatalogRecordKey = (
	section: 'auctions' | 'escalations' | 'forks' | 'integrity' | 'reports' | 'timeline' | 'trading',
	record: Readonly<Record<string, unknown>>,
): string => {
	if (section === 'reports') return `${String(record['open_oracle_address'] ?? '')}:${String(record['report_id'] ?? '')}`
	if (section === 'trading') return String(record['pair_address'] ?? '')
	if (section === 'integrity') return String(record['id'] ?? '')
	if (section === 'timeline')
		return `${String(record['block_hash'] ?? '')}:${String(record['tx_hash'] ?? '')}:${String(record['log_index'] ?? '')}:${String(record['entity_type'] ?? '')}:${String(record['entity_identity'] ?? '')}`
	if (section === 'forks') return String(record['universe_identity'] ?? '')
	return String(record[section === 'auctions' ? 'auction_address' : 'game_address'] ?? '')
}

export const operationsDetailRecordKey = (record: Readonly<Record<string, unknown>>): string =>
	`${String(record['block_hash'] ?? '')}:${String(record['tx_hash'] ?? '')}:${String(record['log_index'] ?? '')}:${String(record['event_name'] ?? record['semantic_event_kind'] ?? '')}`

export const timelineOccurrenceFields = (record: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [label: string, value: unknown]> => [
	['Block', record['block_number']],
	['Block hash', record['block_hash']],
	['Transaction hash', record['tx_hash']],
	['Log index', record['log_index']],
	['Entity type', record['entity_type']],
	['Entity identity', record['entity_identity']],
]

export const demoTimelineEvidenceStatus = (canonical: boolean, invalidationReason?: string): string => {
	if (canonical) return 'canonical'
	switch (invalidationReason) {
		case 'chain-reorg':
			return 'chain-orphaned'
		case 'manifest-reset':
			return 'manifest-superseded'
		case 'start-boundary-advanced':
			return 'coverage-reset'
		case 'abi-redecode':
			return 'decode-superseded'
		case 'projection-rebuild':
			return 'projection-superseded'
		default:
			return 'noncanonical-unknown'
	}
}

const enumValueLabel = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string' || value.trim() === '') return fallback
	const words = value.trim().split('-').filter(Boolean)
	const [first, ...rest] = words
	if (first === undefined) return fallback
	return [`${first.slice(0, 1).toUpperCase()}${first.slice(1)}`, ...rest].join(' ')
}

export const timelineEntityTypeLabel = (value: unknown): string => {
	switch (value) {
		case 'question':
			return 'Question'
		case 'deployment':
			return 'Deployment'
		case 'reputation-token':
			return 'Reputation token'
		case 'share-token':
			return 'Share token'
		case 'open-oracle-report':
			return 'OpenOracle report'
		case 'price-coordinator':
			return 'Price coordinator'
		case 'escalation':
			return 'Escalation game'
		case 'auction':
			return 'Truth auction'
		case 'pool':
			return 'Security pool'
		case 'vault':
			return 'Vault'
		case 'liquidation-approval':
			return 'Liquidation approval'
		case 'amm':
			return 'AMM market'
		case 'fork':
			return 'Universe fork'
		case 'reporter':
			return 'Reporter'
		default:
			return enumValueLabel(value, 'Entity')
	}
}

export const evidenceStatusLabel = (value: unknown): string => {
	switch (value) {
		case 'canonical':
			return 'Canonical evidence'
		case 'chain-orphaned':
			return 'Replaced-chain evidence'
		case 'manifest-superseded':
			return 'Superseded after manifest reset'
		case 'coverage-reset':
			return 'Outside current scanner coverage'
		case 'decode-superseded':
			return 'Superseded after ABI re-decode'
		case 'projection-superseded':
			return 'Superseded after projection rebuild'
		case 'noncanonical-unknown':
			return 'Noncanonical evidence'
		default:
			return enumValueLabel(value, 'Evidence status unavailable')
	}
}

export const historyInvalidationReasonLabel = (value: unknown): string => {
	switch (value) {
		case 'chain-reorg':
			return 'Chain reorganization'
		case 'manifest-reset':
			return 'Manifest reset'
		case 'start-boundary-advanced':
			return 'Scanner coverage boundary advanced'
		case 'abi-redecode':
			return 'ABI re-decode'
		case 'projection-rebuild':
			return 'Projection rebuild'
		default:
			return enumValueLabel(value, 'Invalidation reason unavailable')
	}
}

const invalidationOccurrenceLabels: Readonly<Record<string, string>> = {
	block: 'Affected blocks',
	transaction: 'Affected transactions',
	log: 'Affected logs',
	'entity-state': 'Affected state observations',
	'address-balance': 'Affected balance observations',
	'token-metadata': 'Affected token metadata observations',
}

export const historyInvalidationEvidencePresentation = (causes: unknown, occurrenceCounts: unknown) => {
	const causeCodes = Array.isArray(causes) ? causes.filter((cause): cause is string => typeof cause === 'string') : []
	const countsRecord = typeof occurrenceCounts === 'object' && occurrenceCounts !== null && !Array.isArray(occurrenceCounts) ? occurrenceCounts : {}
	const occurrenceFields: Array<readonly [label: string, value: string]> = []
	let occurrenceTotal = 0n
	for (const [kind, count] of Object.entries(countsRecord)) {
		if (typeof count !== 'string' || !/^\d+$/.test(count)) continue
		occurrenceTotal += BigInt(count)
		occurrenceFields.push([invalidationOccurrenceLabels[kind] ?? enumValueLabel(kind, 'Affected occurrences'), count])
	}
	occurrenceFields.sort(([left], [right]) => left.localeCompare(right))
	return {
		causeCodes,
		causeLabel: causeCodes.length === 0 ? 'Cause set not recorded' : causeCodes.map(historyInvalidationReasonLabel).join(' + '),
		occurrenceTotal: occurrenceTotal.toString(),
		occurrenceFields,
	}
}

const operationsInteger = (value: unknown): string => {
	const serialized = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : ''
	return /^-?\d+$/.test(serialized) ? BigInt(serialized).toLocaleString('en-US') : 'Unavailable'
}

export const operationsRouteFreshness = (asOf: Readonly<Record<string, unknown>>, liveConnected: boolean): string => {
	if (asOf['historical'] === true || asOf['phase'] === 'historical')
		return `Historical snapshot at block #${operationsInteger(asOf['blockNumber'])} · current indexed head #${operationsInteger(
			asOf['indexedHead'],
		)} · ${operationsInteger(asOf['historyDepthBlocks'])} blocks earlier · fixed point-in-time evidence`
	return `As of indexed block #${operationsInteger(asOf['blockNumber'])} · ${operationsInteger(asOf['lagBlocks'])} blocks behind · ${
		liveConnected ? 'live updates connected' : 'live updates reconnecting'
	}`
}

export const decodedActionLabel = (
	actionSummary: string | null,
	toAddress: string | null,
	contractLabel: string | null,
	emitterAddress?: string | null,
	deployedContractAddress?: string | null,
): string => {
	if (toAddress !== null) return actionSummary ?? 'No decoded calldata'
	const verifiedLabel =
		contractLabel && emitterAddress && deployedContractAddress && emitterAddress.toLowerCase() === deployedContractAddress.toLowerCase()
			? contractLabel
			: undefined
	return `Deploy ${verifiedLabel ?? 'contract'}`
}

export const urlWithoutLogDetail = (url: URL): URL => {
	const next = new URL(url)
	next.searchParams.delete('log')
	return next
}

type OperationsDetailKind = 'auction' | 'escalation' | 'fork' | 'pool' | 'report' | 'trading' | 'vault'

const operationsDetailCatalogPaths: Readonly<Record<OperationsDetailKind, string>> = {
	auction: '/operations/auctions',
	escalation: '/operations/escalations',
	fork: '/operations/forks',
	pool: '/operations/risk',
	report: '/operations/reports',
	trading: '/operations/trading',
	vault: '/operations/risk',
}

export const operationsDetailHeaderPresentation = (kind: OperationsDetailKind, asOf: Readonly<Record<string, unknown>>, liveConnected: boolean) => {
	const catalogPath = operationsDetailCatalogPaths[kind]
	return {
		backLabel: '← Back to catalog',
		catalogPath,
		freshness: operationsRouteFreshness(asOf, liveConnected),
		riskPanelTitle: asOf['historical'] === true || asOf['phase'] === 'historical' ? 'Risk state at snapshot' : 'Current risk state',
	}
}

const poolProtocolStateLabel = (value: unknown): string => {
	switch (String(value).toLowerCase()) {
		case '0':
			return 'Operational'
		case '1':
			return 'Pool forked'
		case '2':
			return 'Fork migration'
		case '3':
			return 'Fork truth auction'
		case 'bad-debt':
			return 'Bad debt'
		case 'unavailable':
			return 'Unavailable'
		default:
			return 'Unrecognized pool state'
	}
}

const vaultProtocolStateLabel = (value: unknown): string => {
	switch (String(value).toLowerCase()) {
		case 'healthy':
			return 'Healthy'
		case 'liquidatable':
			return 'Liquidatable'
		case 'bad-debt':
			return 'Bad debt'
		case 'unavailable':
			return 'Unavailable'
		default:
			return 'Unrecognized vault state'
	}
}

export const operationsRiskPresentation = (kind: 'pool' | 'vault', protocolState: unknown, scannerSeverity: unknown) => {
	const severity = String(scannerSeverity).toLowerCase()
	switch (severity) {
		case 'healthy':
			return {
				protocolState: kind === 'pool' ? poolProtocolStateLabel(protocolState) : vaultProtocolStateLabel(protocolState),
				scannerAssessment: 'Healthy',
				scannerTone: 'healthy',
			}
		case 'warning':
			return {
				protocolState: kind === 'pool' ? poolProtocolStateLabel(protocolState) : vaultProtocolStateLabel(protocolState),
				scannerAssessment: 'Warning',
				scannerTone: 'warning',
			}
		case 'critical':
			return {
				protocolState: kind === 'pool' ? poolProtocolStateLabel(protocolState) : vaultProtocolStateLabel(protocolState),
				scannerAssessment: 'Critical',
				scannerTone: 'critical',
			}
		case 'unavailable':
			return {
				protocolState: kind === 'pool' ? poolProtocolStateLabel(protocolState) : vaultProtocolStateLabel(protocolState),
				scannerAssessment: 'Unavailable',
				scannerTone: 'unavailable',
			}
		default:
			return {
				protocolState: kind === 'pool' ? poolProtocolStateLabel(protocolState) : vaultProtocolStateLabel(protocolState),
				scannerAssessment: 'Unrecognized assessment',
				scannerTone: 'unavailable',
			}
	}
}

export const operationsDetailSummaryPresentation = (
	kind: OperationsDetailKind,
	state: {
		readonly currentEvent?: unknown
		readonly lifecycleState?: unknown
		readonly protocolState?: unknown
		readonly scannerSeverity?: unknown
		readonly snapshotReadStatus?: unknown
	},
): { readonly label: string; readonly value: string } => {
	if (kind === 'pool' || kind === 'vault')
		return {
			label: 'Protocol state',
			value: operationsRiskPresentation(kind, state.protocolState, state.scannerSeverity).protocolState,
		}
	if (kind === 'report') {
		const value = state.lifecycleState ?? state.currentEvent
		return { label: 'Report lifecycle', value: value === undefined || value === null || value === '' ? 'Event-derived' : String(value) }
	}
	const readStatus = state.snapshotReadStatus
	return {
		label: 'Evidence state',
		value:
			readStatus === 'success'
				? 'Current tagged read available'
				: readStatus === undefined || readStatus === null || readStatus === ''
					? 'Event-derived'
					: `Tagged read ${String(readStatus)}`,
	}
}

export const operationsDetailEvidencePanelVisible = (kind: OperationsDetailKind, itemCount: number, hasMore: boolean, focusedContinuation: boolean): boolean =>
	kind === 'pool' || kind === 'vault' ? itemCount > 0 || hasMore || focusedContinuation : true

const approvalFieldDefinitions = [
	['maxCumulativeDebtAttoEth', 'maximum cumulative debt', 'attoETH'],
	['maxDebtPerLiquidationAttoEth', 'maximum debt per liquidation', 'attoETH'],
	['reservedDebtAttoEth', 'reserved debt', 'attoETH'],
	['consumedDebtAttoEth', 'consumed debt', 'attoETH'],
	['releasedDebtAttoEth', 'released debt', 'attoETH'],
	['resultingAvailableDebtAttoEth', 'resulting available debt', 'attoETH'],
	['resultingReservedDebtAttoEth', 'resulting reserved debt', 'attoETH'],
	['resultingConsumedDebtAttoEth', 'resulting consumed debt', 'attoETH'],
	['previousNonce', 'previous nonce', ''],
	['newNonce', 'new nonce', ''],
] as const

export const approvalTransitionFields = (
	data: Readonly<Record<string, unknown>>,
): Array<{ readonly label: string; readonly value: string; readonly unit: string }> =>
	approvalFieldDefinitions.flatMap(([key, label, unit]) => (typeof data[key] === 'string' ? [{ label, value: data[key], unit }] : []))

export const operationsLoadDisposition = (
	activeContext: string,
	requestedContext: string,
	live: boolean,
	hasPaginationTarget: boolean,
): 'join' | 'queue' | 'supersede' => {
	if (activeContext !== requestedContext) return 'supersede'
	return live || hasPaginationTarget ? 'queue' : 'join'
}

export type OperationsLoadState = { promise?: Promise<boolean>; context?: string }

export const runSerializedOperationsLoad = async (
	state: OperationsLoadState,
	requestedContext: string,
	live: boolean,
	hasPaginationTarget: boolean,
	currentContext: () => string,
	supersede: () => void,
	run: () => Promise<boolean>,
): Promise<boolean> => {
	while (state.promise !== undefined) {
		const active = state.promise
		const disposition = operationsLoadDisposition(state.context ?? '', requestedContext, live, hasPaginationTarget)
		if (disposition === 'supersede') {
			supersede()
			state.context = requestedContext
		}
		const activeResult = await active
		if (disposition === 'join') return activeResult
		if (currentContext() !== requestedContext) return false
	}
	const promise = run().finally(() => {
		if (state.promise === promise) {
			state.promise = undefined
			state.context = undefined
		}
	})
	state.promise = promise
	state.context = requestedContext
	return await promise
}

const canonicalEventPosition = (record: Readonly<Record<string, unknown>>, key: 'block_number' | 'transaction_index' | 'log_index'): bigint => {
	const value = record[key]
	return (typeof value === 'string' && /^\d+$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value)) ? BigInt(value) : 0n
}

export const compareCanonicalEventPosition = (left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): number => {
	const leftBlock = canonicalEventPosition(left, 'block_number')
	const rightBlock = canonicalEventPosition(right, 'block_number')
	if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1
	const leftTransaction = canonicalEventPosition(left, 'transaction_index')
	const rightTransaction = canonicalEventPosition(right, 'transaction_index')
	if (leftTransaction !== rightTransaction) return leftTransaction < rightTransaction ? -1 : 1
	const leftLog = canonicalEventPosition(left, 'log_index')
	const rightLog = canonicalEventPosition(right, 'log_index')
	return leftLog === rightLog ? 0 : leftLog < rightLog ? -1 : 1
}

export const canonicalPageLimit = (targetCount: number, loadedCount: number, pageSize: number): number =>
	targetCount > loadedCount ? Math.min(pageSize, targetCount - loadedCount) : pageSize

export const collectCanonicalPages = async <T, Cursor = string>(
	fetchPage: (cursor?: Cursor, limit?: number) => Promise<Page<T, Cursor>>,
	targetCount: number,
	keyFor: (record: T) => string,
): Promise<Page<T, Cursor>> => {
	let cursor: Cursor | undefined
	let items: T[] = []
	do {
		const remaining = targetCount > 0 ? canonicalPageLimit(targetCount, items.length, 100) : undefined
		const page = await fetchPage(cursor, remaining)
		items = mergeUniqueRecords(items, page.items, keyFor)
		cursor = page.nextCursor
	} while (cursor !== undefined && items.length < targetCount)
	return { items: targetCount > 0 ? items.slice(0, targetCount) : items, nextCursor: cursor }
}

export const collectCursorCollections = async <T>(
	fetchPage: (cursor?: string) => Promise<{
		readonly collections: Readonly<Record<string, readonly T[]>>
		readonly offset: number
		readonly nextCursor?: string
	}>,
	collectionKeys: readonly string[],
	throughOffset: number,
): Promise<{ readonly collections: Readonly<Record<string, readonly T[]>>; readonly loadedOffset: number; readonly nextCursor?: string }> => {
	const collections: Record<string, T[]> = {}
	for (const key of collectionKeys) collections[key] = []
	let cursor: string | undefined
	let priorOffset: number | undefined
	while (true) {
		const page = await fetchPage(cursor)
		if (!Number.isSafeInteger(page.offset) || page.offset < 0 || (priorOffset === undefined ? page.offset !== 0 : page.offset <= priorOffset))
			throw new Error('History continuation page offset did not advance')
		for (const key of collectionKeys) {
			const retained = collections[key]
			if (retained === undefined) throw new Error(`History collection ${key} was not initialized`)
			retained.push(...(page.collections[key] ?? []))
		}
		if (page.nextCursor === undefined || page.offset >= throughOffset)
			return { collections, loadedOffset: page.offset, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
		priorOffset = page.offset
		cursor = page.nextCursor
	}
}

export const collectDualCursorCollections = async <T, Cursor = string>(
	fetchPage: (options: { readonly leftCursor?: Cursor; readonly rightCursor?: Cursor; readonly limit: number }) => Promise<{
		readonly left: readonly T[]
		readonly right: readonly T[]
		readonly leftNextCursor?: Cursor
		readonly rightNextCursor?: Cursor
	}>,
	leftTargetCount: number,
	rightTargetCount: number,
	leftKeyFor: (record: T) => string,
	rightKeyFor: (record: T) => string,
): Promise<{ readonly left: readonly T[]; readonly right: readonly T[]; readonly leftNextCursor?: Cursor; readonly rightNextCursor?: Cursor }> => {
	let left: T[] = []
	let right: T[] = []
	let leftNextCursor: Cursor | undefined
	let rightNextCursor: Cursor | undefined
	let firstPage = true
	do {
		const requestLeft = firstPage || (left.length < leftTargetCount && leftNextCursor !== undefined)
		const requestRight = firstPage || (right.length < rightTargetCount && rightNextCursor !== undefined)
		if (!requestLeft && !requestRight) break
		const remaining = Math.max(requestLeft ? Math.max(leftTargetCount - left.length, 1) : 0, requestRight ? Math.max(rightTargetCount - right.length, 1) : 0)
		const page = await fetchPage({
			...(requestLeft && leftNextCursor !== undefined ? { leftCursor: leftNextCursor } : {}),
			...(requestRight && rightNextCursor !== undefined ? { rightCursor: rightNextCursor } : {}),
			limit: firstPage ? 100 : Math.min(100, remaining),
		})
		left = mergeUniqueRecords(left, page.left, leftKeyFor)
		right = mergeUniqueRecords(right, page.right, rightKeyFor)
		if (requestLeft) leftNextCursor = page.leftNextCursor
		if (requestRight) rightNextCursor = page.rightNextCursor
		firstPage = false
	} while (left.length < leftTargetCount || right.length < rightTargetCount)
	return {
		left,
		right,
		...(leftNextCursor === undefined ? {} : { leftNextCursor }),
		...(rightNextCursor === undefined ? {} : { rightNextCursor }),
	}
}

const historyBlockNumber = (value: unknown): bigint | undefined => {
	if (typeof value === 'bigint' && value >= 0n) return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
	if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
	return undefined
}

export const summarizeHistoryCollections = (
	collections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>,
	collectionKeys: readonly string[],
): { readonly counts: Readonly<Record<string, number>>; readonly oldestBlock?: bigint; readonly newestBlock?: bigint } => {
	const counts: Record<string, number> = {}
	let oldestBlock: bigint | undefined
	let newestBlock: bigint | undefined
	for (const key of collectionKeys) {
		const records = collections[key] ?? []
		counts[key] = records.length
		for (const record of records) {
			const blockNumber = historyBlockNumber(record['block_number'])
			if (blockNumber === undefined) continue
			if (oldestBlock === undefined || blockNumber < oldestBlock) oldestBlock = blockNumber
			if (newestBlock === undefined || blockNumber > newestBlock) newestBlock = blockNumber
		}
	}
	return { counts, ...(oldestBlock === undefined ? {} : { oldestBlock }), ...(newestBlock === undefined ? {} : { newestBlock }) }
}

export const reconcilePaginatedTotal = (currentTotal: number, responseTotal: number, append: boolean): number =>
	append ? Math.max(currentTotal, responseTotal) : responseTotal

export const paginatedSnapshotWasReplaced = (loadedCount: number, responseTotal: number): boolean => responseTotal < loadedCount

export const refreshPresentation = ({ live, append = false }: { live: boolean; append?: boolean }): { busy: boolean; loadingState: boolean } => {
	const visible = !live || append
	return { busy: visible, loadingState: visible }
}

export const resolveActivityRefreshDepth = (...depths: Array<number | undefined>): number | undefined => {
	const targetDepth = Math.max(0, ...depths.filter((depth): depth is number => depth !== undefined && Number.isInteger(depth) && depth > 0))
	return targetDepth > 0 ? targetDepth : undefined
}

export const activityRefreshRetention = (canonicalRefreshRequired: boolean, canonicalDepth: number | undefined, visibleDepth: number) => ({
	replaceDepth: resolveActivityRefreshDepth(canonicalRefreshRequired ? canonicalDepth : undefined, visibleDepth),
	retainVisibleDepth: true,
})

export const retainedPaginationAvailable = (hasContinuation: boolean, canonicalRefreshRequired: boolean): boolean =>
	hasContinuation && !canonicalRefreshRequired

export const paginationRequestAllowed = (append: boolean, canonicalRefreshRequired: boolean): boolean => !append || !canonicalRefreshRequired

export const queuedPaginationPresentation = (canonicalRefreshRequired: boolean) => ({
	hidden: canonicalRefreshRequired,
	disabled: true,
	busy: !canonicalRefreshRequired,
	label: canonicalRefreshRequired ? 'Show more' : 'Loading more…',
})

export const entityHistoryContinuationPresentation = (state: 'pending' | 'error') =>
	state === 'pending'
		? {
				buttonLabel: 'Showing older history…',
				statusText: 'Loading older historical records…',
				statusVisuallyHidden: true,
			}
		: {
				buttonLabel: 'Retry older history',
				statusText: 'Older historical records could not be loaded.',
				statusVisuallyHidden: false,
			}

export const transactionRetryMode = (appendFailure: boolean, hasLoadedTransactions: boolean) => ({
	append: appendFailure,
	liveRefresh: !appendFailure && hasLoadedTransactions,
})

export const accountStateDuringStagedRefresh = <T>(committedState: T, stagedState: T, stagedRefresh: boolean): T =>
	stagedRefresh ? committedState : stagedState

export const createForegroundRefreshGate = (): RefreshGate => {
	let active: Promise<unknown> | undefined
	const run = <T>(operation: RefreshOperation<T>): Promise<T> => {
		let request: Promise<T>
		if (active === undefined) {
			try {
				request = Promise.resolve(operation())
			} catch (error) {
				request = Promise.reject(error)
			}
		} else {
			request = active.then(
				() => operation(),
				() => operation(),
			)
		}
		active = request
		const clear = () => {
			if (active === request) active = undefined
		}
		void request.then(clear, clear)
		return request
	}
	const reserve = () => {
		let markReady: () => void = () => {
			throw new Error('Foreground reservation became ready before initialization')
		}
		let releaseOperation: () => void = () => {
			throw new Error('Foreground reservation released before initialization')
		}
		const ready = new Promise<void>((resolve) => {
			markReady = resolve
		})
		const completed = run(
			() =>
				new Promise<void>((resolve) => {
					releaseOperation = resolve
					markReady()
				}),
		)
		return { ready, release: () => releaseOperation(), completed }
	}
	return { runBackground: run, runForeground: run, reserve }
}

export const runWithForegroundReservation = async <T>(gate: RefreshGate, operation: RefreshOperation<T>): Promise<T> => {
	const reservation = gate.reserve()
	try {
		await reservation.ready
		return await operation()
	} finally {
		reservation.release()
		await reservation.completed
	}
}

export const isCurrentLiveRequest = (requestVersion: number, currentVersion: number, responseChainId: string | number, selectedChainId: string | number) =>
	requestVersion === currentVersion && String(responseChainId) === String(selectedChainId)

export const isCurrentContextRequest = (requestContext: number, currentContext: number, requestVersion: number, currentVersion: number) =>
	requestContext === currentContext && requestVersion === currentVersion

export const isCurrentCanonicalGeneration = (requestGeneration: number, currentGeneration: number): boolean => requestGeneration === currentGeneration

export const isNoncanonicalDetailFailure = (canonicalRecovery: boolean, status?: number): boolean => canonicalRecovery && status === 404

export const shouldClearPendingDetailState = (preservePendingOnClose: boolean): boolean => !preservePendingOnClose

export const shouldContinueTransactionRestore = (loaded: boolean, loadedCount: number, targetLoadedCount: number, nextPageCursor?: string) =>
	loaded && loadedCount < targetLoadedCount && nextPageCursor !== undefined

export const indexerConnectionStatus = (
	network: NetworkFreshnessRecord | undefined,
	streamState: 'open' | 'closed' | 'connecting',
	networkRequestFailed: boolean,
	streamHasOpened = false,
) => {
	if (networkRequestFailed) return { label: 'Status unavailable', tone: 'error' }
	const waitingForStart = indexerWaitingForStart(network)
	if (streamHasOpened && streamState !== 'open') {
		if (network?.phase === 'degraded') return { label: 'Indexer retrying · Reconnecting', tone: 'error' }
		if (waitingForStart && network !== undefined) return { label: `Waiting for #${network.start_block} · Reconnecting`, tone: 'error' }
		if (network?.indexed_block === null) return { label: 'Indexer starting · Reconnecting', tone: 'error' }
		if (network?.phase === 'backfilling') return { label: `Backfill #${network.indexed_block} · Reconnecting`, tone: 'error' }
		return { label: 'Reconnecting', tone: 'error' }
	}
	if (network?.phase === 'degraded') return { label: 'Indexer retrying', tone: 'error' }
	if (waitingForStart && network !== undefined) return { label: `Waiting for start block #${network.start_block}`, tone: 'pending' }
	if (network?.indexed_block === null) return { label: 'Indexer starting', tone: 'pending' }
	if (network?.phase === 'backfilling') return { label: `Backfilling #${network.indexed_block}`, tone: 'pending' }
	if (streamState === 'open') return { label: 'Live connection', tone: 'live' }
	if (network !== undefined) return { label: 'Reconnecting', tone: 'error' }
	return { label: 'Connecting', tone: 'pending' }
}

const decimalBlock = (value: string | number | bigint | null | undefined): bigint | undefined => {
	const text = String(value)
	return /^\d+$/.test(text) ? BigInt(text) : undefined
}

export const indexerWaitingForStart = (network: NetworkFreshnessRecord | undefined): boolean => {
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

export const compactIndexerDuration = (seconds: number): string => {
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

export const indexerProgressEstimate = (
	network: NetworkFreshnessRecord,
	previousSample: IndexerProgressSample | undefined = undefined,
	sampledAt = Date.now(),
) => {
	if (network.start_block === null || network.start_block === undefined || network.observed_block === null || network.observed_block === undefined)
		return { percentage: undefined, eta: 'Estimating ETA' }
	const startBlock = Number(network.start_block)
	const observedBlock = Number(network.observed_block)
	const indexedBlock = network.indexed_block === null || network.indexed_block === undefined ? startBlock - 1 : Number(network.indexed_block)
	if (![startBlock, indexedBlock, observedBlock].every(Number.isSafeInteger)) return { percentage: undefined, eta: 'Estimating ETA' }
	const exactStartBlock = decimalBlock(network.start_block)
	const exactObservedBlock = decimalBlock(network.observed_block)
	const exactIndexedBlock =
		network.indexed_block === null || network.indexed_block === undefined
			? exactStartBlock === undefined
				? undefined
				: exactStartBlock - 1n
			: decimalBlock(network.indexed_block)
	if (exactStartBlock === undefined || exactObservedBlock === undefined || exactIndexedBlock === undefined)
		return { percentage: undefined, eta: 'Estimating ETA' }
	if (exactObservedBlock < exactStartBlock) return { percentage: '100.00', eta: 'Caught up' }
	const boundedHead = observedBlock
	const boundedIndexed = Math.min(boundedHead, Math.max(startBlock - 1, indexedBlock))
	const completedBlocks = boundedIndexed - startBlock + 1
	const totalBlocks = boundedHead - startBlock + 1
	const remainingBlocks = totalBlocks - completedBlocks
	const exactBoundedIndexed =
		exactIndexedBlock > exactObservedBlock ? exactObservedBlock : exactIndexedBlock < exactStartBlock ? exactStartBlock - 1n : exactIndexedBlock
	const exactCompletedBlocks = exactBoundedIndexed - exactStartBlock + 1n
	const exactTotalBlocks = exactObservedBlock - exactStartBlock + 1n
	const roundedHundredths = (exactCompletedBlocks * 10_000n + exactTotalBlocks / 2n) / exactTotalBlocks
	const hundredths = remainingBlocks > 0 && roundedHundredths >= 10_000n ? 9_999n : roundedHundredths
	const percentage = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`
	if (remainingBlocks === 0) return { percentage: '100.00', eta: indexerHeadFreshness(network, sampledAt).stale ? 'RPC head stale' : 'Caught up' }
	let blocksPerSecond = previousSample?.blocksPerSecond
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
					blocksPerSecond: boundedIndexed < (previousSample?.indexedBlock ?? boundedIndexed) ? undefined : blocksPerSecond,
				}
	return {
		percentage,
		eta: blocksPerSecond === undefined ? 'Estimating ETA' : `ETA ${compactIndexerDuration(remainingBlocks / blocksPerSecond)}`,
		sample,
	}
}

export const contractDeploymentStatus = (contract: ContractDeploymentRecord) => {
	if (contract.deployment_block !== null && contract.deployment_block !== undefined)
		return contract.deployment_block_exact === false
			? { label: `Deployed at or before #${contract.deployment_block}`, tone: 'live' }
			: { label: 'Deployed', tone: 'live' }
	if (contract.deployment_checked_block !== null && contract.deployment_checked_block !== undefined)
		return { label: `No code at #${contract.deployment_checked_block}`, tone: 'error' }
	return { label: 'Checking deployment', tone: 'pending' }
}

export type ContractRegistrySection = 'Protocol contracts' | 'System dependencies' | 'Discovered contracts'

const dependencyContractKinds = new Set([
	'multicall3',
	'proxyDeployer',
	'reputationToken',
	'scalarOutcomes',
	'uniswapV2Factory',
	'uniswapV3Factory',
	'uniswapV4PoolManager',
	'usdc',
	'weth',
])

export const contractRegistrySection = (contract: { readonly kind: string; readonly provenance: string }): ContractRegistrySection => {
	if (contract.provenance !== 'manifest') return 'Discovered contracts'
	return dependencyContractKinds.has(contract.kind) ? 'System dependencies' : 'Protocol contracts'
}

export const contractDeploymentTimestampLabel = (contract: ContractDeploymentRecord): string =>
	contract.deployment_block_exact === false ? 'Deployed at or before' : 'Deployed at'

export const contractDeploymentBlockActionLabel = (contract: ContractDeploymentRecord): string =>
	contract.deployment_block_exact === false ? 'Open search boundary block ↗' : 'Open deployment block ↗'

export const reconcileTransactionDialogSnapshot = (snapshot: TransactionDialogSnapshot, availableKeys: ReadonlySet<string>): TransactionDialogSnapshot => ({
	...snapshot,
	expandedKeys: snapshot.expandedKeys.filter((key) => key !== undefined && availableKeys.has(key)),
	anchorKey: snapshot.anchorKey !== undefined && availableKeys.has(snapshot.anchorKey) ? snapshot.anchorKey : undefined,
	focusKey: snapshot.focusKey !== undefined && availableKeys.has(snapshot.focusKey) ? snapshot.focusKey : undefined,
	focusIndex: snapshot.focusKey !== undefined && availableKeys.has(snapshot.focusKey) ? snapshot.focusIndex : -1,
})

export const createLatestRefreshCoordinator = <T>(refresh: (count: number, force: boolean) => Promise<T>) => {
	let inFlight: Promise<T> | undefined
	let pendingCount = 0
	let pendingForce = false
	return (count = 1, force = false) => {
		pendingCount += count
		pendingForce ||= force
		if (inFlight !== undefined) return inFlight
		inFlight = (async () => {
			let result: { value: T } | undefined
			let failure: unknown
			let failed = false
			do {
				const nextCount = pendingCount
				const nextForce = pendingForce
				pendingCount = 0
				pendingForce = false
				try {
					result = { value: await refresh(nextCount, nextForce) }
					failure = undefined
					failed = false
				} catch (error) {
					failure = error
					failed = true
				}
			} while (pendingCount > 0)
			if (failed) throw failure
			if (result === undefined) throw new Error('Refresh coordinator completed without running a refresh')
			return result.value
		})().finally(() => {
			inFlight = undefined
		})
		return inFlight
	}
}

export const createLiveRouteRefreshCoordinator = <T, R>(refresh: (count: number, force: boolean, recovery: R) => Promise<T>, currentRecovery: () => R) =>
	createLatestRefreshCoordinator((count, force) => refresh(count, force, currentRecovery()))
