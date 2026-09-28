import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { handleApi } from '../../src/api.ts'
import { initializeSchema } from '../../src/schema.ts'

const url = process.env['POSTGRES_TEST_URL']
const chainId = 1
const zero = `0x${'0'.repeat(40)}`
const address = (digit: string) => `0x${digit.repeat(40)}`
const hash = (value: number) => `0x${value.toString(16).padStart(64, '0')}`
const router = address('a')
const pair = address('b')
const pool = address('c')
const shareToken = address('d')
const trader = address('1')
const liquidityProvider = address('2')
const swapper = address('3')
const settler = address('4')
const now = 1_767_225_600
const blocks = [
	{ number: 1, hash: hash(1001), timestamp: now - 200_000 },
	{ number: 2, hash: hash(1002), timestamp: now - 100 },
	{ number: 3, hash: hash(1003), timestamp: now },
] as const

type LogFixture = { readonly block: 1 | 2; readonly tx: number; readonly logIndex: number; readonly emitter: string; readonly name: string; readonly data: Record<string, unknown> }

const batch = (from: string, to: string, ids: readonly number[], values: readonly number[]) => ({ operator: router, from, to, ids: ids.map(String), values: values.map(String) })
const single = (from: string, to: string, id: number, value: number) => ({ operator: router, from, to, id: String(id), value: String(value) })
const swap = (sender: string, yesForNo: boolean, exactOutput: boolean, amountIn: number, amountOut: number) => ({ sender, recipient: sender, yesForNo, exactOutput, amountIn: String(amountIn), amountOut: String(amountOut), feeAmount: '0', resultingYesReserve: '1000', resultingNoReserve: '1000' })

// Router-funded liquidity, a router enter and exit, a direct share swap, and a settlement redemption.
const poolAndShareLogs: readonly LogFixture[] = [
	{ block: 1, tx: 1, logIndex: 0, emitter: pool, name: 'CompleteSetCreated', data: { creator: router, settlementCollateralProvidedAttoEth: String(100n), completeSetsMintedAttoShares: String(100n), resultingShareTokenSupplyAttoShares: String(100n), resultingSettlementCollateralAttoEth: String(100n) } },
	{ block: 1, tx: 1, logIndex: 1, emitter: shareToken, name: 'TransferBatch', data: batch(zero, router, [0, 1, 2], [100, 100, 100]) },
	{ block: 1, tx: 1, logIndex: 2, emitter: shareToken, name: 'TransferSingle', data: single(router, pair, 1, 100) },
	{ block: 1, tx: 1, logIndex: 3, emitter: shareToken, name: 'TransferSingle', data: single(router, pair, 2, 100) },
	{ block: 1, tx: 1, logIndex: 6, emitter: shareToken, name: 'TransferBatch', data: batch(router, liquidityProvider, [0, 1, 2], [100, 0, 0]) },
	{ block: 1, tx: 2, logIndex: 10, emitter: pool, name: 'CompleteSetCreated', data: { creator: router, settlementCollateralProvidedAttoEth: String(10n), completeSetsMintedAttoShares: String(10n), resultingShareTokenSupplyAttoShares: String(110n), resultingSettlementCollateralAttoEth: String(110n) } },
	{ block: 1, tx: 2, logIndex: 11, emitter: shareToken, name: 'TransferBatch', data: batch(zero, router, [0, 1, 2], [10, 10, 10]) },
	{ block: 1, tx: 2, logIndex: 12, emitter: shareToken, name: 'TransferSingle', data: single(router, pair, 2, 10) },
	{ block: 1, tx: 2, logIndex: 13, emitter: shareToken, name: 'TransferSingle', data: single(pair, router, 1, 6) },
	{ block: 1, tx: 2, logIndex: 15, emitter: shareToken, name: 'TransferBatch', data: batch(router, trader, [0, 1], [10, 16]) },
	{ block: 2, tx: 3, logIndex: 20, emitter: shareToken, name: 'TransferBatch', data: batch(trader, router, [0, 1], [4, 16]) },
	{ block: 2, tx: 3, logIndex: 21, emitter: shareToken, name: 'TransferSingle', data: single(router, pair, 1, 6) },
	{ block: 2, tx: 3, logIndex: 22, emitter: shareToken, name: 'TransferSingle', data: single(pair, router, 2, 4) },
	{ block: 2, tx: 3, logIndex: 24, emitter: shareToken, name: 'TransferBatch', data: batch(router, zero, [0, 1, 2], [4, 4, 4]) },
	{ block: 2, tx: 3, logIndex: 25, emitter: pool, name: 'CompleteSetRedeemed', data: { redeemer: router, completeSetsBurnedAttoShares: String(4n), settlementCollateralRedeemedAttoEth: String(4n), resultingShareTokenSupplyAttoShares: String(1000n), resultingSettlementCollateralAttoEth: String(1000n) } },
	{ block: 2, tx: 3, logIndex: 26, emitter: shareToken, name: 'TransferSingle', data: single(router, trader, 1, 6) },
	{ block: 1, tx: 6, logIndex: 50, emitter: shareToken, name: 'TransferSingle', data: single(zero, settler, 1, 2) },
]

// The settlement redemption closes trading, so it is inserted after the open-market valuation is checked.
const settlementLogs: readonly LogFixture[] = [
	{ block: 2, tx: 5, logIndex: 40, emitter: shareToken, name: 'TransferSingle', data: single(settler, zero, 1, 2) },
	{ block: 2, tx: 5, logIndex: 41, emitter: pool, name: 'SharesRedeemed', data: { redeemer: settler, winningSharesBurnedAttoShares: String(2n), settlementCollateralRedeemedAttoEth: String(2n), resultingShareTokenSupplyAttoShares: String(1000n), resultingSettlementCollateralAttoEth: String(1000n) } },
]

const pairLogs: readonly LogFixture[] = [
	{ block: 1, tx: 1, logIndex: 4, emitter: pair, name: 'Transfer', data: { from: zero, to: `0x${'0'.repeat(39)}1`, amount: '1' } },
	{ block: 1, tx: 1, logIndex: 5, emitter: pair, name: 'LiquidityInitialized', data: { provider: router, recipient: liquidityProvider, yesAmount: '100', noAmount: '100', liquidity: '99' } },
	{ block: 1, tx: 1, logIndex: 7, emitter: pair, name: 'Transfer', data: { from: zero, to: liquidityProvider, amount: '99' } },
	{ block: 1, tx: 2, logIndex: 14, emitter: pair, name: 'Swap', data: swap(router, false, false, 10, 6) },
	{ block: 2, tx: 3, logIndex: 23, emitter: pair, name: 'Swap', data: swap(router, true, true, 6, 4) },
	{ block: 2, tx: 4, logIndex: 30, emitter: pair, name: 'Swap', data: swap(swapper, true, false, 3, 2) },
	{ block: 2, tx: 4, logIndex: 31, emitter: pair, name: 'Sync', data: { yesReserve: '1000', noReserve: '1000' } },
]

const blockHashFor = (block: 1 | 2) => (block === 1 ? blocks[0].hash : blocks[1].hash)

test.skipIf(url === undefined)('derives market ETH volume, activity, and account P/L from indexed pool, pair, and share events', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		const tables = await connection`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
		for (const { tablename } of tables) await connection.unsafe(`CREATE TEMP TABLE ${tablename} AS SELECT * FROM public.${tablename} WITH NO DATA`)
		await connection`
			INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash, indexed_timestamp, observed_block, phase)
			VALUES (${chainId}, 'fixture', 'Fixture', 'https://example.invalid', 0, 3, ${blocks[2].hash}, to_timestamp(${now}), 3, 'live')
		`
		for (const block of blocks) await connection`INSERT INTO blocks (chain_id, number, hash, timestamp, canonical) VALUES (${chainId}, ${block.number}, ${block.hash}, to_timestamp(${block.timestamp}), true)`
		await connection`INSERT INTO contracts (chain_id, address, kind, canonical) VALUES (${chainId}, ${shareToken}, 'shareToken', true)`
		await connection`INSERT INTO amm_markets (chain_id, block_hash, tx_hash, log_index, block_number, pair_address, pool_address, share_token_address, universe_id, fee_bps, canonical) VALUES (${chainId}, ${blocks[0].hash}, ${hash(1)}, 0, 1, ${pair}, ${pool}, ${shareToken}, 0, 30, true)`
		await connection`INSERT INTO pools (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, question_id, canonical) VALUES (${chainId}, ${blocks[0].hash}, ${hash(1)}, 0, 1, ${pool}, 42, true)`
		await connection`INSERT INTO questions (chain_id, block_hash, tx_hash, log_index, block_number, question_id, title, end_time, canonical) VALUES (${chainId}, ${blocks[0].hash}, ${hash(1)}, 0, 1, 42, 'Fixture question', ${now + 86_400}, true)`
		const insertLogs = async (items: readonly LogFixture[]) => {
			for (const item of items)
				await connection`
					INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, event_name, arguments, decode_status, canonical)
					VALUES (${chainId}, ${hash(item.tx)}, ${blockHashFor(item.block)}, ${item.block}, ${item.tx}, ${item.logIndex}, ${item.emitter}, ${item.name}, ${JSON.stringify(item.data)}::text::jsonb, 'decoded', true)
				`
			for (const item of items.filter(log => log.emitter === pair))
				await connection`
					INSERT INTO amm_trade_events (chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical)
					VALUES (${chainId}, ${blockHashFor(item.block)}, ${hash(item.tx)}, ${item.logIndex}, ${item.block}, ${pair}, ${item.name}, ${JSON.stringify(item.data)}::text::jsonb, true)
				`
			for (const item of items.filter(log => log.emitter === pool))
				await connection`
					INSERT INTO pool_state_events (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, event_name, state, canonical)
					VALUES (${chainId}, ${blockHashFor(item.block)}, ${hash(item.tx)}, ${item.logIndex}, ${item.block}, ${pool}, ${item.name},
						${JSON.stringify({ shareTokenSupplyAttoShares: item.data['resultingShareTokenSupplyAttoShares'], resultingSettlementCollateralAttoEth: item.data['resultingSettlementCollateralAttoEth'] })}::text::jsonb, true)
				`
		}
		await insertLogs([...poolAndShareLogs, ...pairLogs])
		await connection`INSERT INTO amm_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pair_address, yes_reserve_atto_shares, no_reserve_atto_shares, conditional_yes_bps, conditional_no_bps, canonical) VALUES (${chainId}, ${blocks[1].hash}, ${hash(4)}, 31, 2, ${pair}, 1000, 1000, 5000, 5000, true)`
		const portfolioFor = async (account: string) => {
			const response = await handleApi(new Request(`http://localhost/api/v1/state/address-portfolio?chainId=${chainId}&address=${account}`), connection)
			expect(response?.status).toBe(200)
			return ((await response?.json()) as { data: { trading_pnl: { items: Record<string, unknown>[]; truncated: boolean } } }).data.trading_pnl
		}

		const traderPnl = await portfolioFor(trader)
		expect(traderPnl.truncated).toBe(false)
		// The trader holds 6 INVALID and 6 YES; at 1000/1000 reserves and 30 bps, the largest insured exit is 2 sets at 1 ETH per set.
		expect(traderPnl.items).toEqual([
			expect.objectContaining({
				market_address: pair,
				invalid_atto_shares: '6',
				yes_atto_shares: '6',
				no_atto_shares: '0',
				cost_basis_atto_eth: '10',
				proceeds_atto_eth: '4',
				holdings_value_atto_eth: '2',
				realized_pnl_atto_eth: '0',
				unrealized_pnl_atto_eth: '-4',
				net_pnl_atto_eth: '-4',
				open: true,
				valuation: expect.objectContaining({ status: 'available', partial: true, insured_exit_sets_atto_shares: '2', unvalued_invalid_atto_shares: '4' }),
			}),
		])
		// Removing 99 of 100 LP tokens returns 990 YES and 990 NO, so the 100 INVALID complete 100 sets; 890 YES and NO without INVALID stay unvalued.
		expect((await portfolioFor(liquidityProvider)).items).toEqual([expect.objectContaining({ lp_tokens: '99', cost_basis_atto_eth: '100', holdings_value_atto_eth: '100', net_pnl_atto_eth: '0', valuation: expect.objectContaining({ partial: true, unvalued_yes_atto_shares: '890', unvalued_no_atto_shares: '890' }) })])
		// YES without INVALID cannot exit through the router, so it stays unvalued.
		expect((await portfolioFor(settler)).items).toEqual([expect.objectContaining({ yes_atto_shares: '2', holdings_value_atto_eth: '0', valuation: expect.objectContaining({ partial: true, unvalued_yes_atto_shares: '2' }) })])

		// Indexed lifecycle events newer than the sampled pool read close trading, as does a universe fork.
		const traderValuation = async () => (await portfolioFor(trader)).items[0]?.['valuation']
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical, observed_at) VALUES (${chainId}, 'pool', ${pool}, 1, ${blocks[0].hash}, 'success', ${JSON.stringify({ systemState: '0', awaitingForkContinuation: false, escalationResolved: false })}::text::jsonb, true, now())`
		expect(await traderValuation()).toMatchObject({ status: 'available' })
		await connection`INSERT INTO pool_state_events (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, event_name, state, canonical) VALUES (${chainId}, ${blocks[1].hash}, ${hash(7)}, 60, 2, ${pool}, 'SystemStateSet', ${JSON.stringify({ systemState: '1' })}::text::jsonb, true)`
		expect(await traderValuation()).toEqual({ status: 'unavailable', reason: 'Trading has closed because the pool is not operational' })
		await connection`DELETE FROM pool_state_events WHERE event_name = 'SystemStateSet'`
		await connection`INSERT INTO universe_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_id, event_name, canonical) VALUES (${chainId}, ${blocks[1].hash}, ${hash(8)}, 61, 2, 0, 'UniverseForked', true)`
		expect(await traderValuation()).toEqual({ status: 'unavailable', reason: 'Trading has closed because the universe forked' })
		await connection`DELETE FROM universe_events`

		await insertLogs(settlementLogs)
		const detailResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${chainId}/${pair}`), connection)
		expect(detailResponse?.status).toBe(200)
		const detail = (await detailResponse?.json()) as { data: { summary: Record<string, unknown>; activity: { items: Record<string, unknown>[]; hasMore: boolean } } }
		expect(detail.data.summary).toMatchObject({ eth_volume_atto_eth: '14', eth_volume_24h_atto_eth: '4', eth_volume_7d_atto_eth: '14', eth_trade_count: 2, eth_trade_count_24h: 1 })
		expect(detail.data.activity.hasMore).toBe(false)
		expect(detail.data.activity.items.map(item => [item['kind'], item['side'], item['account'], item['shares'], item['eth_in_atto_eth'], item['eth_out_atto_eth']])).toEqual([
			['settlement', null, settler, '2', '0', '2'],
			['swap', 'NO', swapper, '2', null, null],
			['exit', 'YES', trader, '10', '0', '4'],
			['enter', 'YES', trader, '16', '10', '0'],
			['add-liquidity', null, liquidityProvider, '99', '100', '0'],
		])

		const firstPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${chainId}/${pair}?activityLimit=2`), connection)
		const firstPage = (await firstPageResponse?.json()) as { data: { activity: { items: Record<string, unknown>[]; nextCursor: string } } }
		expect(firstPage.data.activity.items).toHaveLength(2)
		const secondPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${chainId}/${pair}?activityLimit=2&activityCursor=${encodeURIComponent(firstPage.data.activity.nextCursor)}`), connection)
		const secondPage = (await secondPageResponse?.json()) as { data: { activity: { items: Record<string, unknown>[] } } }
		expect(secondPage.data.activity.items.map(item => item['kind'])).toEqual(['exit', 'enter'])
		const eventCursorResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${chainId}/${pair}?cursor=${encodeURIComponent(firstPage.data.activity.nextCursor)}`), connection)
		expect(eventCursorResponse?.status).toBe(400)

		const catalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}`), connection)
		const catalog = (await catalogResponse?.json()) as { data: { items: Record<string, unknown>[] } }
		expect(catalog.data.items[0]).toMatchObject({ pair_address: pair, eth_volume_atto_eth: '14', eth_volume_24h_atto_eth: '4', eth_trade_count: 2 })

		expect((await portfolioFor(settler)).items).toEqual([expect.objectContaining({ cost_basis_atto_eth: '0', proceeds_atto_eth: '2', yes_atto_shares: '0', realized_pnl_atto_eth: '2', open: false })])
		// After settlement the pair no longer trades, so the open position is not valued at stale reserves.
		const closedTrader = (await portfolioFor(trader)).items[0]
		expect(closedTrader).toMatchObject({ realized_pnl_atto_eth: '0', open: true, valuation: { status: 'unavailable', reason: 'Trading has closed because the question resolved' } })
		expect(closedTrader).not.toHaveProperty('holdings_value_atto_eth')
		expect(closedTrader).not.toHaveProperty('net_pnl_atto_eth')
		expect((await portfolioFor(address('9'))).items).toEqual([])
	} finally {
		connection.release()
		await sql.close()
	}
})
