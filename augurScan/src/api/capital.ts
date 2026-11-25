import type { SQL } from 'bun'
import { capitalPositionRisk } from '../operations.ts'
import { capitalLedgerRows, capitalOwnerEventRows, capitalPositionHistoryRows, capitalPositionRows, liquidationRows } from '../repositories/capital.ts'
import { detailPage, paged, protocolCursorFor, protocolCursorForRequest } from './entity-details.ts'
import { ApiRequestError, evmAddress, json, jsonRecord, postgresBigint, routeInteger } from './shared.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import { offsetCursorFor, offsetPage, snapshotCatalogRequest } from './trading-catalog.ts'

/** One owner position with the risk classification of its latest tagged read. */
const capitalPosition = (row: Record<string, unknown>): Record<string, unknown> => {
	const position = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total' && key !== 'health_factor_bps'))
	if (row['read_status'] !== 'success') return { ...position, protocol_state: 'unavailable', scanner_severity: 'unavailable', scanner_reason: row['read_failure_reason'] ?? 'Current tagged capital read is awaiting completion' }
	const state = jsonRecord(row['read_result'])
	const risk = capitalPositionRisk(state)
	return { ...position, read_result: state, securityPool: state['securityPool'], universe_id: state['universeId'], protocol_state: risk.protocolState, scanner_severity: risk.scannerSeverity, scanner_reason: risk.scannerReason }
}

const capitalLedger = (row: Record<string, unknown>): Record<string, unknown> => {
	const state = jsonRecord(row['read_result'])
	return { ...row, read_result: state, securityPool: state['securityPool'], universe_id: state['universeId'] }
}

/** The risk catalog's capital half: every ledger and the positions most at risk at the snapshot block. */
export const capitalRiskOverview = async (sql: SQL, chainId: number, snapshotBlock: string, limit = 100) => {
	const [positions, ledgers, liquidations] = await Promise.all([
		capitalPositionRows(sql, { chainId, snapshotBlock, limit, offset: 0 }),
		capitalLedgerRows(sql, chainId, snapshotBlock),
		liquidationRows(sql, { chainId, snapshotBlock, page: { block: snapshotBlock, log: 2_147_483_647, tx: `0x${'f'.repeat(64)}`, limit: 25 } }),
	])
	return {
		capitalLedgers: ledgers.map(capitalLedger),
		capitalPositions: positions.map(capitalPosition),
		capitalPositionTotal: Number(positions[0]?.['total'] ?? 0),
		recentLiquidations: liquidations,
	}
}

export const capitalCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const { chainId, limit } = snapshotCatalogRequest(url)
	const ledger = evmAddress(url.searchParams.get('ledger'), 'ledger')
	const owner = evmAddress(url.searchParams.get('owner'), 'owner')
	const filterIdentity = JSON.stringify({ ledger, owner })
	const page = offsetPage(url, chainId, 'capital-catalog', filterIdentity)
	if (page.identity !== filterIdentity) throw new ApiRequestError('cursor does not match filters')
	const asOf = await operationsAsOfForContinuations(sql, chainId, page.cursor === undefined ? [] : [{ parts: page.cursor, offset: 3 }], postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))
	const snapshotBlock = String(asOf['blockNumber'])
	const [rows, ledgers] = await Promise.all([capitalPositionRows(sql, { chainId, snapshotBlock, ledger, owner, limit, offset: page.offset }), capitalLedgerRows(sql, chainId, snapshotBlock, ledger)])
	const total = Number(rows[0]?.['total'] ?? 0)
	const hasMore = page.offset + rows.length < total
	return json({
		chainId,
		asOf,
		data: {
			ledgers: ledgers.map(capitalLedger),
			positions: { items: rows.map(capitalPosition), total, limit, offset: page.offset, hasMore, nextCursor: hasMore ? offsetCursorFor(chainId, 'capital-catalog', filterIdentity, asOf, page.offset + limit) : undefined },
		},
	})
}

export const capitalDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const ledger = parts[1]?.toLowerCase()
	const owner = parts[2]?.toLowerCase()
	if (parts.length !== 3 || chainId === undefined || ledger === undefined || owner === undefined || !/^0x[0-9a-f]{40}$/.test(ledger) || !/^0x[0-9a-f]{40}$/.test(owner)) return json({ error: 'Invalid capital position identifier' }, 400)
	const identity = `${ledger}:${owner}`
	const cursor = protocolCursorForRequest(url, chainId, 'capital', identity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [cursor.snapshot], postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))
	const snapshotBlock = String(asOf['blockNumber'])
	const page = detailPage(url, chainId, 'capital', identity, asOf, cursor)
	const [positions, ledgers, history, events] = await Promise.all([
		capitalPositionRows(sql, { chainId, snapshotBlock, ledger, owner, limit: 1, offset: 0 }),
		capitalLedgerRows(sql, chainId, snapshotBlock, ledger),
		capitalPositionHistoryRows(sql, { chainId, ledger, owner, snapshotBlock, limit: 251 }),
		capitalOwnerEventRows(sql, { chainId, ledger, owner, snapshotBlock, page: { ...page.position, limit: page.queryLimit } }),
	])
	const ledgerRow = ledgers[0]
	// An owner that a capital ledger's events name keeps its indexed history before its first balance sample.
	const unsampled = ledgerRow !== undefined && (events.length > 0 || page.cursor !== undefined)
	const row = positions[0] ?? (unsampled ? { ledger_address: ledger, owner_address: owner, read_status: 'unsampled', read_failure_reason: 'No tagged capital read has sampled this position yet' } : undefined)
	if (row === undefined) return json({ error: 'Capital position not found' }, 404)
	const position = capitalPosition(row)
	return json({
		chainId,
		asOf,
		data: {
			...position,
			ledger: ledgerRow === undefined ? undefined : capitalLedger(ledgerRow),
			history: { snapshots: history.slice(0, 250), limit: 250, truncated: history.length > 250 },
			events: paged(events, page.limit, item => protocolCursorFor(chainId, 'capital', identity, asOf, item)),
		},
	})
}

export const liquidationCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const { chainId } = snapshotCatalogRequest(url)
	const ledger = evmAddress(url.searchParams.get('ledger'), 'ledger')
	const owner = evmAddress(url.searchParams.get('owner'), 'owner')
	const identity = JSON.stringify({ ledger, owner })
	const cursor = protocolCursorForRequest(url, chainId, 'liquidations', identity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [cursor.snapshot], postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))
	const snapshotBlock = String(asOf['blockNumber'])
	const page = detailPage(url, chainId, 'liquidations', identity, asOf, cursor)
	const rows = await liquidationRows(sql, { chainId, snapshotBlock, ledger, owner, page: { ...page.position, limit: page.queryLimit } })
	return json({ chainId, asOf, filters: { ledger, owner }, data: paged(rows, page.limit, row => protocolCursorFor(chainId, 'liquidations', identity, asOf, row)) })
}
