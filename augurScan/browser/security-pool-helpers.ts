import type { SecurityPoolData } from './browser-types.ts'
import { isJsonRecord, operationRecords, type JsonRecord } from './api-validation.ts'

export const SECURITY_POOL_KIND_LABELS = {
	refunds: { collection: 'pending_refunds', cursorParameter: 'refundCursor', plural: 'refunds', singular: 'refund' },
	positions: { collection: 'escalation_positions', cursorParameter: 'positionCursor', plural: 'deposits', singular: 'deposit' },
	forks: { collection: 'fork_participation', cursorParameter: 'forkCursor', plural: 'fork events', singular: 'fork event' },
	lp: { collection: 'lp_positions', cursorParameter: 'lpCursor', plural: 'positions', singular: 'position' },
	reports: { collection: 'report_participation', cursorParameter: 'reportCursor', plural: 'report events', singular: 'report event' },
} as const

export type SecurityPoolKind = keyof typeof SECURITY_POOL_KIND_LABELS

export const mapSecurityPoolKinds = <T>(value: (kind: SecurityPoolKind) => T): Record<SecurityPoolKind, T> => ({
	lp: value('lp'),
	forks: value('forks'),
	reports: value('reports'),
	refunds: value('refunds'),
	positions: value('positions'),
})

export const securityPoolPage = (data: SecurityPoolData, kind: SecurityPoolKind): JsonRecord => {
	const pagination = isJsonRecord(data['securityPoolPagination']) ? data['securityPoolPagination'] : {}
	return isJsonRecord(pagination[kind]) ? pagination[kind] : {}
}

export const securityPoolItems = (data: SecurityPoolData, kind: SecurityPoolKind): JsonRecord[] => operationRecords(data[SECURITY_POOL_KIND_LABELS[kind].collection])

export const securityPoolItemKey = (kind: SecurityPoolKind, item: JsonRecord): string => {
	if (kind === 'refunds') return String(item['auction_address'])
	if (kind === 'positions') return `${String(item['game_address'])}:${String(item['outcome'])}:${String(item['deposit_index'])}`
	if (kind === 'lp') return String(item['market_address'] ?? '')
	return `${String(item['block_hash'] ?? '')}:${String(item['tx_hash'] ?? '')}:${String(item['log_index'] ?? '')}:${kind === 'forks' ? String(item['universe_identity'] ?? '') : `${String(item['open_oracle_address'] ?? '')}:${String(item['report_id'] ?? '')}`}`
}
