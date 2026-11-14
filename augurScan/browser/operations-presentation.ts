import { isRecord, type JsonRecord, type JsonValue } from './api-validation.ts'
import { exactUnit } from './format.ts'

export const operationsForkChildCount = (formattedCount: string, value: JsonValue | undefined): string => `${formattedCount} ${Number(value) === 1 ? 'child' : 'children'}`

export const operationsCatalogRecordKey = (section: 'auctions' | 'escalations' | 'forks' | 'integrity' | 'reports' | 'timeline' | 'trading', record: Readonly<Record<string, unknown>>): string => {
	if (section === 'reports') return `${String(record['open_oracle_address'] ?? '')}:${String(record['report_id'] ?? '')}`
	if (section === 'trading') return String(record['pair_address'] ?? '')
	if (section === 'integrity') return String(record['id'] ?? '')
	if (section === 'timeline') return `${String(record['block_hash'] ?? '')}:${String(record['tx_hash'] ?? '')}:${String(record['log_index'] ?? '')}:${String(record['entity_type'] ?? '')}:${String(record['entity_identity'] ?? '')}`
	if (section === 'forks') return String(record['universe_identity'] ?? '')
	return String(record[section === 'auctions' ? 'auction_address' : 'game_address'] ?? '')
}

export const operationsDetailRecordKey = (record: Readonly<Record<string, unknown>>): string => `${String(record['block_hash'] ?? '')}:${String(record['tx_hash'] ?? '')}:${String(record['log_index'] ?? '')}:${String(record['event_name'] ?? record['semantic_event_kind'] ?? '')}`

const operationsInteger = (value: JsonValue | undefined): string => {
	const serialized = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
	return /^-?\d+$/.test(serialized) ? BigInt(serialized).toLocaleString('en-US') : 'Unavailable'
}

export const operationsRouteFreshness = (asOf: JsonRecord, liveConnected: boolean): string => {
	if (asOf['historical'] === true || asOf['phase'] === 'historical') return `Historical snapshot at block #${operationsInteger(asOf['blockNumber'])} · current head #${operationsInteger(asOf['indexedHead'])} · ${operationsInteger(asOf['historyDepthBlocks'])} blocks earlier · fixed point-in-time evidence`
	return `As of block #${operationsInteger(asOf['blockNumber'])} · ${operationsInteger(asOf['lagBlocks'])} blocks behind · ${liveConnected ? 'live updates connected' : 'live updates reconnecting'}`
}

type OperationsDetailKind = 'auction' | 'escalation' | 'fork' | 'pool' | 'report' | 'trading'

const operationsDetailCatalogPaths: Readonly<Record<OperationsDetailKind, string>> = {
	auction: '/operations/auctions',
	escalation: '/operations/escalations',
	fork: '/operations/forks',
	pool: '/operations/risk',
	report: '/operations/reports',
	trading: '/operations/trading',
}

export const operationsDetailHeaderPresentation = (kind: OperationsDetailKind, asOf: JsonRecord, liveConnected: boolean) => {
	const catalogPath = operationsDetailCatalogPaths[kind]
	return {
		backLabel: '← Back to catalog',
		catalogPath,
		freshness: operationsRouteFreshness(asOf, liveConnected),
		riskPanelTitle: asOf['historical'] === true || asOf['phase'] === 'historical' ? 'Risk state at snapshot' : 'Current risk state',
	}
}

const poolProtocolStateLabel = (value: JsonValue | undefined): string => {
	switch (String(value).toLowerCase()) {
		case '0':
			return 'Operational'
		case '1':
			return 'Pool forked'
		case '2':
			return 'Fork migration'
		case '3':
			return 'Fork collateral repair auction'
		case 'bad-debt':
			return 'Bad debt'
		case 'unavailable':
			return 'Unavailable'
		default:
			return 'Unrecognized pool state'
	}
}

const riskAssessments: Readonly<Record<string, { readonly scannerAssessment: string; readonly scannerTone: string }>> = {
	healthy: { scannerAssessment: 'Healthy', scannerTone: 'healthy' },
	warning: { scannerAssessment: 'Warning', scannerTone: 'warning' },
	critical: { scannerAssessment: 'Critical', scannerTone: 'critical' },
	unavailable: { scannerAssessment: 'Unavailable', scannerTone: 'unavailable' },
}

export const operationsRiskPresentation = (protocolState: JsonValue | undefined, scannerSeverity: JsonValue | undefined) => ({
	protocolState: poolProtocolStateLabel(protocolState),
	...(riskAssessments[String(scannerSeverity).toLowerCase()] ?? { scannerAssessment: 'Unrecognized assessment', scannerTone: 'unavailable' }),
})

// CommitmentTakenOver carries position ids, the commitment moved and the REP award. The commitment is in the
// ledger's collateral token, whose decimals a timeline entry does not carry, so it stays in explicit base units.
export const takeoverSummary = (summaryData: unknown): string => {
	const data = isRecord(summaryData) ? summaryData : {}
	const integer = (key: string): string | undefined => {
		const value = data[key]
		return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined
	}
	const [sourceId, receiverId, commitment, award] = [integer('sourceId'), integer('receiverId'), integer('commitment'), integer('awardAttoRep')]
	const parts = [sourceId === undefined || receiverId === undefined ? undefined : `Position ${sourceId} → ${receiverId}`, commitment === undefined ? undefined : `commitment ${exactUnit(commitment, 0, 'collateral units')}`, award === undefined ? undefined : `award ${exactUnit(award, 18, 'REP')}`].filter(
		(part): part is string => part !== undefined,
	)
	return parts.length === 0 ? 'Take-over evidence unavailable' : parts.join(' · ')
}

const snapshotReadStatusLabel = (readStatus: unknown) => {
	if (readStatus === 'success') return 'Current tagged read available'
	if (readStatus === undefined || readStatus === null || readStatus === '') return 'Event-derived'
	return `Tagged read ${String(readStatus)}`
}

export const operationsDetailSummaryPresentation = (
	kind: OperationsDetailKind,
	state: {
		readonly currentEvent?: JsonValue | undefined
		readonly lifecycleState?: JsonValue | undefined
		readonly protocolState?: JsonValue | undefined
		readonly scannerSeverity?: JsonValue | undefined
		readonly snapshotReadStatus?: JsonValue | undefined
	},
): { readonly label: string; readonly value: string } => {
	if (kind === 'pool')
		return {
			label: 'Protocol state',
			value: operationsRiskPresentation(state.protocolState, state.scannerSeverity).protocolState,
		}
	if (kind === 'report') {
		const value = state.lifecycleState ?? state.currentEvent
		return { label: 'Report lifecycle', value: value === undefined || value === null || value === '' ? 'Event-derived' : String(value) }
	}
	const readStatus = state.snapshotReadStatus
	return {
		label: 'Evidence state',
		value: snapshotReadStatusLabel(readStatus),
	}
}

export const operationsDetailEvidencePanelVisible = (kind: OperationsDetailKind, itemCount: number, hasMore: boolean, focusedContinuation: boolean): boolean => (kind === 'pool' ? itemCount > 0 || hasMore || focusedContinuation : true)

/** The URL a filter form opens: its action path plus every field the user actually filled in. */
export const filterFormDestination = (actionPath: string, origin: string, fields: Iterable<readonly [string, string]>): URL => {
	const destination = new URL(actionPath, origin)
	for (const [name, value] of fields) {
		const trimmed = value.trim()
		if (trimmed !== '') destination.searchParams.set(name, trimmed)
	}
	return destination
}

export const blockRangeError = (fromBlock: string, toBlock: string): { readonly field: 'fromBlock' | 'toBlock'; readonly message: string } | undefined => {
	for (const [field, value] of [
		['fromBlock', fromBlock.trim()],
		['toBlock', toBlock.trim()],
	] as const)
		if (value !== '' && !/^\d+$/.test(value)) return { field, message: 'Enter a whole non-negative block number' }
	if (fromBlock.trim() !== '' && toBlock.trim() !== '' && BigInt(fromBlock.trim()) > BigInt(toBlock.trim())) return { field: 'toBlock', message: 'To block must be at or after from block' }
	return undefined
}

/** Explains an operations failure with its cause; a missing entity is reported as such instead of as a generic outage. */
export const operationsFailureMessage = (refresh: boolean, status: number | undefined, detail: string): string => {
	if (refresh) return `Could not refresh protocol operations; existing evidence remains visible: ${detail}`
	return status === 404 ? `No indexed record matches this address or identifier on the selected network: ${detail}` : `Could not load protocol operations: ${detail}`
}

// Portfolio fork events are keyed by coordinator and universe; the fork page is keyed by the universe alone.
export const forkParticipationUniverse = (event: Readonly<Record<string, unknown>>): string => {
	const identity = String(event['universe_identity'] ?? '')
	const eventData = isRecord(event['event_data']) ? event['event_data'] : {}
	const universeId = eventData['universeId']
	return identity.includes(':') && typeof universeId === 'string' ? universeId : identity
}
