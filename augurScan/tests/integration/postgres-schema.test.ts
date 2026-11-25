import { expect } from 'bun:test'
import { canonicalTablePolicies, type IndexerLease, ScannerDatabase } from '../../src/database.ts'
import { poolStateHistory } from '../../src/repositories/state-history.ts'
import { initializeSchema } from '../../src/schema.ts'
import { CURRENT_SCHEMA_VERSION, UNSUPPORTED_SCHEMA_MESSAGE } from '../../src/schema-policy.ts'
import { address, blockHash, chainId, decodedLog, discoveredAddress, evidenceTransaction, expectBehaviorChangingSchemaObjectsRejected, indexedBlock, inverseUniswapPairAddress, pairAddress, postgresTest, rediscoveredAddress, requirePostgresUrl, wethAddress } from '../support/postgres-fixtures.ts'

postgresTest('rejects every public namespace object before fresh schema initialization', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const resetPublicSchema = async (): Promise<void> => {
		await database.sql.unsafe('DROP SCHEMA public CASCADE')
		await database.sql.unsafe('CREATE SCHEMA public')
	}
	const applicationTableCount = async (): Promise<number> => {
		const rows = await database.sql`
			SELECT count(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname = 'public'
		`
		return Number(rows[0]?.count)
	}
	try {
		await resetPublicSchema()
		await database.sql.unsafe("CREATE COLLATION public.legacy_collation (provider = libc, locale = 'C')")
		await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		expect(await applicationTableCount()).toBe(0)

		await resetPublicSchema()
		await database.sql.unsafe('CREATE OPERATOR public.## (FUNCTION = pg_catalog.int4pl, LEFTARG = int4, RIGHTARG = int4)')
		await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		expect(await applicationTableCount()).toBe(0)
	} finally {
		await resetPublicSchema()
		await initializeSchema(database.sql)
		await database.close()
	}
})

postgresTest('rejects incomplete, altered, and extended layouts despite a current schema marker', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	try {
		await initializeSchema(database.sql)

		await database.sql.unsafe('DROP INDEX public.protocol_timeline_recent')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe('CREATE INDEX protocol_timeline_recent ON public.protocol_timeline_entries USING btree (chain_id, block_number DESC, log_index DESC) WHERE canonical')
		}

		await database.sql.unsafe('ALTER TABLE public.actions ALTER COLUMN summary TYPE character varying USING summary::character varying')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe('ALTER TABLE public.actions ALTER COLUMN summary TYPE text USING summary::text')
		}

		await database.sql.unsafe('CREATE TABLE public.augurscan_layout_intruder (id integer)')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe('DROP TABLE public.augurscan_layout_intruder')
		}

		await expectBehaviorChangingSchemaObjectsRejected(database)

		await initializeSchema(database.sql)
	} finally {
		await database.close()
	}
})

postgresTest('classifies every chain-scoped canonical table', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	try {
		await initializeSchema(database.sql)
		const rows = await database.sql`
			SELECT canonical.table_name
			FROM information_schema.columns AS canonical
			JOIN information_schema.columns AS chain
				ON chain.table_schema = canonical.table_schema AND chain.table_name = canonical.table_name
			WHERE canonical.table_schema = 'public' AND canonical.column_name = 'canonical' AND chain.column_name = 'chain_id'
			ORDER BY canonical.table_name
		`
		expect(rows.map((row: Record<string, unknown>) => String(row['table_name']))).toEqual(canonicalTablePolicies.map(({ table }) => table).toSorted())
	} finally {
		await database.close()
	}
})

postgresTest('rejects historical schema versions without modifying stored evidence', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	try {
		await initializeSchema(database.sql)
		for (let version = 1; version < Number(CURRENT_SCHEMA_VERSION); version++) {
			await database.sql`UPDATE augurscan_schema SET schema_version = ${version.toString()} WHERE singleton`
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
			expect((await database.sql`SELECT schema_version FROM augurscan_schema WHERE singleton`)[0]?.schema_version).toBe(version.toString())
		}
	} finally {
		await database.sql`UPDATE augurscan_schema SET schema_version = ${CURRENT_SCHEMA_VERSION} WHERE singleton`
		await database.close()
	}
})

postgresTest('stores reverted direct calls while rejecting reverted log-selected evidence', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	try {
		await initializeSchema(database.sql)
		await database.sql.begin(async transaction => {
			await transaction`CREATE TEMP TABLE selected_transactions (LIKE transactions INCLUDING CONSTRAINTS) ON COMMIT DROP`
			const insert = (selectionSource: string) => transaction`
				INSERT INTO selected_transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, value, input, status, receipt, canonical)
				VALUES (1, 'hash', 'block', 1, 0, 'sender', 0, '0x', 'reverted', ${JSON.stringify({ selectionSource })}::text::jsonb, true)
			`
			await insert('protocol-call')
			await expect(transaction.savepoint(async () => await insert('protocol-log'))).rejects.toThrow('transactions_selection_status')
		})
	} finally {
		await database.close()
	}
})

postgresTest('a freshly initialized scanner indexes distinct factory pairs for one question ledger', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	const marketChainId = chainId + 120 + process.pid
	let lease: IndexerLease | undefined
	try {
		await initializeSchema(database.sql)
		const ledger = discoveredAddress.toLowerCase()
		await database.seedNetwork({
			id: 'multiple-factories',
			name: 'Multiple factories',
			chainId: marketChainId,
			rpcUrls: ['http://127.0.0.1:8545'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [
				[address, 'First factory', 'ammFactory'],
				[rediscoveredAddress, 'Second factory', 'ammFactory'],
			],
		})
		lease = await database.tryAcquireIndexerLock(marketChainId)
		if (lease === undefined) throw new Error('Multiple factories fixture did not acquire its lock')
		const parent = blockHash('multiple-factories-parent')
		const pairBlock = (name: string, factory: typeof address, pair: typeof pairAddress, parentHash: typeof parent, feeBps: string) => {
			const base = indexedBlock(name, parentHash)
			const txHash = blockHash(`${name}-transaction`)
			const logs = [
				{ ...decodedLog(base.hash, 0, factory, 'PairCreated', { pair: pair.toLowerCase(), questionLedger: ledger, shareToken: wethAddress.toLowerCase(), universeId: '10', feeBps }), contractKind: 'ammFactory' as const },
				{ ...decodedLog(base.hash, 1, pair, 'Sync', { yesReserve: '100', noReserve: '50' }), contractKind: 'ammPair' as const },
			].map(log => ({ ...log, blockNumber: base.number, transactionHash: txHash }))
			return { ...base, transactions: [evidenceTransaction(txHash, base.hash, { status: 'unknown', summary: 'Unspecified calldata' })], logs }
		}
		const first = pairBlock('multiple-factories-one', address, pairAddress, parent, '30')
		const second = pairBlock('multiple-factories-two', rediscoveredAddress, inverseUniswapPairAddress, first.hash, '5')
		await database.storeBlock(marketChainId, first, lease)
		await database.storeBlock(marketChainId, second, lease)
		expect(await database.checkpoint(marketChainId, lease)).toEqual({ number: 2n, hash: second.hash })
		const markets = [pairAddress.toLowerCase(), inverseUniswapPairAddress.toLowerCase()]
		expect(await database.sql`SELECT pair_address FROM amm_markets WHERE chain_id = ${marketChainId} AND pool_address = ${ledger} ORDER BY block_number`).toEqual(markets.map(pair_address => ({ pair_address })))
		for (const [index, market] of markets.entries()) {
			const history = await poolStateHistory(database.sql, ledger, { chainId: marketChainId, fromBlock: '1', toBlock: String(index + 1), queryLimit: 10, offset: 0 })
			expect(history.markets).toEqual([expect.objectContaining({ pair_address: market })])
			expect(history.ammPrices).toEqual([expect.objectContaining({ pair_address: market })])
		}
		const duplicate = pairBlock('multiple-factories-duplicate', rediscoveredAddress, pairAddress, second.hash, '30')
		await expect(database.storeBlock(marketChainId, { ...duplicate, number: 3n, logs: duplicate.logs.map(log => ({ ...log, blockNumber: 3n })) }, lease)).rejects.toThrow('amm_markets_canonical_pair')
		expect(await database.checkpoint(marketChainId, lease)).toEqual({ number: 2n, hash: second.hash })
	} finally {
		await lease?.release()
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})
