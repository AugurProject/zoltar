import { expect } from 'bun:test'
import { type IndexerLease, readIndexerHealth, ScannerDatabase } from '../../src/database.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { NetworkConfig } from '../../src/types.ts'
import { blockHash, chainId, postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

postgresTest('limits health continuity auditing to the latest 10,000 indexed blocks', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const auditChainId = chainId + 40 + process.pid
	const oldFirstHash = blockHash('integrity-window-old-first')
	const oldSecondHash = blockHash('integrity-window-old-second')
	const recentHash = blockHash('integrity-window-recent')
	const checkpointHash = blockHash('integrity-window-checkpoint')
	try {
		await initializeSchema(database.sql)
		await database.sql`DELETE FROM blocks WHERE chain_id = ${auditChainId}`
		await database.sql`DELETE FROM networks WHERE chain_id = ${auditChainId}`
		await database.sql`
			INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block)
			VALUES (${auditChainId}, ${`integrity-window-${auditChainId}`}, 'Integrity window fixture', 'https://example.invalid', 0)
		`
		await database.sql`
			INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES
				(${auditChainId}, 1, ${oldFirstHash}, ${blockHash('integrity-window-genesis')}, now(), true),
				(${auditChainId}, 2, ${oldSecondHash}, ${blockHash('integrity-window-wrong-old-parent')}, now(), true),
				(${auditChainId}, 19999, ${recentHash}, ${blockHash('integrity-window-unretained-parent')}, now(), true),
				(${auditChainId}, 20000, ${checkpointHash}, ${recentHash}, now(), true)
		`
		await database.sql`
			UPDATE networks SET indexed_block = 20000, indexed_hash = ${checkpointHash}, indexed_timestamp = now()
			WHERE chain_id = ${auditChainId}
		`

		const oldDiscontinuityOutsideWindow = (await database.auditIntegrity()).filter(issue => issue.chainId === auditChainId)
		expect(oldDiscontinuityOutsideWindow).toEqual([])

		await database.sql`
			UPDATE blocks SET parent_hash = ${blockHash('integrity-window-wrong-recent-parent')}
			WHERE chain_id = ${auditChainId} AND hash = ${checkpointHash}
		`
		expect(await database.auditIntegrity()).toContainEqual({
			chainId: auditChainId,
			code: 'canonical_discontinuity',
			detail: 'Canonical block 20000 does not extend the preceding stored block',
		})
	} finally {
		await database.sql`DELETE FROM blocks WHERE chain_id = ${auditChainId}`
		await database.sql`DELETE FROM networks WHERE chain_id = ${auditChainId}`
		await database.close()
	}
})

postgresTest('drains lease operations queued before release and rejects later work', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const blocker = new ScannerDatabase(postgresUrl)
	const releaseChainId = chainId + 20 + process.pid
	const network = {
		id: `lease-release-${releaseChainId}`,
		name: 'Lease release ordering',
		chainId: releaseChainId,
		rpcUrls: ['http://127.0.0.1:8545'],
		startBlock: 0n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [],
	} satisfies NetworkConfig
	let lease: IndexerLease | undefined
	let unblockRow: (() => void) | undefined
	let blockingTransaction: Promise<void> | undefined
	const rowBlocked = new Promise<void>(resolve => {
		unblockRow = resolve
	})
	try {
		await initializeSchema(database.sql)
		await database.seedNetwork(network)
		lease = await database.tryAcquireIndexerLock(releaseChainId)
		if (lease === undefined) throw new Error('release-ordering writer did not acquire its lock')
		let confirmRowLocked: (() => void) | undefined
		const rowLocked = new Promise<void>(resolve => {
			confirmRowLocked = resolve
		})
		blockingTransaction = blocker.sql.begin(async transaction => {
			await transaction`SELECT 1 FROM networks WHERE chain_id = ${releaseChainId} FOR UPDATE`
			confirmRowLocked?.()
			await rowBlocked
		})
		await rowLocked

		const firstUpdate = database.updateObservedHead(releaseChainId, 1n, 'backfilling', lease)
		for (let attempt = 0; attempt < 100; attempt++) {
			const activity = await database.sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${lease.backendPid}`
			if (activity[0]?.['wait_event_type'] === 'Lock') break
			if (attempt === 99) throw new Error('lease operation did not wait for the network row lock')
			await Bun.sleep(10)
		}
		const secondUpdate = database.updateObservedHead(releaseChainId, 2n, 'live', lease)
		const release = lease.release()
		unblockRow?.()
		await blockingTransaction
		await Promise.all([firstUpdate, secondUpdate, release])

		const stored = await database.sql`SELECT observed_block, phase FROM networks WHERE chain_id = ${releaseChainId}`
		expect(stored).toEqual([{ observed_block: '2', phase: 'live' }])
		await expect(database.updateObservedHead(releaseChainId, 3n, 'live', lease)).rejects.toThrow('Indexer lease was released')
	} finally {
		unblockRow?.()
		await blockingTransaction?.catch(() => undefined)
		await lease?.release().catch(() => undefined)
		await database.sql`DELETE FROM networks WHERE chain_id = ${releaseChainId}`
		await blocker.close()
		await database.close()
	}
})

postgresTest('destroys a lease session after backend loss and never reuses it as an unlocked pooled client', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const terminator = new ScannerDatabase(postgresUrl)
	const releaseChainId = chainId + 40 + process.pid
	let lease: IndexerLease | undefined
	try {
		await initializeSchema(database.sql)
		lease = await database.tryAcquireIndexerLock(releaseChainId)
		if (lease === undefined) throw new Error('lease-loss writer did not acquire its lock')
		const terminatedPid = lease.backendPid
		expect((await terminator.sql`SELECT pg_terminate_backend(${terminatedPid}) AS terminated`)[0]?.['terminated']).toBe(true)
		await expect(lease.release()).rejects.toThrow('release of its expected PostgreSQL session was confirmed')
		lease = undefined
		const replacement = await database.tryAcquireIndexerLock(releaseChainId)
		if (replacement === undefined) throw new Error('replacement writer did not acquire the released lock')
		expect(replacement.backendPid).not.toBe(terminatedPid)
		await replacement.release()
	} finally {
		await lease?.release().catch(() => undefined)
		await terminator.close()
		await database.close()
	}
})

postgresTest('terminates the expected lock holder when release runs on a different PostgreSQL backend', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const mismatchedSession = await database.sql.reserve()
	const releaseChainId = chainId + 50 + process.pid
	const mismatchedPid = Number((await mismatchedSession`SELECT pg_backend_pid() AS backend_pid`)[0]?.['backend_pid'])
	let lease: IndexerLease | undefined
	try {
		lease = await database.tryAcquireIndexerLock(releaseChainId, mismatchedSession)
		if (lease === undefined) throw new Error('backend-mismatch writer did not acquire its lock')
		const expectedPid = lease.backendPid
		expect(expectedPid).not.toBe(mismatchedPid)
		await expect(lease.release()).rejects.toThrow('release of its expected PostgreSQL session was confirmed')
		lease = undefined
		const survivingLocks = await database.sql`
			SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid::bigint = 92138472
				AND objid::bigint = ${releaseChainId} AND objsubid = 2 AND granted
		`
		expect(survivingLocks).toEqual([])
		const replacement = await database.tryAcquireIndexerLock(releaseChainId)
		if (replacement === undefined) throw new Error('replacement writer did not acquire the released lock')
		expect(replacement.backendPid).not.toBe(expectedPid)
		expect(replacement.backendPid).not.toBe(mismatchedPid)
		await replacement.release()
	} finally {
		await lease?.release().catch(() => undefined)
		await mismatchedSession.close({ timeout: 0 }).catch(() => undefined)
		await database.close()
	}
})

postgresTest('reconciles cross-process ownership heartbeats with the advisory-lock backend', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const ownershipChainId = chainId + 60 + process.pid
	const network = {
		id: `ownership-${ownershipChainId}`,
		name: 'Ownership diagnostics',
		chainId: ownershipChainId,
		rpcUrls: ['http://127.0.0.1:8545'],
		startBlock: 0n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [],
	} satisfies NetworkConfig
	let lease: IndexerLease | undefined
	try {
		await initializeSchema(database.sql)
		await database.seedNetwork(network)
		lease = await database.tryAcquireIndexerLock(ownershipChainId)
		if (lease === undefined) throw new Error('ownership writer did not acquire its lock')
		await database.recordIndexerOwnership(ownershipChainId, network.id, 'owned', lease.backendPid, undefined)
		const owned = await database.read(async sql => await readIndexerHealth(sql, transaction => database.auditIntegrity(transaction), 60_000), 3_000)
		expect(owned.ownership.find(({ chainId: current }) => current === ownershipChainId)?.state).toBe('owned')

		await database.sql`UPDATE indexer_ownership SET heartbeat_at = now() - interval '2 minutes' WHERE chain_id = ${ownershipChainId}`
		const stale = await database.read(async sql => await readIndexerHealth(sql, transaction => database.auditIntegrity(transaction), 60_000), 3_000)
		expect(stale.ownership.find(({ chainId: current }) => current === ownershipChainId)?.state).toBe('stale-owner')

		await lease.release()
		lease = undefined
		await database.recordIndexerOwnership(ownershipChainId, network.id, 'released', undefined, undefined)
		const standby = await database.read(async sql => await readIndexerHealth(sql, transaction => database.auditIntegrity(transaction), 60_000), 3_000)
		expect(standby.ownership.find(({ chainId: current }) => current === ownershipChainId)?.state).toBe('standby')
	} finally {
		await lease?.release().catch(() => undefined)
		await database.sql`DELETE FROM networks WHERE chain_id = ${ownershipChainId}`
		await database.close()
	}
})

postgresTest('prevents standby and stale release writers from clobbering a current owner', async () => {
	const postgresUrl = requirePostgresUrl()
	const owner = new ScannerDatabase(postgresUrl)
	const standby = new ScannerDatabase(postgresUrl)
	const restarted = new ScannerDatabase(postgresUrl)
	const ownershipChainId = chainId + 70 + process.pid
	const network = {
		id: `ownership-race-${ownershipChainId}`,
		name: 'Ownership race diagnostics',
		chainId: ownershipChainId,
		rpcUrls: ['http://127.0.0.1:8545'],
		startBlock: 0n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [],
	} satisfies NetworkConfig
	let ownerLease: IndexerLease | undefined
	let restartedLease: IndexerLease | undefined
	try {
		await initializeSchema(owner.sql)
		await owner.seedNetwork(network)
		ownerLease = await owner.tryAcquireIndexerLock(ownershipChainId)
		if (ownerLease === undefined) throw new Error('owner did not acquire its lock')
		await owner.recordIndexerOwnership(ownershipChainId, network.id, 'owned', ownerLease.backendPid, undefined)
		expect(await standby.tryAcquireIndexerLock(ownershipChainId)).toBeUndefined()
		await standby.recordIndexerOwnership(ownershipChainId, network.id, 'standby', undefined, undefined)
		let rows = await standby.sql`SELECT state, backend_pid FROM indexer_ownership WHERE chain_id = ${ownershipChainId}`
		expect(rows).toEqual([{ state: 'owned', backend_pid: ownerLease.backendPid }])

		const previousPid = ownerLease.backendPid
		await ownerLease.release()
		ownerLease = undefined
		await owner.recordIndexerOwnership(ownershipChainId, network.id, 'released', previousPid, undefined)
		restartedLease = await restarted.tryAcquireIndexerLock(ownershipChainId)
		if (restartedLease === undefined) throw new Error('restarted owner did not acquire its lock')
		await restarted.recordIndexerOwnership(ownershipChainId, network.id, 'owned', restartedLease.backendPid, undefined)
		await owner.recordIndexerOwnership(ownershipChainId, network.id, 'released', previousPid, undefined)
		rows = await owner.sql`SELECT state, backend_pid FROM indexer_ownership WHERE chain_id = ${ownershipChainId}`
		expect(rows).toEqual([{ state: 'owned', backend_pid: restartedLease.backendPid }])

		await restarted.recordIndexerOwnership(ownershipChainId, network.id, 'release-failed', restartedLease.backendPid, undefined)
		const health = await owner.read(async sql => await readIndexerHealth(sql, transaction => owner.auditIntegrity(transaction), 60_000), 3_000)
		expect(health.ownership.find(({ chainId: current }) => current === ownershipChainId)?.state).toBe('release-failed')
	} finally {
		await ownerLease?.release().catch(() => undefined)
		await restartedLease?.release().catch(() => undefined)
		await owner.sql`DELETE FROM networks WHERE chain_id = ${ownershipChainId}`
		await Promise.all([owner.close(), standby.close(), restarted.close()])
	}
})
