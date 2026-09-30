import { describe, expect, test } from 'bun:test'
import { isQuestionStateEntityValue, isRecord } from '../../browser/api-validation.ts'
import { handleApi } from '../../src/api.ts'
import { assertBlockAppend, assertContractDeploymentObservation, assertLogScanCursorUpdate, assertRewindTarget, assertStartBlockCompatible, type IndexedBlock, type IndexerLease, releaseReservedConnection, rewindDepth, ScannerDatabase, scannerDatabaseOptions } from '../../src/database.ts'
import { getAddress } from '../../src/ethereum.ts'
import { decodeAction } from '../../src/metadata.ts'
import { initializeSchema } from '../../src/schema.ts'
import { CURRENT_SCHEMA_VERSION } from '../../src/schema-policy.ts'
import type { NetworkConfig } from '../../src/types.ts'
import { address, blockHash, chainId, decodedLog, indexedBlock, log, pairAddress, postgresTest, rediscoveredAddress, requirePostgresUrl, transaction, transactionHash, uniswapPairAddress, wethAddress } from '../support/postgres-fixtures.ts'

describe('database checkpoint fencing', () => {
	test('keeps reserved advisory-lock sessions alive between RPC operations', () => {
		expect(scannerDatabaseOptions(10, 5)).toEqual({
			max: 10,
			idleTimeout: 0,
			maxLifetime: 0,
			connectionTimeout: 5,
		})
	})

	test('waits for asynchronous reserved connection release', async () => {
		let finishRelease: (() => void) | undefined
		let settled = false
		const release = releaseReservedConnection({
			release: () =>
				new Promise<void>(resolve => {
					finishRelease = resolve
				}),
		}).then(() => {
			settled = true
		})

		await Promise.resolve()
		expect(settled).toBe(false)
		finishRelease?.()
		await release
		expect(settled).toBe(true)
	})

	test('measures a full rewind from the configured history boundary', () => {
		expect(rewindDepth(1_250n, 1_000n, -1n)).toBe(251n)
		expect(rewindDepth(1_250n, 1_000n, 1_200n)).toBe(50n)
	})

	test('accepts sparse canonical checkpoints and still fences direct children', () => {
		const parentHash = blockHash('parent')
		const otherHash = blockHash('other')
		expect(() => assertBlockAppend({ number: 10n, parentHash }, { startBlock: 10n })).not.toThrow()
		expect(() => assertBlockAppend({ number: 10n, parentHash }, { startBlock: 10n, indexedHash: parentHash })).toThrow('block hash without a block number')
		expect(() => assertBlockAppend({ number: 9n, parentHash }, { startBlock: 10n })).toThrow('starts at block 10')
		expect(() => assertBlockAppend({ number: 11n, parentHash }, { startBlock: 10n })).not.toThrow()
		expect(() => assertBlockAppend({ number: 11n, parentHash }, { startBlock: 10n, indexedBlock: 10n, indexedHash: parentHash })).not.toThrow()
		expect(() => assertBlockAppend({ number: 12n, parentHash }, { startBlock: 10n, indexedBlock: 10n, indexedHash: parentHash })).not.toThrow()
		expect(() => assertBlockAppend({ number: 10n, parentHash }, { startBlock: 10n, indexedBlock: 10n, indexedHash: parentHash })).toThrow('already block 10')
		expect(() => assertBlockAppend({ number: 11n, parentHash: otherHash }, { startBlock: 10n, indexedBlock: 10n, indexedHash: parentHash })).toThrow('does not extend the current database checkpoint')
	})

	test('persists a log dataset cursor only at the block committed with it', () => {
		const cursor = { contractAddress: address, startBlock: 10n, lastRetrievedBlock: 25n }
		expect(() => assertLogScanCursorUpdate(25n, cursor)).not.toThrow()
		expect(() => assertLogScanCursorUpdate(24n, cursor)).toThrow('must advance to committed block 24')
		expect(() => assertLogScanCursorUpdate(25n, { ...cursor, startBlock: 26n })).toThrow('invalid retrieval boundary')
	})

	test('anchors deployment observations to their committing block', () => {
		expect(() => assertContractDeploymentObservation(10n, { contractAddress: address, checkedBlock: 9n })).toThrow('must be anchored to committed block 10')
		expect(() =>
			assertContractDeploymentObservation(10n, {
				contractAddress: address,
				checkedBlock: 10n,
				deployment: { block: 11n, timestamp: new Date(0), exact: true },
			}),
		).toThrow('invalid deployment boundary')
	})

	test('rejects changing the configured start boundary after indexing has begun', () => {
		expect(() => assertStartBlockCompatible(100n, 100n, 125n)).not.toThrow()
		expect(() => assertStartBlockCompatible(200n, 100n, undefined)).not.toThrow()
		expect(() => assertStartBlockCompatible(200n, 200n, 125n)).toThrow('Stored checkpoint 125 is below configured start block 200; rebuild the augurScan database from the configured start block')
		expect(() => assertStartBlockCompatible(200n, 100n, 125n)).toThrow('Cannot change the configured start block from 100 to 200 while checkpoint 125 exists; rebuild the augurScan database from the new start block')
		expect(() => assertStartBlockCompatible(100n, 75n, undefined, true)).toThrow('while an effective index start is retained')
	})

	test('accepts only a prior canonical rewind target', () => {
		const hash = blockHash('ancestor')
		const checkpoint = { indexedBlock: 11n, indexedHash: blockHash('head') }
		expect(() => assertRewindTarget(10n, hash, checkpoint, true)).not.toThrow()
		expect(() => assertRewindTarget(-1n, undefined, checkpoint, false)).not.toThrow()
		expect(() => assertRewindTarget(11n, hash, checkpoint, true)).toThrow('must precede')
		expect(() => assertRewindTarget(10n, hash, checkpoint, false)).toThrow('not a canonical stored block')
		expect(() => assertRewindTarget(-1n, hash, checkpoint, false)).toThrow('must not specify an ancestor hash')
		expect(() => assertRewindTarget(10n, hash, { indexedBlock: 11n }, true)).toThrow('complete indexed checkpoint')
	})
})

postgresTest('rolls back every sparse batch table when final canonical validation fails', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const sparseChainId = chainId + 10_000 + process.pid
	const network = {
		id: `sparse-atomic-${sparseChainId}`,
		name: 'Sparse atomic fixture',
		chainId: sparseChainId,
		rpcUrls: ['http://127.0.0.1:8545'],
		startBlock: 1n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [],
	} satisfies NetworkConfig
	let lease: IndexerLease | undefined
	try {
		await initializeSchema(database.sql)
		await database.seedNetwork(network)
		lease = await database.tryAcquireIndexerLock(sparseChainId)
		if (lease === undefined) throw new Error('sparse atomic writer did not acquire its lock')
		const first = indexedBlock('block-one', blockHash('sparse-genesis'), [], 'first sparse log')
		const second = {
			...indexedBlock('block-two', first.hash),
			logScanCursors: [{ contractAddress: address, startBlock: 1n, lastRetrievedBlock: 2n }],
		}
		const liveEventsBefore = await database.sql`SELECT count(*)::integer AS count FROM live_events`

		await expect(
			database.storeBlocks(sparseChainId, [first, second], lease, undefined, async () => {
				throw new Error('canonical anchor changed')
			}),
		).rejects.toThrow('canonical anchor changed')

		for (const table of ['blocks', 'transactions', 'logs', 'log_scan_cursors'] as const) {
			const rows = await database.sql.unsafe(`SELECT count(*)::integer AS count FROM ${table} WHERE chain_id = $1`, [sparseChainId])
			expect(rows[0]?.['count']).toBe(0)
		}
		const failedCheckpoint = await database.sql`SELECT indexed_block, indexed_hash FROM networks WHERE chain_id = ${sparseChainId}`
		expect(failedCheckpoint[0]).toMatchObject({ indexed_block: null, indexed_hash: null })
		const liveEventsAfterFailure = await database.sql`SELECT count(*)::integer AS count FROM live_events`
		expect(liveEventsAfterFailure[0]?.['count']).toBe(liveEventsBefore[0]?.['count'])

		await database.storeBlocks(sparseChainId, [first, second], lease)
		expect((await database.sql`SELECT number FROM blocks WHERE chain_id = ${sparseChainId} ORDER BY number`).map((row: Record<string, unknown>) => String(row['number']))).toEqual(['1', '2'])
		expect(await database.checkpoint(sparseChainId, lease)).toEqual({ number: 2n, hash: second.hash })
	} finally {
		await lease?.release()
		await database.sql`DELETE FROM actions WHERE chain_id = ${sparseChainId}`
		await database.sql`DELETE FROM logs WHERE chain_id = ${sparseChainId}`
		await database.sql`DELETE FROM transactions WHERE chain_id = ${sparseChainId}`
		await database.sql`DELETE FROM log_scan_cursors WHERE chain_id = ${sparseChainId}`
		await database.sql`DELETE FROM blocks WHERE chain_id = ${sparseChainId}`
		await database.sql`DELETE FROM networks WHERE chain_id = ${sparseChainId}`
		await database.sql`DELETE FROM live_events WHERE payload ->> 'chainId' = ${sparseChainId.toString()}`
		await database.close()
	}
})

postgresTest(
	'does not rewrite rows that were already finalized',
	async () => {
		const postgresUrl = requirePostgresUrl()
		const database = new ScannerDatabase(postgresUrl)
		const finalizationChainId = chainId + 205_000 + (process.pid % 100_000)
		const firstHash = blockHash(`finalization-first-${finalizationChainId}`)
		const secondHash = blockHash(`finalization-second-${finalizationChainId}`)
		const network: NetworkConfig = {
			id: `finalization-${finalizationChainId}`,
			name: 'Finalization write fixture',
			chainId: finalizationChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [],
		}
		const indexed = (number: 1n | 2n, hash: ReturnType<typeof blockHash>, parentHash: ReturnType<typeof blockHash>): IndexedBlock => ({
			number,
			hash,
			parentHash,
			timestamp: new Date(`2026-04-0${number}T00:00:00Z`),
			observedHead: 2n,
			finalizedThrough: number,
			contracts: [],
			tokenMetadata: [],
			addressActivity: [],
			contractDeploymentObservations: [],
			logScanCursors: [],
			transactions: number === 1n ? [{ ...transaction(), receipt: { transactionHash, blockHash: hash, status: 'success', logs: [] } }] : [],
			logs: number === 1n ? [{ ...log(hash, `finalized evidence at ${number}`), blockNumber: number }] : [],
		})
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const lease = await database.tryAcquireIndexerLock(finalizationChainId)
			if (lease === undefined) throw new Error('finalization writer did not acquire its lock')
			try {
				await database.storeBlock(finalizationChainId, indexed(1n, firstHash, blockHash(`finalization-parent-${finalizationChainId}`)), lease)
				const before = await database.sql`
					SELECT
						(SELECT ctid::text FROM blocks WHERE chain_id = ${finalizationChainId} AND hash = ${firstHash}) AS block_ctid,
						(SELECT ctid::text FROM logs WHERE chain_id = ${finalizationChainId} AND block_hash = ${firstHash}) AS log_ctid
				`
				await database.storeBlock(finalizationChainId, indexed(2n, secondHash, firstHash), lease)
				const after = await database.sql`
					SELECT
						(SELECT ctid::text FROM blocks WHERE chain_id = ${finalizationChainId} AND hash = ${firstHash}) AS block_ctid,
						(SELECT ctid::text FROM logs WHERE chain_id = ${finalizationChainId} AND block_hash = ${firstHash}) AS log_ctid
				`
				expect(after).toEqual(before)
			} finally {
				await lease.release()
			}
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			void database.close(0)
		}
	},
	30_000,
)

postgresTest('returns the originating transaction action on every log row', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const actionChainId = chainId + 200_000 + process.pid
	const proxy = { address: getAddress('0x7a0d94f55792c434d74a40883c6ed8545e406d12'), label: 'Proxy Deployer', kind: 'proxyDeployer', provenance: 'manifest' }
	const created = getAddress('0x7D6c6809d80965f5eeE276E86A8A0cDF473E5B47')
	const input = '0x60a0604052'
	const decoded = decodeAction(proxy, input, new Map([[created.toLowerCase(), 'Known deployment']]))
	const evidenceHash = blockHash(`log-action-one-${actionChainId}`)
	let lease: IndexerLease | undefined
	try {
		await initializeSchema(database.sql)
		await database.seedNetwork({
			id: `log-action-${actionChainId}`,
			name: 'Log action fixture',
			chainId: actionChainId,
			rpcUrls: ['http://127.0.0.1:8545'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [
				[proxy.address, proxy.label, proxy.kind],
				[created, 'Known deployment', 'zoltar'],
			],
		})
		lease = await database.tryAcquireIndexerLock(actionChainId)
		if (lease === undefined) throw new Error('Log action fixture did not acquire its lock')
		await database.storeBlock(
			actionChainId,
			{
				...indexedBlock('log-action-one', blockHash('log-action-parent')),
				hash: evidenceHash,
				transactions: [{ ...transaction(), to: proxy.address, input, decoded }],
				logs: [0, 1].map(logIndex => ({ ...log(evidenceHash, 'Constructor event'), address: created, blockNumber: 1n, logIndex })),
			},
			lease,
		)
		const response = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${actionChainId}`), database.sql)
		expect(response?.status).toBe(200)
		const payload = await response?.json()
		if (!isRecord(payload) || !Array.isArray(payload['items'])) throw new Error('Log action response has no items')
		expect(payload['items']).toHaveLength(2)
		for (const row of payload['items']) {
			if (!isRecord(row)) throw new Error('Log action response contains an invalid row')
			expect(row['function_name']).toBe('deploy')
			expect(row['action_summary']).toBe('Deploy Known deployment via Proxy Deployer')
			expect(row['to_address']).toBe(proxy.address.toLowerCase())
			expect(row['contract_label']).toBe('Known deployment')
		}
	} finally {
		await lease?.release()
		for (const table of ['actions', 'logs', 'transactions', 'contracts', 'blocks', 'networks']) await database.sql.unsafe(`DELETE FROM ${table} WHERE chain_id = $1`, [actionChainId])
		await database.sql`DELETE FROM live_events WHERE payload ->> 'chainId' = ${String(actionChainId)}`
		await database.close()
	}
})

for (const scenario of ['question seconds', 'receipt discovery order'] as const) {
	postgresTest(`persists ${scenario} atomically and advances the checkpoint`, async () => {
		const postgresUrl = requirePostgresUrl()
		const database = new ScannerDatabase(postgresUrl)
		const fixtureChain = chainId + 80_000 + process.pid
		let lease: IndexerLease | undefined
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork({
				id: `regression-${fixtureChain}`,
				name: 'Regression',
				chainId: fixtureChain,
				rpcUrls: [],
				startBlock: 2n,
				explorerBaseUrl: '',
				nativeSymbol: 'ETH',
				confirmationDepth: 0n,
				contracts: [
					[rediscoveredAddress, 'REP', 'reputationToken'],
					[wethAddress, 'WETH', 'weth'],
				],
			})
			lease = await database.tryAcquireIndexerLock(fixtureChain)
			if (lease === undefined) throw new Error('Missing writer lease')
			const block = indexedBlock('regression-two', blockHash('regression-parent'), [], 'regression')
			const questionLogs = ['0', '8640000000000', '8640000000001', '281474976710655'].map((seconds, index) =>
				decodedLog(block.hash, index, address, 'QuestionCreated', {
					questionId: String(index),
					createdTimestamp: '1767225600',
					outcomeOptions: [],
					questionData: { title: 'Exact question', description: '', startTime: seconds, endTime: seconds, numTicks: '100', displayValueMin: '0', displayValueMax: '100', answerUnit: '' },
				}),
			)
			const creation = decodedLog(block.hash, 1, address, 'PoolCreated', { token0: rediscoveredAddress, token1: wethAddress, pool: uniswapPairAddress, fee: '3000', tickSpacing: '60' })
			const initialize = decodedLog(block.hash, 2, uniswapPairAddress, 'Initialize', { sqrtPriceX96: '79228162514264337593543950336' })
			const swap = decodedLog(block.hash, 3, uniswapPairAddress, 'Swap', { sqrtPriceX96: '79228162514264337593543950337', liquidity: '100' })
			const unsupported = decodedLog(block.hash, 4, pairAddress, 'Initialize', { sqrtPriceX96: '79228162514264337593543950336' })
			const evidence = { ...block, logs: scenario === 'question seconds' ? questionLogs : [swap, initialize, unsupported, creation, creation] }
			await expect(
				database.storeBlocks(fixtureChain, [evidence], lease, undefined, async () => {
					throw new Error('canonical anchor changed')
				}),
			).rejects.toThrow('canonical anchor changed')
			expect(await database.checkpoint(fixtureChain, lease)).toBeUndefined()
			expect((await database.sql`SELECT count(*)::int AS count FROM logs WHERE chain_id = ${fixtureChain}`)[0]?.['count']).toBe(0)
			await database.storeBlock(fixtureChain, evidence, lease)
			expect(await database.checkpoint(fixtureChain, lease)).toEqual({ number: 2n, hash: block.hash })
			if (scenario === 'question seconds') {
				const rows = await database.sql`SELECT start_time::text, end_time::text FROM questions WHERE chain_id = ${fixtureChain} ORDER BY question_id`
				expect(rows).toEqual(['0', '8640000000000', '8640000000001', '281474976710655'].map(seconds => ({ start_time: seconds, end_time: seconds })))
				const response = await handleApi(new Request(`http://localhost/api/v1/state/catalog?chainId=${fixtureChain}`), database.sql)
				if (response === undefined) throw new Error('Missing state response')
				const body: unknown = await response.json()
				if (!isRecord(body) || !Array.isArray(body['questions'])) throw new Error('Missing questions')
				const catalogVersion = body['catalogVersion']
				expect(catalogVersion).toMatch(/^[0-9a-f]{32}$/)
				expect(body['questions'].every(isQuestionStateEntityValue)).toBe(true)
				expect(body['questions']).toContainEqual(expect.objectContaining({ start_time: '281474976710655', end_time: '281474976710655' }))
				await database.sql`UPDATE questions SET title = title || ' revised' WHERE chain_id = ${fixtureChain} AND question_id = 0`
				const changedResponse = await handleApi(new Request(`http://localhost/api/v1/state/catalog?chainId=${fixtureChain}`), database.sql)
				if (changedResponse === undefined) throw new Error('Missing changed state response')
				const changedBody: unknown = await changedResponse.json()
				if (!isRecord(changedBody)) throw new Error('Missing changed state catalog')
				expect(changedBody['catalogVersion']).not.toBe(catalogVersion)
				await database.sql`UPDATE questions SET title = 'Exact_% question' WHERE chain_id = ${fixtureChain} AND question_id = 0`
				for (const path of ['search', 'state/catalog']) {
					for (const [query, expected] of [
						['__', 0],
						['%%', 0],
						['_%', 1],
					] as const) {
						const filteredResponse = await handleApi(new Request(`http://localhost/api/v1/${path}?chainId=${fixtureChain}&q=${encodeURIComponent(query)}`), database.sql)
						if (filteredResponse === undefined) throw new Error(`Missing ${path} search response`)
						const filteredBody: unknown = await filteredResponse.json()
						if (!isRecord(filteredBody)) throw new Error(`Malformed ${path} search response`)
						const matches = path === 'search' ? filteredBody['items'] : filteredBody['questions']
						expect(Array.isArray(matches) ? matches.length : -1).toBe(expected)
					}
				}
				await database.sql`UPDATE questions SET title = 'Exact question' WHERE chain_id = ${fixtureChain} AND question_id = 0`
				await database.sql`DELETE FROM questions WHERE chain_id = ${fixtureChain} AND question_id <> 0`
				await database.sql`UPDATE questions SET start_time = 1767225600, end_time = 8640000000000, canonical = false WHERE chain_id = ${fixtureChain}`
				await database.sql.unsafe('ALTER TABLE questions ALTER COLUMN start_time TYPE timestamptz USING to_timestamp(start_time), ALTER COLUMN end_time TYPE timestamptz USING to_timestamp(end_time)')
				await database.sql`DELETE FROM augurscan_schema_migrations WHERE schema_version = ${CURRENT_SCHEMA_VERSION}`
				await database.sql`UPDATE augurscan_schema SET schema_version = '3' WHERE singleton`
				await initializeSchema(database.sql)
				const migratedQuestions = await database.sql`SELECT start_time::text, end_time::text, canonical FROM questions WHERE chain_id = ${fixtureChain}`
				expect(migratedQuestions).toEqual([{ start_time: '1767225600', end_time: '8640000000000', canonical: false }])
				await initializeSchema(database.sql)
			} else {
				const rows = await database.sql`SELECT event_name FROM uniswap_rep_eth_price_observations WHERE chain_id = ${fixtureChain} AND canonical ORDER BY log_index`
				expect(rows).toEqual([{ event_name: 'Initialize' }, { event_name: 'Swap' }])
			}
		} finally {
			await lease?.release()
			for (const table of ['questions', 'uniswap_rep_eth_price_observations', 'uniswap_rep_eth_markets', 'protocol_timeline_entries', 'actions', 'logs', 'transactions', 'blocks', 'contracts', 'networks']) await database.sql.unsafe(`DELETE FROM ${table} WHERE chain_id = $1`, [fixtureChain])
			await database.close()
		}
	})
}
