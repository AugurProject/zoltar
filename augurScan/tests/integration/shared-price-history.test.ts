import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { poolStateHistory } from '../../src/repositories/state-history.ts'
import { initializeSchema } from '../../src/schema.ts'

const postgresUrl = process.env['POSTGRES_TEST_URL']

test.skipIf(postgresUrl === undefined)('member ledgers share canonical feed history and retain separate question state histories', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(postgresUrl)
	try {
		await initializeSchema(sql)
		const connection = await sql.reserve()
		try {
			await connection`CREATE TEMP TABLE pools (LIKE public.pools INCLUDING DEFAULTS)`
			await connection`CREATE TEMP TABLE blocks (LIKE public.blocks INCLUDING DEFAULTS)`
			await connection`CREATE TEMP TABLE logs (LIKE public.logs INCLUDING DEFAULTS)`
			await connection`CREATE TEMP TABLE rep_eth_price_snapshots (LIKE public.rep_eth_price_snapshots INCLUDING DEFAULTS)`
			await connection`CREATE TEMP TABLE pool_state_events (LIKE public.pool_state_events INCLUDING DEFAULTS)`
			const chainId = 399_951
			const blockHash = `0x${'ab'.repeat(32)}`
			const address = (digit: string) => `0x${digit.repeat(40)}`
			const poolA = address('1')
			const poolB = address('2')
			const standalonePool = address('3')
			const standaloneFeed = address('6')
			const feed = address('7')
			const orphanFeed = address('8')
			await connection`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp) VALUES (${chainId}, 10, ${blockHash}, ${blockHash}, now())`
			for (const [pool, priceFeed, canonical] of [
				[poolA, feed, true],
				[poolB, feed, true],
				[standalonePool, standaloneFeed, true],
				[poolA, orphanFeed, false],
			]) {
				await connection`INSERT INTO pools (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address, universe_id, question_id, coordinator_address, share_token_address, security_multiplier_bps, initial_priority_fee_atto_eth_per_gas, canonical)
					VALUES (${chainId}, ${blockHash}, ${blockHash}, 0, 10, ${pool}, ${pool}, 0, 1, ${priceFeed}, ${pool}, 15000, 1, ${canonical})`
			}
			for (const [index, emitter, name, args, canonical] of [
				[4, feed, 'PriceReported', { reportId: '1', price: '100' }, true],
				[5, feed, 'ExposureCheckpoint', { questionLedger: poolA, aggregateExposureAttoEth: 200n.toString() }, true],
				[6, standaloneFeed, 'PriceReported', { reportId: '2', price: '200' }, true],
			] as const) {
				await connection`INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, event_name, arguments, decode_status, summary, canonical)
					VALUES (${chainId}, ${blockHash}, ${blockHash}, 10, 0, ${index}, ${emitter}, '[]', '0x', ${name}, (${JSON.stringify(args)}::text)::jsonb, 'decoded', ${name}, ${canonical})`
			}
			for (const [index, source, price, canonical] of [
				[4, feed, '100', true],
				[6, standaloneFeed, '200', true],
				[7, orphanFeed, '999', true],
				[8, feed, '999', false],
			] as const) {
				await connection`INSERT INTO rep_eth_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, coordinator_address, event_name, report_id, rep_per_eth_1e18, settlement_timestamp, canonical)
					VALUES (${chainId}, ${blockHash}, ${blockHash}, ${index}, 10, ${source}, 'PriceReported', ${index}, ${price}, now(), ${canonical})`
			}
			for (const [pool, settlementCollateralAttoEth] of [
				[poolA, '11'],
				[poolB, '22'],
			]) {
				await connection`INSERT INTO pool_state_events (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, event_name, state)
					VALUES (${chainId}, ${blockHash}, ${blockHash}, 9, 10, ${pool}, 'CompleteSetCreated', (${JSON.stringify({ resultingSettlementCollateralAttoEth: settlementCollateralAttoEth })}::text)::jsonb)`
			}
			const query = { chainId, fromBlock: '0', toBlock: '10', queryLimit: 20, offset: 0 }
			const historyA = await poolStateHistory(connection, poolA, query)
			const historyB = await poolStateHistory(connection, poolB, query)
			const ordinary = await poolStateHistory(connection, standalonePool, query)
			for (const history of [historyA, historyB]) {
				expect(history.repEthPrices).toHaveLength(1)
				expect(history.repEthPrices[0]).toMatchObject({ coordinator_address: feed, rep_per_eth_1e18: '100' })
				expect(history.openOracleHistory.filter((row: { event_name: string }) => row.event_name === 'PriceReported')).toHaveLength(1)
				expect(history.openOracleHistory.filter((row: { event_name: string }) => row.event_name === 'ExposureCheckpoint')).toHaveLength(1)
			}
			expect(historyA.events).toHaveLength(1)
			expect(historyA.events[0]).toMatchObject({ pool_address: poolA, state: { resultingSettlementCollateralAttoEth: 11n.toString() } })
			expect(historyB.events).toHaveLength(1)
			expect(historyB.events[0]).toMatchObject({ pool_address: poolB, state: { resultingSettlementCollateralAttoEth: 22n.toString() } })
			expect(ordinary.repEthPrices).toHaveLength(1)
			expect(ordinary.repEthPrices[0]).toMatchObject({ coordinator_address: standaloneFeed, rep_per_eth_1e18: '200' })
			expect(ordinary.openOracleHistory).toHaveLength(1)
		} finally {
			await connection`DROP TABLE IF EXISTS pg_temp.pool_state_events, pg_temp.rep_eth_price_snapshots, pg_temp.logs, pg_temp.pools, pg_temp.blocks`
			connection.release()
		}
	} finally {
		await sql.close()
	}
})
