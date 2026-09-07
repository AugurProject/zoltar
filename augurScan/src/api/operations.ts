import type { SQL } from 'bun'
import { detailPage, paged, parseRiskCursor, protocolCursorFor, protocolCursorForRequest, riskCursorFor } from './entity-details.ts'
import {
	auctionCatalogData,
	escalationCatalogData,
	forkCatalogData,
	forkCatalogTotal,
	operationsAsOfForContinuations,
	operationsAsOfFromUrl,
	reportCatalogData,
	riskCatalogData,
} from './operation-data.ts'
import { ApiRequestError, integer, json, jsonRecord, postgresBigint } from './shared.ts'

export const operationsResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const asOf = await operationsAsOfFromUrl(sql, chainId, url)
	const [reports, escalations, auctions, risk, prices, recentChanges, forks, totals] = await Promise.all([
		reportCatalogData(sql, chainId, asOf),
		escalationCatalogData(sql, chainId, String(asOf['blockNumber'])),
		auctionCatalogData(sql, chainId, asOf),
		riskCatalogData(sql, chainId, { snapshotBlock: String(asOf['blockNumber']) }),
		sql`SELECT coordinator_address AS source_contract, event_name AS source_event, rep_per_eth_1e18::text AS value,
			block_number::text AS block_number, settlement_timestamp AS observed_timestamp
			FROM rep_eth_price_snapshots WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])}
			ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 1`,
		sql`SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			WHERE timeline.chain_id = ${chainId} AND timeline.canonical AND timeline.block_number <= ${String(asOf['blockNumber'])}
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC,
				timeline.block_hash DESC, timeline.entity_type DESC, timeline.entity_identity DESC LIMIT 30`,
		forkCatalogData(sql, chainId, String(asOf['blockNumber'])),
		sql`SELECT
			(SELECT count(DISTINCT (open_oracle_address, report_id)) FROM open_oracle_report_events
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS reports,
			(SELECT count(DISTINCT game_address) FROM escalation_game_events
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS escalations,
			(SELECT count(DISTINCT auction_address) FROM truth_auction_events
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS auctions,
			(SELECT count(DISTINCT pool_address) FROM pools
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS pools,
			(SELECT count(DISTINCT (pool_address, vault_address)) FROM vault_snapshots
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS vaults,
			(SELECT count(DISTINCT pair_address) FROM amm_markets
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS markets,
			(SELECT count(*) FROM chain_reorganizations WHERE chain_id = ${chainId})::integer AS reorganizations`,
	])
	return json({ chainId, asOf, data: { reports, escalations, auctions, risk, prices, recentChanges, forks, totals: totals[0] } })
}

export const domainCatalogResponse = async (sql: SQL, url: URL, domain: 'reports' | 'escalations' | 'auctions' | 'risk' | 'forks'): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	if (domain === 'risk') {
		const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
		const limit = Math.min(Math.max(requestedLimit, 1), 250)
		const poolCursor = parseRiskCursor(url.searchParams.get('poolCursor'), chainId, 'pool')
		const vaultCursor = parseRiskCursor(url.searchParams.get('vaultCursor'), chainId, 'vault')
		const cursors = [poolCursor, vaultCursor].flatMap((cursor) => (cursor === undefined ? [] : [{ parts: cursor, offset: 2 }]))
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
	const pageData = paged(rows, page.limit, (row) => protocolCursorFor(chainId, `${domain}-catalog`, 'catalog', asOf, row))
	return json({
		chainId,
		asOf,
		data: domain === 'forks' ? { ...pageData, total: await forkCatalogTotal(sql, chainId, String(asOf['blockNumber'])) } : pageData,
	})
}
