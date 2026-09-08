import type { SQL } from 'bun'
import { actionCatalog, contractCatalog, contractDetail, networkCatalog } from '../repositories/catalog.ts'
import { addressIdentity, addressInteractions, addressTransactions } from './address-history.ts'
import { directObservationsResponse } from './direct-observations.ts'
import { eventEntityDetailResponse, forkDetailResponse, reportDetailResponse } from './entity-details.ts'
import { historicalExport } from './exports.ts'
import { integrityCatalogResponse } from './integrity.ts'
import { listLogs, logDetail, provenanceHistory, reorganizationHistory } from './logs.ts'
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
import { operationsAsOfForContinuations } from './snapshot.ts'
import { stateHistory } from './state-history.ts'
import { stateCatalog, timelineCatalogResponse, timelineResponse } from './timeline-catalog.ts'
import { tradingCatalogResponse } from './trading-catalog.ts'
import { tradingDetailResponse } from './trading-detail.ts'

export const handleApi = async (request: Request, sql: SQL, freshnessThresholdMs = 48_000): Promise<Response | undefined> => {
	const url = new URL(request.url)
	if (request.method !== 'GET') return json({ error: 'Read-only API' }, 405)
	try {
		if (url.pathname === '/api/v1/networks') {
			const rows = await networkCatalog(sql)
			return json({ items: rows, serverTime: new Date(), freshnessThresholdMs })
		}
		if (url.pathname === '/api/v1/contracts') {
			const chainId = integer(url.searchParams.get('chainId'), 'chainId')
			if (chainId === undefined) throw new ApiRequestError('chainId is required')
			const rows = await contractCatalog(sql, chainId)
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
			const rows = await actionCatalog(sql, chainId, limit, cursor)
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
			const rows = await contractDetail(sql, chainId, address.toLowerCase())
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
