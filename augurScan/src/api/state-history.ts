import type { SQL } from 'bun'
import { ETH_QUOTE_DECIMALS, USDC_QUOTE_DECIMALS } from '../operations.ts'
import { snapshotBoundaryMatches } from './snapshot.ts'
import { operationsAsOf } from '../repositories/operations.ts'
import { ApiConflictError, ApiRequestError, integer, json, postgresBigint, routeInteger } from './shared.ts'
import { offsetCursorFor, offsetPage, rejectRawSnapshotOffset } from './trading-catalog.ts'

export const stateHistory = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const type = parts[0]
	const chainId = routeInteger(parts[1])
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 1_000
	const limit = Math.min(Math.max(requestedLimit, 1), 2_000)
	const fromBlock = postgresBigint(url.searchParams.get('fromBlock'), 'fromBlock') ?? '0'
	const toBlock = postgresBigint(url.searchParams.get('toBlock'), 'toBlock') ?? '9223372036854775807'
	if (BigInt(fromBlock) > BigInt(toBlock)) throw new ApiRequestError('fromBlock must not exceed toBlock')
	const queryLimit = limit + 1
	const chronological = <T>(rows: readonly T[]): T[] => rows.slice(0, limit).reverse()
	if (chainId === undefined) return json({ error: 'Invalid state identifier' }, 400)
	const validStateIdentity =
		(type === 'pools' && parts.length === 3 && /^0x[0-9a-fA-F]{40}$/.test(parts[2] ?? '')) ||
		(type === 'vaults' && parts.length === 4 && /^0x[0-9a-fA-F]{40}$/.test(parts[2] ?? '') && /^0x[0-9a-fA-F]{40}$/.test(parts[3] ?? '')) ||
		((type === 'universes' || type === 'questions') && parts.length === 3 && /^\d+$/.test(parts[2] ?? ''))
	if (!validStateIdentity) {
		if (type !== 'pools' && type !== 'vaults' && type !== 'universes' && type !== 'questions') return json({ error: 'Unknown state history type' }, 404)
		return json({ error: 'Invalid state identifier' }, 400)
	}
	rejectRawSnapshotOffset(url)
	const asOf = await operationsAsOf(sql, chainId)
	const networkRows = await sql`
		SELECT start_block::text, indexed_block::text, indexed_hash FROM networks WHERE chain_id = ${chainId}
	`
	const network = networkRows[0]
	if (network === undefined) throw new ApiRequestError('chainId is not configured')
	const indexedFromBlock = String(network['start_block'])
	const indexedThroughBlock = network['indexed_block'] === null ? undefined : String(network['indexed_block'])
	const requestedFromBlock = url.searchParams.has('fromBlock') ? fromBlock : indexedFromBlock
	const requestedToBlock = url.searchParams.has('toBlock') ? toBlock : indexedThroughBlock
	const historyIdentity = JSON.stringify({ type, identity: parts.slice(2).map((part) => part.toLowerCase()), fromBlock, toBlock, indexedFromBlock })
	const page = offsetPage(url, chainId, 'state-history', historyIdentity)
	if (page.identity !== historyIdentity) throw new ApiRequestError('cursor does not match filters')
	if (page.cursor !== undefined && !snapshotBoundaryMatches(page.cursor, 3, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	const offset = page.offset
	const rangeCovered =
		indexedThroughBlock !== undefined &&
		requestedToBlock !== undefined &&
		BigInt(requestedFromBlock) >= BigInt(indexedFromBlock) &&
		BigInt(requestedToBlock) <= BigInt(indexedThroughBlock)
	const coverage = (truncated: boolean, series: Record<string, number>) => ({
		requestedFromBlock,
		requestedToBlock: requestedToBlock ?? toBlock,
		indexedFromBlock,
		indexedThroughBlock,
		indexedThroughHash: network['indexed_hash'],
		limit,
		offset,
		series,
		complete: rangeCovered && offset === 0 && !truncated,
		rangeCovered,
		hasPreviousPages: offset > 0,
		...(truncated ? { nextCursor: offsetCursorFor(chainId, 'state-history', historyIdentity, asOf, offset + limit) } : {}),
	})
	if (type === 'pools') {
		const address = parts[2]?.toLowerCase()
		if (parts.length !== 3 || address === undefined || !/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'Invalid pool address' }, 400)
		const [snapshots, events, markets, ammPrices, repEthPrices, uniswapRepEthPrices, openOracleHistory] = await Promise.all([
			sql`SELECT s.*, b.timestamp FROM pool_snapshots s JOIN blocks b ON b.chain_id = s.chain_id AND b.hash = s.block_hash WHERE s.chain_id = ${chainId} AND s.pool_address = ${address} AND s.canonical AND s.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY s.block_number DESC, s.log_index DESC, s.tx_hash DESC, s.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT e.*, b.timestamp FROM pool_state_events e JOIN blocks b ON b.chain_id = e.chain_id AND b.hash = e.block_hash WHERE e.chain_id = ${chainId} AND e.pool_address = ${address} AND e.canonical AND e.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY e.block_number DESC, e.log_index DESC, e.tx_hash DESC, e.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT market.chain_id::text AS chain_id, market.block_hash, market.tx_hash, market.log_index, market.block_number::text AS block_number, market.pair_address, market.pool_address, market.share_token_address, market.universe_id::text AS universe_id, market.fee_bps::text AS fee_bps, market.canonical, block.timestamp FROM amm_markets market JOIN blocks block ON block.chain_id = market.chain_id AND block.hash = market.block_hash WHERE market.chain_id = ${chainId} AND market.pool_address = ${address} AND market.canonical ORDER BY market.block_number DESC, market.log_index DESC LIMIT 1`,
			sql`SELECT price.chain_id::text AS chain_id, price.block_hash, price.tx_hash, price.log_index, price.block_number::text AS block_number, price.pair_address, price.yes_reserve_atto_shares::text AS yes_reserve_atto_shares, price.no_reserve_atto_shares::text AS no_reserve_atto_shares, price.conditional_yes_bps::text AS conditional_yes_bps, price.conditional_no_bps::text AS conditional_no_bps, price.canonical, block.timestamp FROM amm_price_snapshots price JOIN blocks block ON block.chain_id = price.chain_id AND block.hash = price.block_hash JOIN amm_markets market ON market.chain_id = price.chain_id AND market.pair_address = price.pair_address AND market.canonical WHERE price.chain_id = ${chainId} AND market.pool_address = ${address} AND price.canonical AND price.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY price.block_number DESC, price.log_index DESC, price.tx_hash DESC, price.block_hash DESC, price.pair_address LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT price.chain_id::text AS chain_id, price.block_hash, price.tx_hash, price.log_index, price.block_number::text AS block_number, price.coordinator_address, price.event_name, price.report_id::text AS report_id, price.rep_per_eth_1e18::text AS rep_per_eth_1e18, price.settlement_timestamp, price.canonical, block.timestamp FROM rep_eth_price_snapshots price JOIN blocks block ON block.chain_id = price.chain_id AND block.hash = price.block_hash JOIN pools pool ON pool.chain_id = price.chain_id AND pool.coordinator_address = price.coordinator_address AND pool.canonical WHERE price.chain_id = ${chainId} AND pool.pool_address = ${address} AND price.canonical AND price.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY price.block_number DESC, price.log_index DESC, price.tx_hash DESC, price.block_hash DESC, price.coordinator_address LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`
				WITH target_pool AS (
					SELECT pools.universe_id FROM pools
					WHERE pools.chain_id = ${chainId} AND pools.pool_address = ${address} AND pools.canonical
					ORDER BY pools.block_number DESC, pools.log_index DESC LIMIT 1
				), universe_rep AS (
					SELECT universe_events.reputation_token_address
					FROM universe_events CROSS JOIN target_pool
					WHERE universe_events.chain_id = ${chainId}
						AND universe_events.universe_id = target_pool.universe_id
						AND universe_events.reputation_token_address IS NOT NULL
						AND universe_events.canonical
					ORDER BY universe_events.block_number DESC, universe_events.log_index DESC LIMIT 1
				)
				SELECT observation.chain_id::text AS chain_id, observation.block_hash, observation.tx_hash,
					observation.log_index, observation.block_number::text AS block_number, observation.venue,
					observation.market_id, observation.event_name, market.contract_address, market.token0_address,
					market.token1_address, market.fee_hundredths_bip::text AS fee_hundredths_bip,
					market.tick_spacing, market.hooks_address,
					CASE WHEN quote_contract.kind = 'usdc' THEN 'USDC' WHEN observation.venue = 'v4' THEN 'ETH' ELSE COALESCE(quote_metadata.symbol, 'WETH') END AS quote_symbol,
					CASE
						WHEN market.token0_address = universe_rep.reputation_token_address THEN market.token1_address
						ELSE market.token0_address
					END AS quote_token_address,
					TRUNC(CASE
						WHEN observation.venue = 'v2' AND market.token0_address = universe_rep.reputation_token_address
							THEN observation.reserve0 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END)) / observation.reserve1
						WHEN observation.venue = 'v2'
							THEN observation.reserve1 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END)) / observation.reserve0
						WHEN market.token0_address = universe_rep.reputation_token_address
							THEN 6277101735386680763835789423207666416102355444464034512896 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END))
								/ (observation.sqrt_price_x96 * observation.sqrt_price_x96)
						ELSE observation.sqrt_price_x96 * observation.sqrt_price_x96 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END))
							/ 6277101735386680763835789423207666416102355444464034512896
					END)::text AS rep_per_eth_1e18,
					TRUNC(CASE WHEN observation.venue = 'v2' THEN observation.reserve0 * observation.reserve1 ELSE observation.liquidity END)::text AS liquidity_value,
					block.timestamp
				FROM uniswap_rep_eth_price_observations observation
				JOIN uniswap_rep_eth_markets market ON market.chain_id = observation.chain_id
					AND market.venue = observation.venue AND market.market_id = observation.market_id AND market.canonical
				JOIN universe_rep ON market.token0_address = universe_rep.reputation_token_address
					OR market.token1_address = universe_rep.reputation_token_address
				JOIN blocks block ON block.chain_id = observation.chain_id AND block.hash = observation.block_hash
				LEFT JOIN contracts quote_contract ON quote_contract.chain_id = market.chain_id AND quote_contract.canonical
					AND quote_contract.address = CASE WHEN market.token0_address = universe_rep.reputation_token_address THEN market.token1_address ELSE market.token0_address END
				LEFT JOIN LATERAL (
					SELECT metadata.symbol, metadata.decimals FROM token_metadata metadata
					JOIN blocks metadata_block ON metadata_block.chain_id = metadata.chain_id
						AND metadata_block.hash = metadata.block_hash AND metadata_block.canonical
					JOIN networks metadata_network ON metadata_network.chain_id = metadata.chain_id
					WHERE metadata.chain_id = market.chain_id AND metadata.address = quote_contract.address AND metadata.canonical
						AND metadata.read_block <= metadata_network.indexed_block
					ORDER BY metadata.read_block DESC LIMIT 1
				) quote_metadata ON true
				WHERE observation.chain_id = ${chainId} AND observation.canonical
					AND observation.block_number BETWEEN ${fromBlock} AND ${toBlock}
					AND CASE WHEN observation.venue = 'v2'
						THEN observation.reserve0 > 0 AND observation.reserve1 > 0
						ELSE observation.sqrt_price_x96 > 0
					END
				ORDER BY observation.block_number DESC, observation.log_index DESC, observation.tx_hash DESC,
					observation.block_hash DESC, observation.venue DESC, observation.market_id DESC
				LIMIT ${queryLimit} OFFSET ${offset}
			`,
			sql`SELECT log.block_number::text AS block_number, log.block_hash, log.tx_hash, log.log_index, log.event_name,
				log.arguments, log.summary, log.emitter_address AS coordinator_address, block.timestamp
				FROM logs log JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash
				JOIN pools pool ON pool.chain_id = log.chain_id AND pool.coordinator_address = log.emitter_address AND pool.canonical
				WHERE log.chain_id = ${chainId} AND pool.pool_address = ${address} AND log.canonical
					AND log.block_number BETWEEN ${fromBlock} AND ${toBlock}
					AND log.event_name IN (
						'PriceRequested', 'PriceReportRejected', 'PriceReported', 'PendingReportRecovered', 'CoordinatorStateCheckpoint',
						'LiquidationRouteStaged', 'StagedOperationQueued', 'ExecutedStagedOperation', 'SecurityPoolSet'
					)
				ORDER BY log.block_number DESC, log.transaction_index DESC, log.log_index DESC, log.tx_hash DESC, log.block_hash DESC
				LIMIT ${queryLimit} OFFSET ${offset}`,
		])
		const truncated =
			snapshots.length > limit ||
			events.length > limit ||
			ammPrices.length > limit ||
			repEthPrices.length > limit ||
			uniswapRepEthPrices.length > limit ||
			openOracleHistory.length > limit
		return json({
			snapshots: chronological(snapshots),
			events: chronological(events),
			market: markets[0],
			ammPrices: chronological(ammPrices),
			repEthPrices: chronological(repEthPrices),
			uniswapRepEthPrices: chronological(uniswapRepEthPrices),
			openOracleHistory: chronological(openOracleHistory),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, {
				snapshots: Math.min(snapshots.length, limit),
				events: Math.min(events.length, limit),
				ammPrices: Math.min(ammPrices.length, limit),
				repEthPrices: Math.min(repEthPrices.length, limit),
				uniswapRepEthPrices: Math.min(uniswapRepEthPrices.length, limit),
				openOracleHistory: Math.min(openOracleHistory.length, limit),
			}),
		})
	}
	if (type === 'vaults') {
		const pool = parts[2]?.toLowerCase()
		const vault = parts[3]?.toLowerCase()
		if (parts.length !== 4 || pool === undefined || vault === undefined || !/^0x[0-9a-f]{40}$/.test(pool) || !/^0x[0-9a-f]{40}$/.test(vault))
			return json({ error: 'Invalid vault identifier' }, 400)
		const snapshots =
			await sql`SELECT v.*, b.timestamp FROM vault_snapshots v JOIN blocks b ON b.chain_id = v.chain_id AND b.hash = v.block_hash WHERE v.chain_id = ${chainId} AND v.pool_address = ${pool} AND v.vault_address = ${vault} AND v.canonical AND v.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY v.block_number DESC, v.log_index DESC, v.tx_hash DESC, v.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`
		const truncated = snapshots.length > limit
		return json({
			snapshots: chronological(snapshots),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, { snapshots: Math.min(snapshots.length, limit) }),
		})
	}
	if (type === 'universes') {
		const universeId = parts[2]
		if (parts.length !== 3 || universeId === undefined || !/^\d+$/.test(universeId)) return json({ error: 'Invalid universe identifier' }, 400)
		const events =
			await sql`SELECT u.*, b.timestamp FROM universe_events u JOIN blocks b ON b.chain_id = u.chain_id AND b.hash = u.block_hash WHERE u.chain_id = ${chainId} AND u.universe_id = ${universeId} AND u.canonical AND u.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY u.block_number DESC, u.log_index DESC, u.tx_hash DESC, u.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`
		const truncated = events.length > limit
		return json({ events: chronological(events), truncated, limit, offset, coverage: coverage(truncated, { events: Math.min(events.length, limit) }) })
	}
	if (type === 'questions') {
		const questionId = parts[2]
		if (parts.length !== 3 || questionId === undefined || !/^\d+$/.test(questionId)) return json({ error: 'Invalid question identifier' }, 400)
		const [pools, forks] = await Promise.all([
			sql`SELECT p.pool_address, p.universe_id, p.block_number, p.block_hash, p.tx_hash, p.log_index, b.timestamp FROM pools p JOIN blocks b ON b.chain_id = p.chain_id AND b.hash = p.block_hash WHERE p.chain_id = ${chainId} AND p.question_id = ${questionId} AND p.canonical AND p.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY p.block_number DESC, p.log_index DESC, p.tx_hash DESC, p.block_hash DESC, p.pool_address LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT u.universe_id, u.block_number, u.block_hash, u.tx_hash, u.log_index, u.fork_time AS timestamp FROM universe_events u WHERE u.chain_id = ${chainId} AND u.fork_question_id = ${questionId} AND u.event_name = 'UniverseForked' AND u.canonical AND u.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY u.block_number DESC, u.log_index DESC, u.tx_hash DESC, u.block_hash DESC, u.universe_id LIMIT ${queryLimit} OFFSET ${offset}`,
		])
		const truncated = pools.length > limit || forks.length > limit
		return json({
			pools: chronological(pools),
			forks: chronological(forks),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, { pools: Math.min(pools.length, limit), forks: Math.min(forks.length, limit) }),
		})
	}
	return json({ error: 'Unknown state history type' }, 404)
}
