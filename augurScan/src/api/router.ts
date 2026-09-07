import type { SQL } from 'bun'
import { addressIdentity, addressInteractions, addressTransactions } from './address-history.ts'
import { directObservationsResponse } from './direct-observations.ts'
import { eventEntityDetailResponse, forkDetailResponse, reportDetailResponse } from './entity-details.ts'
import { historicalExport } from './exports.ts'
import { integrityCatalogResponse } from './integrity.ts'
import { listLogs, logDetail, provenanceHistory, reorganizationHistory } from './logs.ts'
import { operationsAsOfForContinuations } from './operation-data.ts'
import { domainCatalogResponse, operationsResponse } from './operations.ts'
import { addressPortfolioResponse, richList } from './portfolio.ts'
import { riskDetailResponse } from './risk.ts'
import {
	ApiConflictError,
	ApiRequestError,
	actionCursorFor,
	actionJsonColumns,
	decodedJsonColumns,
	integer,
	json,
	parseActionCursor,
	routeInteger,
} from './shared.ts'
import { stateHistory } from './state-history.ts'
import { stateCatalog, timelineCatalogResponse, timelineResponse } from './timeline-catalog.ts'
import { tradingCatalogResponse } from './trading-catalog.ts'
import { tradingDetailResponse } from './trading-detail.ts'

export const handleApi = async (request: Request, sql: SQL, freshnessThresholdMs = 48_000): Promise<Response | undefined> => {
	const url = new URL(request.url)
	if (request.method !== 'GET') return json({ error: 'Read-only API' }, 405)
	try {
		if (url.pathname === '/api/v1/networks') {
			const rows =
				await sql`SELECT chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash, indexed_timestamp, observed_block, finalized_block, phase, last_poll_at, last_success_at, failure_started_at, consecutive_failures, next_retry_at, last_reorg_at, last_reorg_depth, last_error, updated_at FROM networks ORDER BY chain_id`
			return json({ items: rows, serverTime: new Date(), freshnessThresholdMs })
		}
		if (url.pathname === '/api/v1/contracts') {
			const chainId = integer(url.searchParams.get('chainId'), 'chainId')
			if (chainId === undefined) throw new ApiRequestError('chainId is required')
			const rows = await sql`
				SELECT contract.*, network.explorer_base_url
				FROM contracts contract
				JOIN networks network USING (chain_id)
				WHERE contract.chain_id = ${chainId} AND contract.canonical
				ORDER BY (contract.deployment_block IS NOT NULL) DESC, contract.label, contract.address
			`
			return json({ items: rows.map((row: Record<string, unknown>) => decodedJsonColumns(row, actionJsonColumns)) })
		}
		if (url.pathname === '/api/v1/logs') return await listLogs(sql, url)
		if (url.pathname.startsWith('/api/v1/logs/')) return await logDetail(sql, url.pathname.slice('/api/v1/logs/'.length).split('/'), url)
		if (url.pathname === '/api/v1/reorgs') return await reorganizationHistory(sql, url)
		if (url.pathname === '/api/v1/provenance') return await provenanceHistory(sql, url)
		if (url.pathname === '/api/v1/export') return await historicalExport(sql, url)
		if (url.pathname === '/api/v1/operations') return await operationsResponse(sql, url)
		if (url.pathname === '/api/v1/state/reports') return await domainCatalogResponse(sql, url, 'reports')
		if (url.pathname === '/api/v1/state/escalations') return await domainCatalogResponse(sql, url, 'escalations')
		if (url.pathname === '/api/v1/state/auctions') return await domainCatalogResponse(sql, url, 'auctions')
		if (url.pathname === '/api/v1/state/risk') return await domainCatalogResponse(sql, url, 'risk')
		if (url.pathname === '/api/v1/state/forks') return await domainCatalogResponse(sql, url, 'forks')
		if (url.pathname === '/api/v1/state/trading') return await tradingCatalogResponse(sql, url)
		if (url.pathname === '/api/v1/state/integrity') return await integrityCatalogResponse(sql, url)
		if (url.pathname === '/api/v1/state/direct-observations') return await directObservationsResponse(sql, url)
		if (url.pathname.startsWith('/api/v1/state/reports/'))
			return await reportDetailResponse(sql, url.pathname.slice('/api/v1/state/reports/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/escalations/'))
			return await eventEntityDetailResponse(sql, url.pathname.slice('/api/v1/state/escalations/'.length).split('/'), url, 'escalation')
		if (url.pathname.startsWith('/api/v1/state/auctions/'))
			return await eventEntityDetailResponse(sql, url.pathname.slice('/api/v1/state/auctions/'.length).split('/'), url, 'auction')
		if (url.pathname.startsWith('/api/v1/state/forks/')) return await forkDetailResponse(sql, url.pathname.slice('/api/v1/state/forks/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/risk/')) return await riskDetailResponse(sql, url.pathname.slice('/api/v1/state/risk/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/trading/'))
			return await tradingDetailResponse(sql, url.pathname.slice('/api/v1/state/trading/'.length).split('/'), url)
		if (url.pathname === '/api/v1/state/address-portfolio') return await addressPortfolioResponse(sql, url)
		if (url.pathname === '/api/v1/state/timeline') return await timelineCatalogResponse(sql, url)
		if (url.pathname.startsWith('/api/v1/state/timeline/'))
			return await timelineResponse(sql, url.pathname.slice('/api/v1/state/timeline/'.length).split('/'), url)
		if (url.pathname === '/api/v1/state/catalog') return await stateCatalog(sql, url)
		if (url.pathname.startsWith('/api/v1/state/')) return await stateHistory(sql, url.pathname.slice('/api/v1/state/'.length).split('/'), url)
		if (url.pathname === '/api/v1/richlist') return await richList(sql, url)
		if (url.pathname === '/api/v1/address-identity') return await addressIdentity(sql, url)
		if (url.pathname === '/api/v1/address-transactions') return await addressTransactions(sql, url)
		if (url.pathname === '/api/v1/address-interactions') return await addressInteractions(sql, url)
		if (url.pathname === '/api/v1/actions') {
			const chainId = integer(url.searchParams.get('chainId'), 'chainId')
			if (chainId === undefined) throw new ApiRequestError('chainId is required')
			const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
			const limit = Math.min(Math.max(requestedLimit, 1), 250)
			if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
			const cursor = parseActionCursor(url.searchParams.get('cursor'), chainId)
			const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 2 }])
			const values: Array<string | number> = []
			const clauses = ['t.canonical', 'block.canonical']
			const bind = (value: string | number): string => {
				values.push(value)
				return `$${values.length}`
			}
			clauses.push(`a.chain_id = ${bind(chainId)}`)
			if (cursor !== undefined)
				clauses.push(
					`(block.timestamp, t.block_number, t.transaction_index, a.block_hash, a.tx_hash) < (${bind(cursor[8])}::timestamptz, ${bind(cursor[9])}::bigint, ${bind(cursor[10])}, ${bind(cursor[11])}, ${bind(cursor[12])})`,
				)
			values.push(limit + 1)
			const rows = await sql.unsafe(
				`SELECT a.*, t.block_number, t.transaction_index, t.from_address, t.to_address, t.status, t.value,
					block.timestamp AS block_timestamp, n.id AS network_id
				FROM actions a
				JOIN transactions t ON t.chain_id = a.chain_id AND t.block_hash = a.block_hash AND t.hash = a.tx_hash
				JOIN blocks block ON block.chain_id = a.chain_id AND block.hash = a.block_hash
				JOIN networks n ON n.chain_id = a.chain_id
				WHERE ${clauses.join(' AND ')}
				ORDER BY block.timestamp DESC, a.chain_id DESC, t.block_number DESC, t.transaction_index DESC, a.block_hash DESC, a.tx_hash DESC
				LIMIT $${values.length}`,
				values,
			)
			const hasMore = rows.length > limit
			const pageRows = rows.slice(0, limit)
			return json({
				items: pageRows.map((row: Record<string, unknown>) => decodedJsonColumns(row, actionJsonColumns)),
				limit,
				asOf,
				nextCursor: hasMore && pageRows.length > 0 ? actionCursorFor(chainId, asOf, pageRows[pageRows.length - 1] as Record<string, unknown>) : undefined,
			})
		}
		if (url.pathname.startsWith('/api/v1/contracts/')) {
			const parts = url.pathname.slice('/api/v1/contracts/'.length).split('/')
			const [chain, address] = parts
			const chainId = routeInteger(chain)
			if (parts.length !== 2 || chainId === undefined || address === undefined || !/^0x[0-9a-fA-F]{40}$/.test(address))
				return json({ error: 'Invalid contract identifier' }, 400)
			const rows = await sql`
				SELECT contract.*, network.explorer_base_url
				FROM contracts contract
				JOIN networks network USING (chain_id)
				WHERE contract.chain_id = ${chainId} AND contract.address = ${address.toLowerCase()} AND contract.canonical
			`
			return rows.length === 0 ? json({ error: 'Contract not found' }, 404) : json(rows[0])
		}
	} catch (error) {
		if (error instanceof ApiRequestError) return json({ error: error.message }, 400)
		if (error instanceof ApiConflictError) return json({ error: error.message }, 409)
		console.error(`augurScan API request failed (${error instanceof Error ? error.name : typeof error})`)
		return json({ error: 'Internal server error' }, 500)
	}
	return undefined
}
