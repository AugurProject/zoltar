import type { JsonRecord, JsonValue } from './api-validation.ts'

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
			return 'Fork truth auction'
		case 'bad-debt':
			return 'Bad debt'
		case 'unavailable':
			return 'Unavailable'
		default:
			return 'Unrecognized pool state'
	}
}

const vaultProtocolStateLabel = (value: JsonValue | undefined): string => {
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

export const operationsRiskPresentation = (kind: 'pool' | 'vault', protocolState: JsonValue | undefined, scannerSeverity: JsonValue | undefined) => {
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
		value: snapshotReadStatusLabel(readStatus),
	}
}

export const operationsDetailEvidencePanelVisible = (kind: OperationsDetailKind, itemCount: number, hasMore: boolean, focusedContinuation: boolean): boolean => (kind === 'pool' || kind === 'vault' ? itemCount > 0 || hasMore || focusedContinuation : true)

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

export const approvalTransitionFields = (data: Readonly<Record<string, unknown>>): Array<{ readonly label: string; readonly value: string; readonly unit: string }> => approvalFieldDefinitions.flatMap(([key, label, unit]) => (typeof data[key] === 'string' ? [{ label, value: data[key], unit }] : []))

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
