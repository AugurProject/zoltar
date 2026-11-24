import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { decodeOpaqueCursor } from '../../src/cursor-codec.ts'
import { type IndexedBlock, ScannerDatabase } from '../../src/database.ts'
import { zeroAddress } from '../../src/ethereum.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { NetworkConfig } from '../../src/types.ts'
import { address, type BlockHash, blockHash, chainId, discoveredAddress, type IndexerRunSourceHashes, insertIndexerRun, postgresTest, requirePostgresUrl, transaction, transactionHash } from '../support/postgres-fixtures.ts'

type DirectObservationContext = {
	readonly database: ScannerDatabase
	readonly observationChainId: number
	readonly evidenceHash: BlockHash
	readonly network: NetworkConfig
	readonly evidence: IndexedBlock
	readonly initialRun: IndexerRunSourceHashes
	readonly replayRun: IndexerRunSourceHashes
}

postgresTest('source replay restores quiet entity sample anchors only when their block hash agrees', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	await initializeSchema(database.sql)
	const replayChain = chainId + 500
	const network: NetworkConfig = {
		id: 'quiet-sample-replay',
		name: 'Quiet sample replay',
		chainId: replayChain,
		rpcUrls: ['https://example.invalid'],
		startBlock: 1n,
		explorerBaseUrl: '',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [],
	}
	await database.seedNetwork(network)
	const lease = await database.tryAcquireIndexerLock(replayChain)
	if (lease === undefined) throw new Error('Quiet sample writer did not acquire its lock')
	const header = (number: bigint, hash: BlockHash, parentHash: BlockHash): IndexedBlock => ({
		number,
		hash,
		parentHash,
		timestamp: new Date('2026-04-01T00:00:00Z'),
		observedHead: 4n,
		finalizedThrough: 4n,
		contracts: [],
		tokenMetadata: [],
		transactions: [],
		logs: [],
		addressActivity: [],
		contractDeploymentObservations: [],
		logScanCursors: [],
	})
	const first = header(1n, blockHash('quiet-sample-1'), blockHash('quiet-sample-parent'))
	const second = header(2n, blockHash('quiet-sample-2'), first.hash)
	const replacement = header(2n, blockHash('quiet-sample-replaced'), first.hash)
	try {
		for (const block of [first, second]) {
			await database.storeBlock(replayChain, block, lease)
			await database.storeEntityStateSnapshots(replayChain, block.number, block.hash, block.timestamp, [{ entityType: 'pool', entityIdentity: address.toLowerCase(), sourceMethod: 'sample', readStatus: 'success', readResult: { value: block.number.toString() } }], lease)
		}
		await database.seedNetwork(network, { lease, sourceReplayPlan: { reason: 'projection-rebuild', causes: ['projection-rebuild'] } })
		expect(await database.retainedEntitySampleBlocks(replayChain, 1n, 4n, lease)).toEqual([1n, 2n])
		await database.storeBlocks(replayChain, [first, replacement], lease)
		const visible = await database.sql`
			SELECT sample.block_number::text AS number FROM entity_state_snapshots sample
			JOIN blocks block ON block.chain_id = sample.chain_id AND block.hash = sample.block_hash AND block.canonical
			WHERE sample.chain_id = ${replayChain} AND sample.canonical ORDER BY sample.block_number
		`
		expect([...visible]).toEqual([{ number: '1' }])
	} finally {
		await lease.release()
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

// Records successful and failed balance reads from two indexer runs against one canonical block.
const storeInitialObservationAttempts = async ({ database, observationChainId, evidenceHash, evidence, initialRun, replayRun }: DirectObservationContext): Promise<void> => {
	const initialLease = await database.tryAcquireIndexerLock(observationChainId)
	if (initialLease === undefined) throw new Error('direct observation writer did not acquire its initial lock')
	try {
		await database.storeBlock(observationChainId, evidence, initialLease, initialRun)
		await database.storeRichListBalances(observationChainId, 1n, evidenceHash, [{ owner: address, assetAddress: discoveredAddress, assetKind: 'rep', balance: 77n }], initialLease, initialRun)
		await database.storeRichListBalances(
			observationChainId,
			1n,
			evidenceHash,
			[
				{
					owner: address,
					assetAddress: zeroAddress,
					assetKind: 'native',
					readStatus: 'failed',
					readFailureReason: 'HttpRequestError',
				},
				{
					owner: address,
					assetAddress: discoveredAddress,
					assetKind: 'rep',
					readStatus: 'failed',
					readFailureReason: 'ContractFunctionExecutionError',
				},
			],
			initialLease,
			initialRun,
		)
		await database.storeRichListBalances(observationChainId, 1n, evidenceHash, [{ owner: address, assetAddress: discoveredAddress, assetKind: 'rep', balance: 88n }], initialLease, replayRun)
	} finally {
		await initialLease.release()
	}
	const balanceAttempts = await database.sql`
		SELECT read_status, balance::text, read_failure_reason FROM address_balance_observations
		WHERE chain_id = ${observationChainId} ORDER BY id
	`
	expect([...balanceAttempts]).toEqual([
		{ read_status: 'success', balance: '77', read_failure_reason: null },
		{ read_status: 'failed', balance: null, read_failure_reason: 'HttpRequestError' },
		{ read_status: 'failed', balance: null, read_failure_reason: 'ContractFunctionExecutionError' },
		{ read_status: 'success', balance: '88', read_failure_reason: null },
	])
}

// A projection rebuild keeps direct observations canonical while the replay stores new metadata reads.
const replayProjectionWithRetainedObservations = async ({ database, observationChainId, evidenceHash, network, evidence, replayRun }: DirectObservationContext): Promise<void> => {
	const replayLease = await database.tryAcquireIndexerLock(observationChainId)
	if (replayLease === undefined) throw new Error('direct observation writer did not acquire its replay lock')
	try {
		expect(
			await database.seedNetwork(network, {
				lease: replayLease,
				sourceReplayPlan: { reason: 'projection-rebuild', causes: ['projection-rebuild'] },
			}),
		).toBeTrue()
		const retainedDuringReplay = await database.sql`
			SELECT
				(SELECT canonical FROM address_balance_snapshots WHERE chain_id = ${observationChainId}) AS balance_canonical,
				(SELECT canonical FROM token_metadata WHERE chain_id = ${observationChainId}) AS metadata_canonical
		`
		expect(retainedDuringReplay).toEqual([{ balance_canonical: true, metadata_canonical: true }])
		const directReplayEvidence = await database.sql`
			SELECT
				(SELECT count(*)::integer FROM address_balance_observations
					WHERE chain_id = ${observationChainId} AND canonical) AS canonical_balance_attempts,
				(SELECT count(*)::integer FROM token_metadata_observations
					WHERE chain_id = ${observationChainId} AND canonical) AS canonical_metadata_attempts,
				(SELECT count(*)::integer FROM history_invalidation_occurrences occurrence
					JOIN chain_reorganizations invalidation ON invalidation.id = occurrence.invalidation_id
					WHERE invalidation.chain_id = ${observationChainId} AND invalidation.reason = 'projection-rebuild'
						AND occurrence.occurrence_kind IN ('address-balance', 'token-metadata')) AS direct_replay_associations
		`
		expect(directReplayEvidence).toEqual([{ canonical_balance_attempts: 4, canonical_metadata_attempts: 1, direct_replay_associations: 0 }])
		const unavailableDuringReplay = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${observationChainId}&address=${address.toLowerCase()}`), database.sql)
		expect(await unavailableDuringReplay?.json()).toMatchObject({ items: [], total: 0 })

		await database.storeBlock(
			observationChainId,
			{
				...evidence,
				tokenMetadata: [{ address: discoveredAddress, name: 'Replayed REP', symbol: 'RREP', decimals: 17, readBlock: 1n }],
			},
			replayLease,
			replayRun,
		)
		await database.storeBlock(
			observationChainId,
			{
				number: 2n,
				hash: blockHash(`direct-observation-failed-metadata-${observationChainId}`),
				parentHash: evidenceHash,
				timestamp: new Date('2026-03-31T00:00:12Z'),
				observedHead: 2n,
				finalizedThrough: 2n,
				contracts: [],
				tokenMetadata: [{ address: discoveredAddress, readError: 'HttpRequestError', readBlock: 2n }],
				transactions: [],
				logs: [],
				addressActivity: [],
				contractDeploymentObservations: [],
				logScanCursors: [],
			},
			replayLease,
			replayRun,
		)
	} finally {
		await replayLease.release()
	}
}

const expectReplayedObservationsServed = async ({ database, observationChainId }: DirectObservationContext): Promise<void> => {
	expect((await database.tokenMetadata(observationChainId)).get(discoveredAddress.toLowerCase())).toMatchObject({
		name: 'Replayed REP',
		symbol: 'RREP',
		decimals: 17,
		readBlock: 1n,
	})
	const replayedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${observationChainId}&address=${address.toLowerCase()}`), database.sql)
	if (replayedResponse === undefined) throw new Error('direct observation rich-list response was not returned')
	expect(await replayedResponse.json()).toMatchObject({
		total: 1,
		items: [
			expect.objectContaining({
				largest_rep_token_address: discoveredAddress.toLowerCase(),
				largest_rep_balance: '88',
				largest_rep_decimals: 17,
				largest_rep_symbol: 'RREP',
				rep_balances: [expect.objectContaining({ address: discoveredAddress.toLowerCase(), balance: '88', name: 'Replayed REP', symbol: 'RREP', decimals: 17 })],
			}),
		],
	})
}

// Pages through every retained attempt and rejects an impossible cursor offset.
const expectRetainedObservationAudit = async ({ database, observationChainId }: DirectObservationContext): Promise<void> => {
	const firstObservationResponse = await handleApi(new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=all&limit=4`), database.sql)
	if (firstObservationResponse === undefined) throw new Error('direct observation audit response was not returned')
	const firstObservationPage = (await firstObservationResponse.json()) as {
		data: { items: Array<Record<string, unknown>>; totalIsExact: boolean; nextCursor: string }
	}
	expect(firstObservationPage.data.totalIsExact).toBe(false)
	expect(firstObservationPage.data.items).toHaveLength(4)
	const observationCursorParts = decodeOpaqueCursor(firstObservationPage.data.nextCursor)
	if (!Array.isArray(observationCursorParts) || observationCursorParts.length !== 14) throw new Error('direct observation cursor is malformed')
	const overflowingObservationCursor = [...observationCursorParts]
	overflowingObservationCursor[10] = Number.MAX_SAFE_INTEGER
	const overflowingObservationResponse = await handleApi(new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=all&limit=4&cursor=${encodeURIComponent(btoa(JSON.stringify(overflowingObservationCursor)))}`), database.sql)
	expect(overflowingObservationResponse?.status).toBe(400)
	const secondObservationResponse = await handleApi(new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=all&limit=4&cursor=${encodeURIComponent(firstObservationPage.data.nextCursor)}`), database.sql)
	if (secondObservationResponse === undefined) throw new Error('direct observation continuation was not returned')
	const secondObservationPage = (await secondObservationResponse.json()) as { data: { items: Array<Record<string, unknown>>; hasMore: boolean } }
	const retainedAttempts = [...firstObservationPage.data.items, ...secondObservationPage.data.items]
	expect(secondObservationPage.data.hasMore).toBeFalse()
	expect(new Set(retainedAttempts.map(item => `${String(item['observation_kind'])}:${String(item['observation_id'])}`)).size).toBe(7)
	expect(retainedAttempts).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				observation_kind: 'address-balance',
				result: { balance: '77' },
				application_source_hash: 'application-initial',
			}),
			expect.objectContaining({
				observation_kind: 'address-balance',
				read_status: 'failed',
				result: { readFailureReason: 'HttpRequestError' },
				application_source_hash: 'application-initial',
			}),
			expect.objectContaining({
				observation_kind: 'address-balance',
				result: { balance: '88' },
				application_source_hash: 'application-replay',
			}),
			expect.objectContaining({
				observation_kind: 'token-metadata',
				result: expect.objectContaining({ name: 'Observed REP', decimals: 18 }),
				application_source_hash: 'application-initial',
			}),
			expect.objectContaining({
				observation_kind: 'token-metadata',
				read_status: 'failed',
				result: { readError: 'HttpRequestError' },
				application_source_hash: 'application-replay',
			}),
			expect.objectContaining({
				observation_kind: 'token-metadata',
				result: expect.objectContaining({ name: 'Replayed REP', decimals: 17 }),
				application_source_hash: 'application-replay',
			}),
		]),
	)
}

const invalidateObservationsByChainReorg = async ({ database, observationChainId }: DirectObservationContext): Promise<void> => {
	const reorgLease = await database.tryAcquireIndexerLock(observationChainId)
	if (reorgLease === undefined) throw new Error('direct observation writer did not acquire its reorg lock')
	try {
		await database.rewind(observationChainId, -1n, undefined, reorgLease)
	} finally {
		await reorgLease.release()
	}
	const invalidated = await database.sql`
		SELECT
			(SELECT canonical FROM address_balance_snapshots WHERE chain_id = ${observationChainId}) AS balance_canonical,
			(SELECT canonical FROM token_metadata WHERE chain_id = ${observationChainId}) AS metadata_canonical
	`
	expect(invalidated).toEqual([{ balance_canonical: false, metadata_canonical: false }])
	const directOccurrenceKinds = await database.sql`
		SELECT occurrence.occurrence_kind
		FROM history_invalidation_occurrences occurrence
		JOIN chain_reorganizations invalidation ON invalidation.id = occurrence.invalidation_id
		WHERE invalidation.chain_id = ${observationChainId} AND invalidation.reason = 'chain-reorg'
			AND occurrence.occurrence_kind IN ('address-balance', 'token-metadata')
		ORDER BY occurrence.occurrence_kind
	`
	expect(directOccurrenceKinds).toEqual(expect.arrayContaining([{ occurrence_kind: 'address-balance' }, { occurrence_kind: 'token-metadata' }]))
	expect(directOccurrenceKinds).toHaveLength(7)
	const orphanedObservationResponse = await handleApi(new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=orphaned`), database.sql)
	if (orphanedObservationResponse === undefined) throw new Error('orphaned direct observation audit response was not returned')
	const orphanedObservations = (await orphanedObservationResponse.json()) as {
		data: { items: Array<Record<string, unknown>>; totalIsExact: boolean }
	}
	expect(orphanedObservations.data.totalIsExact).toBe(false)
	expect(orphanedObservations.data.items).toHaveLength(7)
	expect(orphanedObservations.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ evidence_status: 'chain-orphaned', invalidation_reason: 'chain-reorg' })]))
}

// Failed reads recorded after the reorg are superseded, not orphaned, by a manifest reset.
const invalidateObservationsByManifestReset = async ({ database, observationChainId, evidenceHash, evidence, replayRun }: DirectObservationContext): Promise<void> => {
	const manifestSourceLease = await database.tryAcquireIndexerLock(observationChainId)
	if (manifestSourceLease === undefined) throw new Error('direct observation manifest fixture did not acquire its writer lock')
	try {
		await database.storeBlock(
			observationChainId,
			{
				...evidence,
				tokenMetadata: [{ address: discoveredAddress, readError: 'HttpRequestError', readBlock: 1n }],
			},
			manifestSourceLease,
			replayRun,
		)
		await database.storeRichListBalances(
			observationChainId,
			1n,
			evidenceHash,
			[
				{
					owner: address,
					assetAddress: zeroAddress,
					assetKind: 'native',
					readStatus: 'failed',
					readFailureReason: 'HttpRequestError',
				},
			],
			manifestSourceLease,
			replayRun,
		)
	} finally {
		await manifestSourceLease.release()
	}
	const manifestResetLease = await database.tryAcquireIndexerLock(observationChainId)
	if (manifestResetLease === undefined) throw new Error('direct observation manifest reset did not acquire its writer lock')
	try {
		await database.rewind(observationChainId, -1n, undefined, manifestResetLease, 'manifest-reset')
	} finally {
		await manifestResetLease.release()
	}
	const manifestOccurrenceKinds = await database.sql`
		SELECT occurrence.occurrence_kind
		FROM history_invalidation_occurrences occurrence
		JOIN chain_reorganizations invalidation ON invalidation.id = occurrence.invalidation_id
		WHERE invalidation.chain_id = ${observationChainId} AND invalidation.reason = 'manifest-reset'
			AND occurrence.occurrence_kind IN ('address-balance', 'token-metadata')
		ORDER BY occurrence.occurrence_kind
	`
	expect(manifestOccurrenceKinds).toEqual([{ occurrence_kind: 'address-balance' }, { occurrence_kind: 'token-metadata' }])
	const storedCounts = await database.sql`SELECT occurrence_counts FROM chain_reorganizations
		WHERE chain_id = ${observationChainId} AND reason = 'manifest-reset' ORDER BY id DESC LIMIT 1`
	expect(storedCounts[0]?.occurrence_counts).toMatchObject({ 'address-balance': '1', 'token-metadata': '1' })
	const manifestObservationResponse = await handleApi(new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=orphaned`), database.sql)
	if (manifestObservationResponse === undefined) throw new Error('manifest-invalidated direct observation audit response was not returned')
	const manifestObservations = (await manifestObservationResponse.json()) as { data: { items: Array<Record<string, unknown>>; totalIsExact: boolean } }
	expect(manifestObservations.data.totalIsExact).toBe(false)
	expect(manifestObservations.data.items).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				observation_kind: 'address-balance',
				read_status: 'failed',
				read_failure_reason: 'HttpRequestError',
				evidence_status: 'manifest-superseded',
				invalidation_reason: 'manifest-reset',
			}),
			expect.objectContaining({
				observation_kind: 'token-metadata',
				read_status: 'failed',
				result: { readError: 'HttpRequestError' },
				evidence_status: 'manifest-superseded',
				invalidation_reason: 'manifest-reset',
			}),
		]),
	)
}

postgresTest(
	'preserves direct retained observations across semantic replay and invalidates them on a chain reorg',
	async () => {
		const database = new ScannerDatabase(requirePostgresUrl())
		const observationChainId = chainId + 90_000 + (process.pid % 100_000)
		const evidenceHash = blockHash(`direct-observation-block-${observationChainId}`)
		const network: NetworkConfig = {
			id: `direct-observation-${observationChainId}`,
			name: 'Direct observation replay fixture',
			chainId: observationChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[discoveredAddress, 'Observed REP', 'reputationToken']],
		}
		const evidence: IndexedBlock = {
			number: 1n,
			hash: evidenceHash,
			parentHash: blockHash(`direct-observation-parent-${observationChainId}`),
			timestamp: new Date('2026-03-31T00:00:00Z'),
			observedHead: 1n,
			finalizedThrough: 1n,
			contracts: [],
			tokenMetadata: [{ address: discoveredAddress, name: 'Observed REP', symbol: 'OREP', decimals: 18, readBlock: 1n }],
			transactions: [{ ...transaction(), receipt: { transactionHash, blockHash: evidenceHash, status: 'success', logs: [] } }],
			logs: [],
			addressActivity: [{ transactionHash, address, role: 'sender' }],
			contractDeploymentObservations: [],
			logScanCursors: [],
		}
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const initialRun = await insertIndexerRun(database, 'initial')
			const replayRun = await insertIndexerRun(database, 'replay')
			const context: DirectObservationContext = { database, observationChainId, evidenceHash, network, evidence, initialRun, replayRun }
			await storeInitialObservationAttempts(context)
			await replayProjectionWithRetainedObservations(context)
			await expectReplayedObservationsServed(context)
			await expectRetainedObservationAudit(context)
			await invalidateObservationsByChainReorg(context)
			await invalidateObservationsByManifestReset(context)
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			await database.close()
		}
	},
	30_000,
)

postgresTest(
	'preserves immutable state observation outcomes across reorg and coverage invalidation',
	async () => {
		const postgresUrl = requirePostgresUrl()
		const database = new ScannerDatabase(postgresUrl)
		const baseChainId = chainId + 95_000 + (process.pid % 100_000)
		try {
			await initializeSchema(database.sql)
			for (const [offset, invalidation] of [
				[0, 'reorg'],
				[1, 'coverage'],
			] as const) {
				const observationChainId = baseChainId + offset
				const evidenceHash = blockHash(`immutable-state-observation-${observationChainId}`)
				const network: NetworkConfig = {
					id: `immutable-state-observation-${observationChainId}`,
					name: 'Immutable state observation fixture',
					chainId: observationChainId,
					rpcUrls: ['https://example.invalid'],
					startBlock: 1n,
					explorerBaseUrl: 'https://example.invalid',
					nativeSymbol: 'ETH',
					confirmationDepth: 0n,
					contracts: [],
				}
				await database.seedNetwork(network)
				const lease = await database.tryAcquireIndexerLock(observationChainId)
				if (lease === undefined) throw new Error('immutable state observation writer did not acquire its lock')
				try {
					const evidence: IndexedBlock = {
						number: 1n,
						hash: evidenceHash,
						parentHash: blockHash(`immutable-state-observation-parent-${observationChainId}`),
						timestamp: new Date('2026-04-01T00:00:00Z'),
						observedHead: 1n,
						finalizedThrough: 1n,
						contracts: [],
						tokenMetadata: [],
						transactions: [],
						logs: [],
						addressActivity: [],
						contractDeploymentObservations: [],
						logScanCursors: [],
					}
					await database.storeBlock(observationChainId, evidence, lease)
					await database.storeEntityStateSnapshots(
						observationChainId,
						1n,
						evidenceHash,
						evidence.timestamp,
						[
							{
								entityType: 'pool',
								entityIdentity: discoveredAddress.toLowerCase(),
								sourceMethod: 'augurscan.immutable-success.v1',
								readStatus: 'success',
								readResult: { observed: 'success-value' },
							},
							{
								entityType: 'pool',
								entityIdentity: address.toLowerCase(),
								sourceMethod: 'augurscan.immutable-failure.v1',
								readStatus: 'failed',
								readFailureReason: 'original failure',
							},
						],
						lease,
					)
					if (invalidation === 'reorg') await database.rewind(observationChainId, -1n, undefined, lease)
					else await database.advanceNetworkStartBlock(observationChainId, 2n, lease)
				} finally {
					await lease.release()
				}
				const observations = await database.sql`
					SELECT source_method, read_status, read_result, read_failure_reason, canonical
					FROM entity_state_observations WHERE chain_id = ${observationChainId}
					ORDER BY id
				`
				expect([...observations]).toEqual([
					{
						source_method: 'augurscan.immutable-success.v1',
						read_status: 'success',
						read_result: { observed: 'success-value' },
						read_failure_reason: null,
						canonical: false,
					},
					{
						source_method: 'augurscan.immutable-failure.v1',
						read_status: 'failed',
						read_result: null,
						read_failure_reason: 'original failure',
						canonical: false,
					},
				])
			}
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			await database.close()
		}
	},
	30_000,
)
