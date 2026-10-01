import type { JsonValue } from './api-validation.ts'
import { isJsonArray } from './api-validation.ts'

export type HistoryInvalidationReason = 'chain-reorg' | 'manifest-reset' | 'start-boundary-advanced' | 'abi-redecode' | 'projection-rebuild'

export const isHistoryInvalidationReason = (value: unknown): value is HistoryInvalidationReason => value === 'chain-reorg' || value === 'manifest-reset' || value === 'start-boundary-advanced' || value === 'abi-redecode' || value === 'projection-rebuild'

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
		default:
			throw new Error(`Unknown history invalidation reason ${String(reason)}`)
	}
}

export const timelineOccurrenceFields = (record: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [label: string, value: unknown]> => [
	['Block', record['block_number']],
	['Block hash', record['block_hash']],
	['Transaction hash', record['tx_hash']],
	['Log index', record['log_index']],
	['Entity type', record['entity_type']],
	['Entity identity', record['entity_identity']],
]
/** @internal Used only by the separately built QA entry point. */
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

const enumValueLabel = (value: JsonValue | undefined, fallback: string): string => {
	if (typeof value !== 'string' || value.trim() === '') return fallback
	const words = value.trim().split('-').filter(Boolean)
	const [first, ...rest] = words
	if (first === undefined) return fallback
	return [`${first.slice(0, 1).toUpperCase()}${first.slice(1)}`, ...rest].join(' ')
}

export const timelineEntityTypeLabel = (value: JsonValue | undefined): string => {
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

export const evidenceStatusLabel = (value: JsonValue | undefined): string => {
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

export const historyInvalidationReasonLabel = (value: JsonValue | undefined): string => {
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

export const historyInvalidationEvidencePresentation = (causes: JsonValue | undefined, occurrenceCounts: JsonValue | undefined) => {
	const causeCodes = isJsonArray(causes) ? causes.filter((cause): cause is string => typeof cause === 'string') : []
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
