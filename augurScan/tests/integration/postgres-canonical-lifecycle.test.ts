import { expect } from 'bun:test'
import { assertStartBlockCompatible, lockLiveEventWriter, ScannerDatabase } from '../../src/database.ts'
import type { Address } from '../../src/ethereum.ts'
import { createLiveBus } from '../../src/live.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { NetworkConfig } from '../../src/types.ts'
import { expectAddressInteractionsAndActions, expectAddressTransactionSnapshots, expectCappedRepBalances, expectLargeRichListSnapshotPages, expectRepRankingWithRefreshedBalances, expectRichListProfiles, seedAddressActivity } from '../support/canonical-lifecycle-accounts.ts'
import { expectCanonicalLogPagination, expectGenerationBoundCatalogCursors, expectLogExportsAndDetails, expectRunProvenancePagination } from '../support/canonical-lifecycle-api.ts'
import { expectReplacementPoolHistory, expectRepeatableReadSnapshots, type LifecycleChain, type LifecycleContext, reconcileManifestAfterReorg, storeAndRewindOrphan, storeFirstBlock, storeReplacementBlock, storeThirdBlockWithV4Markets } from '../support/canonical-lifecycle-chain.ts'
import { address, chainId, postgresTest, requirePostgresUrl, transactionHash } from '../support/postgres-fixtures.ts'

const network: NetworkConfig = {
	id: 'integration',
	name: 'Integration chain',
	chainId,
	rpcUrls: ['http://127.0.0.1:8545'],
	startBlock: 1n,
	explorerBaseUrl: 'https://example.invalid',
	nativeSymbol: 'ETH',
	confirmationDepth: 8n,
	contracts: [[address, 'Manifest contract', 'zoltar']],
}

// Concurrent migrators converge, live-event writers serialize, and expired replay windows reset clients.
const expectSerializedLiveEvents = async ({ postgresUrl, database }: LifecycleContext): Promise<void> => {
	await initializeSchema(database.sql)
	const concurrentMigrator = new ScannerDatabase(postgresUrl)
	try {
		await Promise.all([initializeSchema(database.sql), initializeSchema(concurrentMigrator.sql)])
		await initializeSchema(concurrentMigrator.sql)
	} finally {
		await concurrentMigrator.close()
	}
	await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
	await database.sql.unsafe('TRUNCATE TABLE live_events RESTART IDENTITY')
	await database.sql`UPDATE live_event_state SET pruned_through_id = 0, updated_at = now() WHERE singleton`
	const concurrentWriter = new ScannerDatabase(postgresUrl)
	try {
		let firstLocked: (() => void) | undefined
		let releaseFirst: (() => void) | undefined
		const locked = new Promise<void>(resolve => {
			firstLocked = resolve
		})
		const release = new Promise<void>(resolve => {
			releaseFirst = resolve
		})
		const firstWrite = database.sql.begin(async transaction => {
			await lockLiveEventWriter(transaction)
			const rows = await transaction`INSERT INTO live_events (event, payload) VALUES ('status', '{"writer":1}'::jsonb) RETURNING id`
			firstLocked?.()
			await release
			return Number(rows[0]?.['id'])
		})
		await locked
		let secondInserted = false
		const secondWrite = concurrentWriter.sql.begin(async transaction => {
			await lockLiveEventWriter(transaction)
			const rows = await transaction`INSERT INTO live_events (event, payload) VALUES ('status', '{"writer":2}'::jsonb) RETURNING id`
			secondInserted = true
			return Number(rows[0]?.['id'])
		})
		await Bun.sleep(25)
		expect(secondInserted).toBe(false)
		releaseFirst?.()
		expect(await Promise.all([firstWrite, secondWrite])).toEqual([1, 2])
	} finally {
		await concurrentWriter.close()
	}
	await database.sql.unsafe('TRUNCATE TABLE live_events RESTART IDENTITY')
	await database.sql`INSERT INTO live_events (event, payload, created_at) VALUES ('status', '{}'::jsonb, now() - interval '8 days')`
	await database.pruneLiveEvents()
	expect(await database.latestEventId()).toBe(1)
	expect(await database.eventsAfter(0)).toEqual([{ id: 1, event: 'reset', payload: { reason: 'replay-window-expired', refreshRequired: true } }])
	expect(await database.eventsAfter(2)).toEqual([{ id: 1, event: 'reset', payload: { reason: 'cursor-ahead-of-head', refreshRequired: true } }])
	const requestedLiveCursors: number[] = []
	const liveBus = createLiveBus({
		latestEventId: async () => await database.latestEventId(),
		eventsAfter: async id => {
			requestedLiveCursors.push(id)
			return await database.eventsAfter(id)
		},
	})
	const liveStream = liveBus.stream()
	if (liveStream === undefined) throw new Error('Expected live stream capacity')
	const liveReader = liveStream.getReader()
	await liveReader.read()
	await liveBus.poll()
	expect(requestedLiveCursors).toEqual([1])
	await liveBus.close()
	expect(await liveReader.read()).toEqual({ done: true, value: undefined })
}

// The stored start boundary is retained, and the advisory-lock lease is exclusive and exact-keyed.
const expectStartBoundaryAndLeaseExclusivity = async ({ postgresUrl, database }: LifecycleContext): Promise<void> => {
	expect(await database.seedNetwork(network)).toBe(false)
	expect(await database.networkStartBlock(chainId)).toBe(1n)
	await expect(database.seedNetwork({ ...network, startBlock: 3n }, { preserveStoredStart: true })).rejects.toThrow('while an effective index start is retained')
	expect(await database.networkStartBlock(chainId)).toBe(1n)
	const zeroBoundaryNetwork = { ...network, id: 'zero-boundary', chainId: chainId + 1, startBlock: 0n }
	expect(await database.seedNetwork(zeroBoundaryNetwork)).toBe(false)
	await expect(database.seedNetwork({ ...zeroBoundaryNetwork, startBlock: 100n }, { preserveStoredStart: true })).rejects.toThrow('while an effective index start is retained')
	expect(await database.networkStartBlock(zeroBoundaryNetwork.chainId)).toBe(0n)
	const contender = new ScannerDatabase(postgresUrl)
	try {
		const lease = await database.tryAcquireIndexerLock(chainId)
		if (lease === undefined) throw new Error('first indexer did not acquire its lock')
		await lease.assertHeld()
		expect(await contender.tryAcquireIndexerLock(chainId)).toBeUndefined()
		await lease.release()
		const contenderLease = await contender.tryAcquireIndexerLock(chainId)
		if (contenderLease === undefined) throw new Error('standby indexer did not acquire the released lock')
		await contenderLease.assertHeld()
		await contenderLease.release()

		const collisionLease = await database.tryAcquireIndexerLock(chainId)
		if (collisionLease === undefined) throw new Error('indexer did not acquire its lock for exact-key validation')
		await collisionLease.connection`SELECT pg_advisory_lock((92138472::bigint << 32) | ${chainId}::bigint)`
		await collisionLease.connection`SELECT pg_advisory_unlock(92138472, ${chainId})`
		await expect(collisionLease.assertHeld()).rejects.toThrow('Indexer lease is no longer held')
		await collisionLease.connection`SELECT pg_advisory_unlock((92138472::bigint << 32) | ${chainId}::bigint)`
		const failedReleaseBackendPid = collisionLease.backendPid
		await expect(collisionLease.release()).rejects.toThrow('Indexer lease unlock failed')
		const replacementLease = await database.tryAcquireIndexerLock(chainId)
		if (replacementLease === undefined) throw new Error('replacement indexer did not acquire its lock after failed unlock cleanup')
		expect(replacementLease.backendPid).not.toBe(failedReleaseBackendPid)
		await replacementLease.release()
	} finally {
		await contender.close()
	}
}

// A manifest change resets canonical history while keeping the start boundary and allowing rediscovery.
const resetManifestAndRediscover = async ({ database }: LifecycleContext, extraRepTokens: readonly Address[]): Promise<void> => {
	const manifestResetLease = await database.tryAcquireIndexerLock(chainId)
	if (manifestResetLease === undefined) throw new Error('manifest reset did not acquire its lock')
	expect(await database.seedNetwork({ ...network, contracts: [[address, 'Final manifest', 'zoltar']] }, { lease: manifestResetLease, resetCanonicalHistoryOnManifestChange: true })).toBe(true)
	await manifestResetLease.release()
	expect(await database.checkpoint(chainId)).toBeUndefined()
	expect(await database.networkStartBlock(chainId)).toBe(1n)
	expect(await database.hasStoredBlocks(chainId)).toBe(true)
	const resetNetworkRows = await database.sql`SELECT finalized_block FROM networks WHERE chain_id = ${chainId}`
	expect(resetNetworkRows[0]?.['finalized_block']).toBeNull()
	const canonicalHistory = await database.sql`
			SELECT
				(SELECT count(*) FROM logs WHERE chain_id = ${chainId} AND canonical)::integer AS logs,
				(SELECT count(*) FROM pools WHERE chain_id = ${chainId} AND canonical)::integer AS pools,
				(SELECT count(*) FROM address_activity WHERE chain_id = ${chainId} AND canonical)::integer AS activity
		`
	expect(canonicalHistory[0]).toMatchObject({ logs: 0, pools: 0, activity: 0 })
	expect([...(await database.contracts(chainId)).values()]).toEqual([{ address, label: 'Final manifest', kind: 'zoltar', provenance: 'manifest' }])
	const retiredManifestAddress = extraRepTokens[0]
	if (retiredManifestAddress === undefined) throw new Error('retired manifest fixture is unavailable')
	await database.upsertContract(chainId, {
		address: retiredManifestAddress,
		label: 'Rediscovered security pool',
		kind: 'securityPool',
		provenance: 'Factory.DeploySecurityPool',
		discoveryBlock: 4n,
		discoveryTxHash: transactionHash,
	})
	expect((await database.contracts(chainId)).get(retiredManifestAddress.toLowerCase())).toMatchObject({
		label: 'Rediscovered security pool',
		kind: 'securityPool',
		provenance: 'Factory.DeploySecurityPool',
	})
	expect(await database.seedNetwork({ ...network, contracts: [[address, 'Final manifest', 'zoltar']] })).toBe(false)
	expect(() => assertStartBlockCompatible(100n, 1n, undefined, true)).toThrow('while an effective index start is retained')
	expect(await database.networkStartBlock(chainId)).toBe(1n)
}

postgresTest(
	'initializes, resumes, retains an orphan, and serves only its canonical replacement',
	async () => {
		const postgresUrl = requirePostgresUrl()
		const database = new ScannerDatabase(postgresUrl)
		const context: LifecycleContext = { postgresUrl, database, network }
		try {
			await expectSerializedLiveEvents(context)
			await expectStartBoundaryAndLeaseExclusivity(context)

			const firstState = await storeFirstBlock(context)
			const orphanedState = await storeAndRewindOrphan(context, firstState)
			const replacement = await storeReplacementBlock(context, orphanedState)
			await expectReplacementPoolHistory(context, replacement)
			await reconcileManifestAfterReorg(context, orphanedState, replacement)
			const third = await storeThirdBlockWithV4Markets(context, replacement)
			await expectRepeatableReadSnapshots(context, third)
			const chain: LifecycleChain = { first: orphanedState.first, orphan: orphanedState.orphan, replacement, third }

			const firstLogPageCursor = await expectCanonicalLogPagination(context, chain)
			await expectGenerationBoundCatalogCursors(context, chain, firstLogPageCursor)
			await expectRunProvenancePagination(context)
			await expectLogExportsAndDetails(context, chain)
			await seedAddressActivity(context, chain)
			await expectAddressInteractionsAndActions(context)
			await expectAddressTransactionSnapshots(context, chain)
			const otherRichListAddress = await expectRichListProfiles(context)
			await expectRepRankingWithRefreshedBalances(context, chain, otherRichListAddress)
			const extraRepTokens = await expectCappedRepBalances(context, chain)
			await expectLargeRichListSnapshotPages(context, chain)
			await resetManifestAndRediscover(context, extraRepTokens)
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			await database.sql.unsafe('TRUNCATE TABLE live_events RESTART IDENTITY')
			await database.sql`UPDATE live_event_state SET pruned_through_id = 0, updated_at = now() WHERE singleton`
			void database.close(0)
		}
	},
	60_000,
)
