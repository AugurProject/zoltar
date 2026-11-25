import type { SQL } from 'bun'
import { auctionCatalogData, escalationCatalogData, forkCatalogData, forkCatalogTotal, operationsOverviewSupplement, reportCatalogData, riskCatalogData } from '../repositories/operations.ts'
import { capitalRiskOverview } from './capital.ts'
import { feeEconomicsOverview } from './fee-economics.ts'
import { detailPage, paged, parseRiskCursor, protocolCursorFor, protocolCursorForRequest, riskCursorFor } from './entity-details.ts'
import { ApiRequestError, integer, json, jsonRecord, postgresBigint } from './shared.ts'
import { operationsAsOfForContinuations, operationsAsOfFromUrl } from './snapshot.ts'

export const operationsResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const asOf = await operationsAsOfFromUrl(sql, chainId, url)
	const [reports, escalations, auctions, risk, capital, fees, supplement, forks] = await Promise.all([
		reportCatalogData(sql, chainId, asOf),
		escalationCatalogData(sql, chainId, String(asOf['blockNumber'])),
		auctionCatalogData(sql, chainId, asOf),
		riskCatalogData(sql, chainId, { snapshotBlock: String(asOf['blockNumber']) }),
		capitalRiskOverview(sql, chainId, String(asOf['blockNumber'])),
		feeEconomicsOverview(sql, chainId, String(asOf['blockNumber'])),
		operationsOverviewSupplement(sql, chainId, String(asOf['blockNumber'])),
		forkCatalogData(sql, { chainId, snapshotBlock: String(asOf['blockNumber']) }),
	])
	return json({ chainId, asOf, data: { reports, escalations, auctions, risk: { ...risk, ...capital, ...fees }, feeEconomics: fees.feeEconomics, ...supplement, forks } })
}

const catalogRows = async (sql: SQL, domain: 'reports' | 'escalations' | 'auctions' | 'forks', chainId: number, asOf: Record<string, unknown>, position: { block: string; log: number; tx: string } | undefined, queryLimit: number) => {
	if (domain === 'reports') return await reportCatalogData(sql, chainId, asOf, position?.block, position?.tx, position?.log, queryLimit)
	if (domain === 'escalations') return await escalationCatalogData(sql, chainId, String(asOf['blockNumber']), position?.block, position?.tx, position?.log, queryLimit)
	if (domain === 'auctions') return await auctionCatalogData(sql, chainId, asOf, position?.block, position?.tx, position?.log, queryLimit)
	return await forkCatalogData(sql, { chainId, snapshotBlock: String(asOf['blockNumber']), position, limit: queryLimit })
}

export const domainCatalogResponse = async (sql: SQL, url: URL, domain: 'reports' | 'escalations' | 'auctions' | 'risk' | 'forks'): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	if (domain === 'risk') {
		const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
		const limit = Math.min(Math.max(requestedLimit, 1), 250)
		const poolCursor = parseRiskCursor(url.searchParams.get('poolCursor'), chainId)
		const asOf = await operationsAsOfForContinuations(sql, chainId, poolCursor === undefined ? [] : [poolCursor.snapshot], postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))
		// The pool cursor pages pools only; the capital positions and liquidations are the bounded head of their own catalogs.
		const [data, capital, fees] = await Promise.all([riskCatalogData(sql, chainId, { limit, poolAfter: poolCursor?.poolAddress, snapshotBlock: String(asOf['blockNumber']) }), capitalRiskOverview(sql, chainId, String(asOf['blockNumber'])), feeEconomicsOverview(sql, chainId, String(asOf['blockNumber']))])
		const pagination = jsonRecord(data.pagination)
		return json({
			chainId,
			asOf,
			data: {
				...data,
				...capital,
				...fees,
				pagination: {
					...pagination,
					poolNextCursor: typeof pagination['poolNextCursor'] === 'string' ? riskCursorFor(chainId, asOf, pagination['poolNextCursor']) : undefined,
				},
			},
		})
	}
	const cursor = protocolCursorForRequest(url, chainId, `${domain}-catalog`, 'catalog')
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [cursor.snapshot], postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))
	const page = detailPage(url, chainId, `${domain}-catalog`, 'catalog', asOf, cursor)
	const rows = await catalogRows(sql, domain, chainId, asOf, cursor?.position, page.queryLimit)
	const pageData = paged(rows, page.limit, row => protocolCursorFor(chainId, `${domain}-catalog`, 'catalog', asOf, row))
	return json({
		chainId,
		asOf,
		data: domain === 'forks' ? { ...pageData, total: await forkCatalogTotal(sql, chainId, String(asOf['blockNumber'])) } : pageData,
	})
}
