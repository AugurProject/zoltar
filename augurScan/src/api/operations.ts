import type { SQL } from 'bun'
import { auctionCatalogData, escalationCatalogData, forkCatalogData, forkCatalogTotal, operationsOverviewSupplement, reportCatalogData, riskCatalogData } from '../repositories/operations.ts'
import { detailPage, paged, parseRiskCursor, protocolCursorFor, protocolCursorForRequest, riskCursorFor } from './entity-details.ts'
import { ApiRequestError, integer, json, jsonRecord, postgresBigint } from './shared.ts'
import { operationsAsOfForContinuations, operationsAsOfFromUrl } from './snapshot.ts'

export const operationsResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const asOf = await operationsAsOfFromUrl(sql, chainId, url)
	const [reports, escalations, auctions, risk, supplement, forks] = await Promise.all([
		reportCatalogData(sql, chainId, asOf),
		escalationCatalogData(sql, chainId, String(asOf['blockNumber'])),
		auctionCatalogData(sql, chainId, asOf),
		riskCatalogData(sql, chainId, { snapshotBlock: String(asOf['blockNumber']) }),
		operationsOverviewSupplement(sql, chainId, String(asOf['blockNumber'])),
		forkCatalogData(sql, chainId, String(asOf['blockNumber'])),
	])
	return json({ chainId, asOf, data: { reports, escalations, auctions, risk, ...supplement, forks } })
}

export const domainCatalogResponse = async (sql: SQL, url: URL, domain: 'reports' | 'escalations' | 'auctions' | 'risk' | 'forks'): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	if (domain === 'risk') {
		const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
		const limit = Math.min(Math.max(requestedLimit, 1), 250)
		const poolCursor = parseRiskCursor(url.searchParams.get('poolCursor'), chainId, 'pool')
		const vaultCursor = parseRiskCursor(url.searchParams.get('vaultCursor'), chainId, 'vault')
		const cursors = [poolCursor, vaultCursor].flatMap(cursor => (cursor === undefined ? [] : [{ parts: cursor, offset: 2 }]))
		const asOf = await operationsAsOfForContinuations(sql, chainId, cursors, postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))
		const poolAfter = poolCursor?.[8]
		const vaultAfter = vaultCursor?.[8]
		const data = await riskCatalogData(sql, chainId, { limit, poolAfter, vaultAfter, snapshotBlock: String(asOf['blockNumber']) })
		const pagination = jsonRecord(data.pagination)
		return json({
			chainId,
			asOf,
			data: {
				...data,
				pagination: {
					...pagination,
					poolNextCursor: typeof pagination['poolNextCursor'] === 'string' ? riskCursorFor(chainId, 'pool', asOf, pagination['poolNextCursor']) : undefined,
					vaultNextCursor: typeof pagination['vaultNextCursor'] === 'string' ? riskCursorFor(chainId, 'vault', asOf, pagination['vaultNextCursor']) : undefined,
				},
			},
		})
	}
	const cursor = protocolCursorForRequest(url, chainId, `${domain}-catalog`, 'catalog')
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, `${domain}-catalog`, 'catalog', asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows =
		domain === 'reports'
			? await reportCatalogData(sql, chainId, asOf, cursorBlock, cursorTx, cursorLog, page.queryLimit)
			: domain === 'escalations'
				? await escalationCatalogData(sql, chainId, String(asOf['blockNumber']), cursorBlock, cursorTx, cursorLog, page.queryLimit)
				: domain === 'auctions'
					? await auctionCatalogData(sql, chainId, asOf, cursorBlock, cursorTx, cursorLog, page.queryLimit)
					: await forkCatalogData(sql, chainId, cursorBlock, cursorTx, cursorLog, page.queryLimit, String(asOf['blockNumber']))
	const pageData = paged(rows, page.limit, row => protocolCursorFor(chainId, `${domain}-catalog`, 'catalog', asOf, row))
	return json({
		chainId,
		asOf,
		data: domain === 'forks' ? { ...pageData, total: await forkCatalogTotal(sql, chainId, String(asOf['blockNumber'])) } : pageData,
	})
}
