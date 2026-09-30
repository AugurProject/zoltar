// Chain-writing stages of the canonical lifecycle integration test: the first block, an orphaned sibling
// and its rewind, the canonical replacement with price history, and a third block with Uniswap V4 markets.
import { expect } from 'bun:test'
import { isRecord } from '../../browser/api-validation.ts'
import { handleApi } from '../../src/api.ts'
import { assertBlockAppend, assertStartBlockCompatible, type IndexedBlock, type IndexerLease, ScannerDatabase } from '../../src/database.ts'
import { getAddress } from '../../src/ethereum.ts'
import type { ContractMetadata, NetworkConfig, StoredLog } from '../../src/types.ts'
import { uniswapV4PoolId } from '../../src/uniswap.ts'
import {
	address,
	blockHash,
	chainId,
	decodedLog,
	discoveredAddress,
	indexedBlock,
	inverseUniswapPairAddress,
	orphanOnlyAddress,
	pairAddress,
	priceHistoryLogs,
	promotedAddress,
	rediscoveredAddress,
	repPriceLog,
	secondWethAddress,
	transaction,
	transactionHash,
	uniswapPairAddress,
	uniswapV4PoolManagerAddress,
	vaultCheckpoint,
	wethAddress,
} from './postgres-fixtures.ts'

export type LifecycleContext = {
	readonly postgresUrl: string
	readonly database: ScannerDatabase
	readonly network: NetworkConfig
}

type FirstBlockState = {
	readonly writeLease: IndexerLease
	readonly first: IndexedBlock
	readonly initialDiscovery: ContractMetadata
}

type OrphanedBlockState = FirstBlockState & {
	readonly orphan: IndexedBlock
	readonly discovery: ContractMetadata
}

export type LifecycleChain = {
	readonly first: IndexedBlock
	readonly orphan: IndexedBlock
	readonly replacement: IndexedBlock
	readonly third: IndexedBlock
}

// Stores the first canonical block and proves the checkpoint and start boundary survive a restart.
export const storeFirstBlock = async ({ postgresUrl, database }: LifecycleContext): Promise<FirstBlockState> => {
	const writeLease = await database.tryAcquireIndexerLock(chainId)
	if (writeLease === undefined) throw new Error('writer did not acquire its lock')
	const genesisHash = blockHash('genesis')
	const initialDiscovery: ContractMetadata = {
		address: rediscoveredAddress,
		label: 'Original discovery',
		kind: 'reputationToken',
		provenance: 'Zoltar.UniverseCreated',
		discoveryBlock: 1n,
		discoveryTxHash: transactionHash,
	}
	const wethDiscovery: ContractMetadata = {
		address: wethAddress,
		label: 'Wrapped Ether',
		kind: 'weth',
		provenance: 'test',
		discoveryBlock: 1n,
		discoveryTxHash: transactionHash,
	}
	const secondWethDiscovery: ContractMetadata = {
		...wethDiscovery,
		address: secondWethAddress,
		label: 'Wrapped Ether v2',
	}
	const first: IndexedBlock = {
		...indexedBlock('block-one', genesisHash, [initialDiscovery, wethDiscovery, secondWethDiscovery], undefined, [
			{ address: rediscoveredAddress, name: 'Original token', symbol: 'OLD', decimals: 18, readBlock: 1n },
			{ address: wethAddress, name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, readBlock: 1n },
			{ address: secondWethAddress, name: 'Wrapped Ether v2', symbol: 'WETH2', decimals: 18, readBlock: 1n },
		]),
		logScanCursors: [{ contractAddress: address, startBlock: 1n, lastRetrievedBlock: 1n }],
	}
	await database.storeBlock(chainId, first, writeLease)
	expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
	expect(await database.logScanCursors(chainId)).toEqual(new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 1n, lastRetrievedBlock: 1n }]]))
	expect(() => assertStartBlockCompatible(3n, 1n, 1n, true)).toThrow('Cannot change the configured start block from 1 to 3 while checkpoint 1 exists; rebuild the augurScan database from the new start block')
	expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
	const unchangedBoundary = await database.sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
	expect(unchangedBoundary[0]?.['start_block']).toBe('1')
	await database.sql`UPDATE networks SET start_block = 3 WHERE chain_id = ${chainId}`
	expect(() => assertStartBlockCompatible(3n, 3n, 1n, true)).toThrow('Stored checkpoint 1 is below configured start block 3; rebuild the augurScan database from the configured start block')
	expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
	const inconsistentBoundary = await database.sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
	expect(inconsistentBoundary[0]?.['start_block']).toBe('3')
	await database.sql`UPDATE networks SET start_block = 1 WHERE chain_id = ${chainId}`
	const invalidParent = indexedBlock('block-two-invalid-parent', genesisHash)
	expect(() => assertBlockAppend(invalidParent, { startBlock: 1n, indexedBlock: 1n, indexedHash: first.hash })).toThrow('does not extend the current database checkpoint')
	expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })

	const restarted = new ScannerDatabase(postgresUrl)
	try {
		expect(await restarted.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
	} finally {
		await restarted.close()
	}
	return { writeLease, first, initialDiscovery }
}

// Stores an orphan sibling with discoveries and manifest promotions, then rewinds it and checks what survives.
export const storeAndRewindOrphan = async ({ database, network }: LifecycleContext, { writeLease, first, initialDiscovery }: FirstBlockState): Promise<OrphanedBlockState> => {
	const discovery: ContractMetadata = {
		address: discoveredAddress,
		label: 'Discovered pool',
		kind: 'securityPool',
		provenance: 'Factory.DeploySecurityPool',
		discoveryBlock: 2n,
		discoveryTxHash: transactionHash,
	}
	const promotedDiscovery: ContractMetadata = {
		address: promotedAddress,
		label: 'Dynamically discovered helper',
		kind: 'securityPool',
		provenance: 'Factory.DeploySecurityPool',
		discoveryBlock: 2n,
		discoveryTxHash: transactionHash,
	}
	const laterRediscovery: ContractMetadata = {
		...initialDiscovery,
		label: 'Orphaned rediscovery',
		discoveryBlock: 2n,
	}
	const orphanOnlyDiscovery: ContractMetadata = {
		...laterRediscovery,
		address: orphanOnlyAddress,
		label: 'Orphan-only helper',
	}
	const orphanBase = indexedBlock('block-two-orphan', first.hash, [discovery, promotedDiscovery, laterRediscovery, orphanOnlyDiscovery], 'orphan event', [
		{ address: discoveredAddress, readError: 'ERC-20 metadata unavailable', readBlock: 2n },
		{ address: rediscoveredAddress, name: 'Orphaned token', symbol: 'BAD', decimals: 6, readBlock: 2n },
	])
	const orphanPrice = repPriceLog(orphanBase.hash, '99000000000000000000')
	const orphan: IndexedBlock = {
		...orphanBase,
		logs: [...orphanBase.logs, orphanPrice],
		contractDeploymentObservations: [
			{
				contractAddress: address,
				checkedBlock: 2n,
				deployment: { block: 2n, timestamp: new Date('2026-01-02T00:00:00Z'), exact: true },
			},
		],
		logScanCursors: [
			{ contractAddress: address, startBlock: 1n, lastRetrievedBlock: 2n },
			{ contractAddress: discoveredAddress, startBlock: 2n, lastRetrievedBlock: 2n },
		],
	}
	await database.storeBlock(chainId, orphan, writeLease)
	expect(
		await database.seedNetwork(
			{
				...network,
				contracts: [
					[address, 'Corrected manifest contract', 'openOracle'],
					[promotedAddress, 'Promoted manifest helper', 'securityPool'],
				],
			},
			{ lease: writeLease },
		),
	).toBe(true)
	const seededContracts = await database.contracts(chainId)
	expect(seededContracts.get(address.toLowerCase())).toMatchObject({ label: 'Corrected manifest contract', kind: 'openOracle', provenance: 'manifest' })
	expect(seededContracts.get(promotedAddress.toLowerCase())).toMatchObject({
		address: promotedAddress,
		label: 'Promoted manifest helper',
		kind: 'securityPool',
		provenance: 'manifest',
		discoveryBlock: 2n,
		discoveryTxHash: transactionHash,
	})
	expect((await database.contracts(chainId)).get(address.toLowerCase())).toMatchObject({ deploymentBlock: 2n, deploymentCheckedBlock: 2n })
	await database.rewind(chainId, 1n, first.hash, writeLease)
	const recordedReorganizations = await database.sql`
			SELECT previous_block::text, previous_hash, ancestor_block::text, ancestor_hash, depth::text, reason
			FROM chain_reorganizations WHERE chain_id = ${chainId} ORDER BY id DESC LIMIT 1
		`
	expect(recordedReorganizations[0]).toEqual({
		previous_block: '2',
		previous_hash: orphan.hash,
		ancestor_block: '1',
		ancestor_hash: first.hash,
		depth: '1',
		reason: 'chain-reorg',
	})
	const chainReorganizationEvents = await database.sql`
				SELECT payload FROM live_events
				WHERE (payload->>'chainId')::integer = ${chainId} AND event = 'reorg'
				ORDER BY id DESC LIMIT 1
			`
	expect(chainReorganizationEvents[0]?.['payload']).toMatchObject({ reason: 'chain-reorg' })
	const canonicalOrphanPrices = await database.sql`SELECT * FROM rep_eth_price_snapshots WHERE chain_id = ${chainId} AND block_hash = ${orphan.hash} AND canonical`
	expect(canonicalOrphanPrices).toHaveLength(0)
	expect(await database.logScanCursors(chainId)).toEqual(new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 1n, lastRetrievedBlock: 1n }]]))
	expect((await database.contracts(chainId)).get(address.toLowerCase())).not.toHaveProperty('deploymentBlock')
	expect((await database.contracts(chainId)).get(address.toLowerCase())).not.toHaveProperty('deploymentCheckedBlock')
	expect((await database.contracts(chainId)).get(promotedAddress.toLowerCase())?.provenance).toBe('manifest')
	expect((await database.contracts(chainId)).get(rediscoveredAddress.toLowerCase())).toMatchObject({
		label: 'Original discovery',
		kind: 'reputationToken',
		discoveryBlock: 1n,
	})
	expect((await database.tokenMetadata(chainId)).get(rediscoveredAddress.toLowerCase())).toMatchObject({
		name: 'Original token',
		symbol: 'OLD',
		decimals: 18,
		readBlock: 1n,
	})
	const orphanContractResponse = await handleApi(new Request(`http://localhost/api/v1/contracts/${chainId}/${orphanOnlyAddress}`), database.sql)
	expect(orphanContractResponse?.status).toBe(404)

	return { writeLease, first, initialDiscovery, orphan, discovery }
}

// Stores the canonical replacement with pool, AMM, REP/ETH, and Uniswap V2 price history.
export const storeReplacementBlock = async ({ database }: LifecycleContext, { writeLease, first, discovery }: OrphanedBlockState): Promise<IndexedBlock> => {
	const replacementBase = indexedBlock('block-two-replacement', first.hash, [discovery], 'replacement event', [{ address: discoveredAddress, name: 'Replacement token', symbol: 'NEW', decimals: 18, readBlock: 2n }])
	const uniswapPairDiscovery: ContractMetadata = {
		address: uniswapPairAddress,
		label: 'Uniswap V2 REP / WETH Pair',
		kind: 'uniswapV2Pair',
		provenance: 'Uniswap V2 Factory.PairCreated',
		discoveryBlock: 2n,
		discoveryTxHash: transactionHash,
	}
	const inverseUniswapPairDiscovery: ContractMetadata = {
		address: inverseUniswapPairAddress,
		label: 'Uniswap V2 WETH / REP Pair',
		kind: 'uniswapV2Pair',
		provenance: 'Uniswap V2 Factory.PairCreated',
		discoveryBlock: 2n,
		discoveryTxHash: transactionHash,
	}
	const replacementPrices = priceHistoryLogs(replacementBase.hash)
	const replacement: IndexedBlock = {
		...replacementBase,
		contracts: [...replacementBase.contracts, uniswapPairDiscovery, inverseUniswapPairDiscovery],
		logs: [...replacementBase.logs, vaultCheckpoint(replacementBase.hash), ...replacementPrices],
		addressActivity: [{ transactionHash, address, poolAddress: discoveredAddress, role: 'sender' }],
		logScanCursors: [
			{ contractAddress: address, startBlock: 1n, lastRetrievedBlock: 2n },
			{ contractAddress: discoveredAddress, startBlock: 2n, lastRetrievedBlock: 2n },
		],
	}
	await database.storeBlock(chainId, replacement, writeLease)
	return replacement
}

export const expectReplacementPoolHistory = async ({ database }: LifecycleContext, replacement: IndexedBlock): Promise<void> => {
	const poolHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/pools/${chainId}/${discoveredAddress.toLowerCase()}`), database.sql)
	if (poolHistoryResponse === undefined) throw new Error('pool history API did not return a response')
	const poolHistory = await poolHistoryResponse.json()
	if (typeof poolHistory !== 'object' || poolHistory === null || Array.isArray(poolHistory) || !('market' in poolHistory) || !('ammPrices' in poolHistory) || !('repEthPrices' in poolHistory) || !('uniswapRepEthPrices' in poolHistory)) throw new Error('pool history API returned an invalid price payload')
	expect(poolHistory['market']).toEqual({
		chain_id: chainId.toString(),
		block_hash: replacement.hash,
		tx_hash: transactionHash,
		log_index: 3,
		block_number: '2',
		pair_address: pairAddress.toLowerCase(),
		pool_address: discoveredAddress.toLowerCase(),
		share_token_address: wethAddress.toLowerCase(),
		universe_id: '0',
		fee_bps: '30',
		canonical: true,
		timestamp: '2026-01-02T00:00:00.000Z',
	})
	expect(poolHistory['ammPrices']).toEqual([
		{
			chain_id: chainId.toString(),
			block_hash: replacement.hash,
			tx_hash: transactionHash,
			log_index: 4,
			block_number: '2',
			pair_address: pairAddress.toLowerCase(),
			yes_reserve_atto_shares: '300000000000000000000',
			no_reserve_atto_shares: '700000000000000000000',
			conditional_yes_bps: '7000',
			conditional_no_bps: '3000',
			canonical: true,
			timestamp: '2026-01-02T00:00:00.000Z',
		},
	])
	expect(poolHistory['coverage']).toMatchObject({
		requestedFromBlock: '1',
		requestedToBlock: '2',
		indexedFromBlock: '1',
		indexedThroughBlock: '2',
		complete: true,
	})
	expect(poolHistory['repEthPrices']).toEqual([
		{
			chain_id: chainId.toString(),
			block_hash: replacement.hash,
			tx_hash: transactionHash,
			log_index: 5,
			block_number: '2',
			coordinator_address: promotedAddress.toLowerCase(),
			event_name: 'PriceReported',
			report_id: '42',
			rep_per_eth_1e18: '19500000000000000000',
			settlement_timestamp: '2026-01-02T00:00:00.000Z',
			canonical: true,
			timestamp: '2026-01-02T00:00:00.000Z',
		},
	])
	expect(poolHistory['uniswapRepEthPrices']).toEqual([
		{
			chain_id: chainId.toString(),
			block_hash: replacement.hash,
			tx_hash: transactionHash,
			log_index: 8,
			block_number: '2',
			venue: 'v2',
			market_id: uniswapPairAddress.toLowerCase(),
			event_name: 'Sync',
			contract_address: uniswapPairAddress.toLowerCase(),
			token0_address: rediscoveredAddress.toLowerCase(),
			token1_address: wethAddress.toLowerCase(),
			fee_hundredths_bip: '3000',
			tick_spacing: null,
			hooks_address: null,
			quote_symbol: 'WETH',
			quote_decimals: 18,
			quote_token_address: wethAddress.toLowerCase(),
			rep_per_eth_1e18: '18000000000000000000',
			liquidity_value: '180000000000000000000000000000000000000000',
			timestamp: '2026-01-02T00:00:00.000Z',
		},
		{
			chain_id: chainId.toString(),
			block_hash: replacement.hash,
			tx_hash: transactionHash,
			log_index: 10,
			block_number: '2',
			venue: 'v2',
			market_id: inverseUniswapPairAddress.toLowerCase(),
			event_name: 'Sync',
			contract_address: inverseUniswapPairAddress.toLowerCase(),
			token0_address: wethAddress.toLowerCase(),
			token1_address: rediscoveredAddress.toLowerCase(),
			fee_hundredths_bip: '3000',
			tick_spacing: null,
			hooks_address: null,
			quote_symbol: 'WETH',
			quote_decimals: 18,
			quote_token_address: wethAddress.toLowerCase(),
			rep_per_eth_1e18: '24000000000000000000',
			liquidity_value: '240000000000000000000000000000000000000000',
			timestamp: '2026-01-02T00:00:00.000Z',
		},
	])
	// Decimal metadata, rather than token symbols, controls the liquidity chart scale.
	await database.sql`UPDATE token_metadata SET decimals = 6 WHERE chain_id = ${chainId} AND address = ${wethAddress.toLowerCase()} AND canonical`
	try {
		const decimalResponse = await handleApi(new Request(`http://localhost/api/v1/state/pools/${chainId}/${discoveredAddress.toLowerCase()}`), database.sql)
		const decimalHistory: unknown = await decimalResponse?.json()
		expect(isRecord(decimalHistory) ? decimalHistory['uniswapRepEthPrices'] : undefined).toEqual([
			expect.objectContaining({ quote_symbol: 'WETH', quote_decimals: 6, liquidity_value: '180000000000000000000000000000000000000000' }),
			expect.objectContaining({ quote_symbol: 'WETH', quote_decimals: 6, liquidity_value: '240000000000000000000000000000000000000000' }),
		])
	} finally {
		await database.sql`UPDATE token_metadata SET decimals = 18 WHERE chain_id = ${chainId} AND address = ${wethAddress.toLowerCase()} AND canonical`
	}
}

// Stores balances, reconciles temporary manifest promotions, and releases the writer lease.
export const reconcileManifestAfterReorg = async ({ database, network }: LifecycleContext, { writeLease, orphan }: OrphanedBlockState, replacement: IndexedBlock): Promise<void> => {
	await database.storeRichListBalances(
		chainId,
		2n,
		replacement.hash,
		[
			{ owner: address, assetAddress: getAddress('0x0000000000000000000000000000000000000000'), assetKind: 'native', balance: 2_000_000_000_456_789_123n },
			{ owner: address, assetAddress: rediscoveredAddress, assetKind: 'rep', balance: 3_000_000_000_000_000_000n },
			{ owner: address, assetAddress: wethAddress, assetKind: 'weth', balance: 1_234_567_890_123_456_789n },
			{ owner: address, assetAddress: secondWethAddress, assetKind: 'weth', balance: 222_222_222_222_222_222n },
		],
		writeLease,
	)
	await database.seedNetwork({ ...network, contracts: [[discoveredAddress, 'Temporarily promoted pool', 'securityPool']] }, { lease: writeLease })
	await database.seedNetwork({ ...network, contracts: [] }, { lease: writeLease })
	const reconciledContracts = await database.contracts(chainId)
	expect(reconciledContracts.has(address.toLowerCase())).toBe(false)
	expect(reconciledContracts.has(promotedAddress.toLowerCase())).toBe(false)
	expect(reconciledContracts.get(discoveredAddress.toLowerCase())).toMatchObject({
		label: 'Discovered pool',
		kind: 'securityPool',
		provenance: 'Factory.DeploySecurityPool',
		discoveryBlock: 2n,
		discoveryTxHash: transactionHash,
	})
	await writeLease.release()
	const blockRows = await database.sql`SELECT hash, canonical FROM blocks WHERE chain_id = ${chainId} AND number = 2 ORDER BY hash`
	expect(blockRows).toHaveLength(2)
	expect(blockRows.filter((row: Record<string, unknown>) => row['canonical'] === true)).toHaveLength(1)
	expect(blockRows.find((row: Record<string, unknown>) => row['hash'] === orphan.hash)?.['canonical']).toBe(false)
	const metadataRows = await database.sql`SELECT block_hash, decimals, canonical FROM token_metadata WHERE chain_id = ${chainId} AND address = ${discoveredAddress.toLowerCase()} ORDER BY block_hash`
	expect(metadataRows).toHaveLength(2)
	expect(metadataRows.find((row: Record<string, unknown>) => row['block_hash'] === orphan.hash)?.['canonical']).toBe(false)
	expect(metadataRows.find((row: Record<string, unknown>) => row['block_hash'] === replacement.hash)).toMatchObject({ canonical: true, decimals: 18 })
}

// Stores a third block whose batched V4 initializations include only the standard REP/ETH market.
export const storeThirdBlockWithV4Markets = async ({ database }: LifecycleContext, replacement: IndexedBlock): Promise<IndexedBlock> => {
	const standardV4MarketId = uniswapV4PoolId(rediscoveredAddress, 3_000, 60)
	const nonstandardV4MarketId = uniswapV4PoolId(rediscoveredAddress, 250, 5)
	const uniswapV4PoolManagerDiscovery: ContractMetadata = {
		address: uniswapV4PoolManagerAddress,
		label: 'Uniswap V4 PoolManager',
		kind: 'uniswapV4PoolManager',
		provenance: 'test',
		discoveryBlock: 3n,
		discoveryTxHash: transactionHash,
	}
	const thirdTransactionHash = blockHash('block-three-transaction')
	const v4Initialize = (logIndex: number, marketId: string, fee: string, tickSpacing: string): StoredLog => ({
		...decodedLog(blockHash('block-three'), logIndex, uniswapV4PoolManagerAddress, 'Initialize', {
			id: marketId,
			currency0: '0x0000000000000000000000000000000000000000',
			currency1: rediscoveredAddress,
			fee,
			tickSpacing,
			hooks: '0x0000000000000000000000000000000000000000',
			sqrtPriceX96: (2n ** 96n).toString(),
		}),
		blockNumber: 3n,
		transactionHash: thirdTransactionHash,
	})
	const thirdLogs = [v4Initialize(1, standardV4MarketId, '3000', '60'), v4Initialize(2, nonstandardV4MarketId, '250', '5')]
	const third: IndexedBlock = {
		...indexedBlock('block-three', replacement.hash, [{ ...uniswapV4PoolManagerDiscovery, discoveryTxHash: thirdTransactionHash }], 'batched V4 initializations'),
		number: 3n,
		timestamp: new Date('2026-01-03T00:00:00Z'),
		observedHead: 3n,
		transactions: [
			{
				...transaction(),
				hash: thirdTransactionHash,
				receipt: {
					transactionHash: thirdTransactionHash,
					blockHash: blockHash('block-three'),
					status: 'success',
					logs: [],
				},
			},
		],
		logs: thirdLogs,
	}
	const thirdWriteLease = await database.tryAcquireIndexerLock(chainId)
	if (thirdWriteLease === undefined) throw new Error('writer did not reacquire for the third canonical block')
	await database.storeBlock(chainId, third, thirdWriteLease)
	expect(await database.checkpoint(chainId)).toEqual({ number: 3n, hash: third.hash })
	await thirdWriteLease.release()
	const storedV4Markets = await database.sql`SELECT market_id FROM uniswap_rep_eth_markets WHERE chain_id = ${chainId} AND block_hash = ${third.hash} AND canonical ORDER BY market_id`
	expect(storedV4Markets).toEqual([{ market_id: standardV4MarketId }])
	const storedV4Observations = await database.sql`SELECT market_id FROM uniswap_rep_eth_price_observations WHERE chain_id = ${chainId} AND block_hash = ${third.hash} AND canonical ORDER BY market_id`
	expect(storedV4Observations).toEqual([{ market_id: standardV4MarketId }])
	return third
}

// Read transactions are repeatable-read snapshots that ignore concurrent canonical changes.
export const expectRepeatableReadSnapshots = async ({ postgresUrl, database, network }: LifecycleContext, third: IndexedBlock): Promise<void> => {
	const readIsolation = await database.read(async sql => {
		const rows = await sql`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only`
		return rows[0]
	})
	expect(readIsolation).toMatchObject({ isolation: 'repeatable read', read_only: 'on' })
	const reorgWriter = new ScannerDatabase(postgresUrl)
	try {
		const snapshotStayedCanonical = await database.read(async sql => {
			const before = await sql`SELECT canonical FROM blocks WHERE chain_id = ${chainId} AND hash = ${third.hash}`
			expect(before[0]?.['canonical']).toBe(true)
			await reorgWriter.sql`UPDATE blocks SET canonical = false WHERE chain_id = ${chainId} AND hash = ${third.hash}`
			const after = await sql`SELECT canonical FROM blocks WHERE chain_id = ${chainId} AND hash = ${third.hash}`
			return after[0]?.['canonical']
		})
		expect(snapshotStayedCanonical).toBe(true)
	} finally {
		await reorgWriter.sql`UPDATE blocks SET canonical = true WHERE chain_id = ${chainId} AND hash = ${third.hash}`
		await reorgWriter.close()
	}
	await database.seedNetwork({ ...network, contracts: [[orphanOnlyAddress, 'New child REP', 'reputationToken']] })
}
