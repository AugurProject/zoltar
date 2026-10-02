import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { ScannerDatabase } from '../../src/database.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { NetworkConfig } from '../../src/types.ts'
import { address, blockHash, chainId, discoveredAddress, postgresTest, promotedAddress, rediscoveredAddress, requirePostgresUrl } from '../support/postgres-fixtures.ts'

postgresTest(
	'reports a historical Operations boundary relative to the current indexed head',
	async () => {
		const postgresUrl = requirePostgresUrl()
		const database = new ScannerDatabase(postgresUrl)
		const historicalChainId = chainId + 10 + process.pid
		const firstHash = blockHash('historical-operations-first')
		const secondHash = blockHash('historical-operations-second')
		const network: NetworkConfig = {
			id: `historical-operations-${historicalChainId}`,
			name: 'Historical Operations integration chain',
			chainId: historicalChainId,
			rpcUrls: ['http://127.0.0.1:8545'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [],
		}
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const lease = await database.tryAcquireIndexerLock(historicalChainId)
			if (lease === undefined) throw new Error('historical Operations integration writer did not acquire its lock')
			try {
				for (const block of [
					{ number: 1n, hash: firstHash, parentHash: blockHash('historical-operations-parent') },
					{ number: 2n, hash: secondHash, parentHash: firstHash },
				])
					await database.storeBlock(
						historicalChainId,
						{
							...block,
							timestamp: new Date(`2026-01-01T00:00:2${block.number}Z`),
							observedHead: 2n,
							finalizedThrough: 2n,
							contracts: [],
							tokenMetadata: [],
							transactions: [],
							logs: [],
							addressActivity: [],
							contractDeploymentObservations: [],
							logScanCursors: [],
						},
						lease,
					)
			} finally {
				await lease.release()
			}
			const firstTransactionHash = blockHash(`historical-operations-transaction-one-${historicalChainId}`)
			const secondTransactionHash = blockHash(`historical-operations-transaction-two-${historicalChainId}`)
			const reportAddress = discoveredAddress.toLowerCase()
			const escalationAddress = promotedAddress.toLowerCase()
			const auctionAddress = rediscoveredAddress.toLowerCase()
			await database.sql`
					INSERT INTO transactions (
						chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address,
						value, input, status, gas_used, receipt, canonical
					) VALUES
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, ${address.toLowerCase()}, ${reportAddress},
							0, '0x', 'success', 21000, '{}'::jsonb, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, ${address.toLowerCase()}, ${reportAddress},
							0, '0x', 'success', 21000, '{}'::jsonb, true)
				`
			await database.sql`
					INSERT INTO logs (
						chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
						topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
					) VALUES
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 0, ${reportAddress}, '[]'::jsonb, '0x',
							'ReportSubmitted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical report', true, true),
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 1, ${escalationAddress}, '[]'::jsonb, '0x',
							'DepositOnOutcome', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical deposit', true, true),
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 2, ${auctionAddress}, '[]'::jsonb, '0x',
							'AuctionStarted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical auction', true, true),
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 3, ${auctionAddress}, '[]'::jsonb, '0x',
							'BidSubmitted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical bid', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 0, ${reportAddress}, '[]'::jsonb, '0x',
							'ReportDisputed', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current report', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 1, ${escalationAddress}, '[]'::jsonb, '0x',
							'DepositOnOutcome', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current deposit', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 2, ${auctionAddress}, '[]'::jsonb, '0x',
							'BidSubmitted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current bid', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 3, ${auctionAddress}, '[]'::jsonb, '0x',
							'AuctionFinalized', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current finalization', true, true)
				`
			await database.sql`
					INSERT INTO open_oracle_report_events (
						chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address,
						report_id, event_name, round_number, report_data, canonical
					) VALUES
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 0, 1, ${reportAddress}, 7, 'ReportSubmitted', 1,
							'{"reportId":"7","numReports":"1","marker":"historical"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 0, 2, ${reportAddress}, 7, 'ReportDisputed', 2,
							'{"reportId":"7","numReports":"2","marker":"current"}'::jsonb, true)
				`
			await database.sql`
					INSERT INTO escalation_game_events (
						chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical
					) VALUES
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 1, 1, ${escalationAddress}, 'DepositOnOutcome',
							'{"outcome":"0","amountAttoRep":"10"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 1, 2, ${escalationAddress}, 'DepositOnOutcome',
							'{"outcome":"0","amountAttoRep":"90"}'::jsonb, true)
				`
			await database.sql`
					INSERT INTO truth_auction_events (
						chain_id, block_hash, tx_hash, log_index, block_number, auction_address, event_name, event_data, canonical
					) VALUES
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 2, 1, ${auctionAddress}, 'AuctionStarted',
							'{"startTimestamp":"1767225600","endTimestamp":"1767229200"}'::jsonb, true),
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 3, 1, ${auctionAddress}, 'BidSubmitted',
							'{"bidder":"0x1000000000000000000000000000000000000001"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 2, 2, ${auctionAddress}, 'BidSubmitted',
							'{"bidder":"0x2000000000000000000000000000000000000002"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 3, 2, ${auctionAddress}, 'AuctionFinalized',
							'{"winningTick":"1"}'::jsonb, true)
				`
			const response = await handleApi(new Request(`http://localhost/api/v1/state/risk?chainId=${historicalChainId}&atBlock=1&limit=1`), database.sql)
			if (response === undefined) throw new Error('historical risk catalog did not return a response')
			expect(await response.json()).toMatchObject({
				asOf: {
					blockNumber: '1',
					indexedHead: '2',
					observedHead: '2',
					historyDepthBlocks: '1',
					lagBlocks: '1',
					historical: true,
				},
			})
			await database.sql`
					INSERT INTO chain_reorganizations
						(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
					VALUES (${historicalChainId}, 2, ${secondHash}, 1, ${firstHash}, 1, 'projection-rebuild')
				`
			const operationsResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${historicalChainId}&atBlock=1`), database.sql)
			if (operationsResponse === undefined) throw new Error('historical Operations endpoint did not return a response')
			const operations = (await operationsResponse.json()) as {
				asOf: {
					blockNumber: string
					blockHash: string
					invalidationId: string
					abiSourceHash: string
					applicationSourceHash: string
					projectionSourceHash: string
				}
				data: {
					reports: Array<Record<string, unknown>>
					escalations: Array<Record<string, unknown>>
					auctions: Array<Record<string, unknown>>
					totals: Record<string, unknown>
				}
			}
			expect(operations.data.reports).toHaveLength(1)
			expect(operations.data.reports[0]).toMatchObject({
				block_number: '1',
				event_name: 'ReportSubmitted',
				round_number: '1',
				observed_rounds: 1,
				report_data: { marker: 'historical' },
			})
			expect(operations.data.escalations).toEqual([expect.objectContaining({ block_number: '1', event_name: 'DepositOnOutcome', invalid_stake_atto_rep: null, balance_read_status: null })])
			expect(operations.data.auctions).toEqual([expect.objectContaining({ block_number: '1', event_name: 'BidSubmitted', bid_count: 1, bidder_count: 1, settlement_count: 0 })])
			expect(operations.data.totals).toMatchObject({ reports: 1, escalations: 1, auctions: 1, reorganizations: 1 })
			const reportCursor = btoa(
				JSON.stringify([historicalChainId, 'reports-catalog', 'catalog', operations.asOf.blockNumber, operations.asOf.blockHash, operations.asOf.invalidationId, operations.asOf.abiSourceHash, operations.asOf.applicationSourceHash, operations.asOf.projectionSourceHash, '1', firstTransactionHash, 0]),
			)
			const crossScopeResponse = await handleApi(new Request(`http://localhost/api/v1/state/escalations?chainId=${historicalChainId}&cursor=${encodeURIComponent(reportCursor)}`), database.sql)
			expect(crossScopeResponse?.status).toBe(400)
			expect(await crossScopeResponse?.json()).toEqual({ error: 'cursor does not match the requested entity' })
			await database.sql`
					INSERT INTO chain_reorganizations
						(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
					VALUES (${historicalChainId}, 2, ${secondHash}, 1, ${firstHash}, 1, 'projection-rebuild')
				`
			const staleGenerationResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports?chainId=${historicalChainId}&cursor=${encodeURIComponent(reportCursor)}`), database.sql)
			expect(staleGenerationResponse?.status).toBe(409)
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			void database.close(0)
		}
	},
	30_000,
)
