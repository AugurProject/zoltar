import type { SecurityPoolData } from './browser-types.ts'
import { isJsonRecord, operationRecords, type JsonRecord } from './api-validation.ts'

export const SECURITY_POOL_KIND_LABELS = {
	forks: { collection: 'fork_participation', cursorParameter: 'forkCursor', plural: 'fork events', singular: 'fork event' },
	lp: { collection: 'lp_positions', cursorParameter: 'lpCursor', plural: 'positions', singular: 'position' },
	reports: { collection: 'report_participation', cursorParameter: 'reportCursor', plural: 'report events', singular: 'report event' },
} as const

export const securityPoolPage = (data: SecurityPoolData, kind: 'forks' | 'lp' | 'reports'): JsonRecord => {
	const pagination = isJsonRecord(data['securityPoolPagination']) ? data['securityPoolPagination'] : {}
	return isJsonRecord(pagination[kind]) ? pagination[kind] : {}
}

export const securityPoolItems = (data: SecurityPoolData, kind: 'forks' | 'lp' | 'reports'): JsonRecord[] => operationRecords(data[SECURITY_POOL_KIND_LABELS[kind].collection])

export const securityPoolItemKey = (kind: 'forks' | 'lp' | 'reports', item: JsonRecord): string => {
	if (kind === 'lp') return String(item['market_address'] ?? '')
	return `${String(item['block_hash'] ?? '')}:${String(item['tx_hash'] ?? '')}:${String(item['log_index'] ?? '')}:${kind === 'forks' ? String(item['universe_identity'] ?? '') : `${String(item['open_oracle_address'] ?? '')}:${String(item['report_id'] ?? '')}`}`
}
