import { runtimeConfig } from './config.ts'
import type { IndexedBlock, IndexerLease, ScannerDatabase, StoredTransaction } from './database.ts'
import {
	type Address,
	createPublicClient,
	getAddress,
	type Hash,
	http,
	type Log,
	type PublicClient,
	parseAbi,
	type Transaction,
	type TransactionReceipt,
} from './ethereum.ts'
import type { LiveBus } from './live.ts'
import { decodeAction, decodeLogRecord, discoveriesFrom, tokenAddressesFrom } from './metadata.ts'
import type { ContractMetadata, NetworkConfig, StoredLog, TokenMetadata } from './types.ts'

const erc20MetadataAbi = parseAbi([
	'function decimals() view returns (uint8)',
	'function name() view returns (string)',
	'function symbol() view returns (string)',
])

export const tokenMetadataNeedsRead = (metadata: TokenMetadata | undefined, blockNumber: bigint): boolean =>
	metadata === undefined || (metadata.decimals === undefined && blockNumber >= metadata.readBlock + 25n)

export const reorgSearchFloor = (startBlock: bigint, checkpoint: bigint, confirmationDepth: bigint): bigint => {
	const candidate = checkpoint > confirmationDepth ? checkpoint - confirmationDepth : startBlock
	return candidate > startBlock ? candidate : startBlock
}

export const requiresParentLookup = (nextBlock: bigint, startBlock: bigint): boolean => nextBlock > startBlock

type TokenMetadataCalls = {
	readonly decimals: () => Promise<number>
	readonly name: () => Promise<string>
	readonly symbol: () => Promise<string>
}

const unavailableMetadataErrors = new Set([
	'AbiDecodingDataSizeInvalidError',
	'AbiDecodingDataSizeTooSmallError',
	'AbiDecodingZeroDataError',
	'ContractFunctionRevertedError',
	'ContractFunctionZeroDataError',
	'IntegerOutOfRangeError',
	'InvalidBytesLengthError',
	'InvalidHexValueError',
	'NegativeOffsetError',
	'PositionOutOfBoundsError',
	'RecursiveReadLimitExceededError',
	'SizeExceedsPaddingSizeError',
	'SizeOverflowError',
	'SliceOffsetOutOfBoundsError',
])

const errorChainIncludes = (error: unknown, names: ReadonlySet<string>): boolean => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('name' in current && typeof current.name === 'string' && names.has(current.name)) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

const isUnavailableMetadataCall = (error: unknown): boolean => errorChainIncludes(error, unavailableMetadataErrors)

const metadataCall = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
	try {
		return await call()
	} catch (error) {
		if (isUnavailableMetadataCall(error)) return undefined
		throw error
	}
}

export const readTokenMetadata = async (address: Address, blockNumber: bigint, calls: TokenMetadataCalls): Promise<TokenMetadata> => {
	const decimals = await metadataCall(calls.decimals)
	if (decimals === undefined || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)
		return { address, readError: 'ERC-20 metadata unavailable', readBlock: blockNumber }
	const [name, symbol] = await Promise.all([metadataCall(calls.name), metadataCall(calls.symbol)])
	return { address, decimals, ...(name === undefined ? {} : { name }), ...(symbol === undefined ? {} : { symbol }), readBlock: blockNumber }
}

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		const timeout = setTimeout(resolve, milliseconds)
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timeout)
				resolve()
			},
			{ once: true },
		)
	})

const chunks = <T>(items: readonly T[], size: number): T[][] => {
	const result: T[][] = []
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
	return result
}

const mapLimit = async <T, R>(items: readonly T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> => {
	const result = new Array<R>(items.length)
	let cursor = 0
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++
			const item = items[index]
			if (item !== undefined) result[index] = await operation(item)
		}
	})
	await Promise.all(workers)
	return result
}

const labelsFrom = (contracts: ReadonlyMap<string, ContractMetadata>): Map<string, string> =>
	new Map([['0x0000000000000000000000000000000000000000', 'Zero address'], ...[...contracts].map(([address, contract]) => [address, contract.label] as const)])

const jsonEvidence = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return value.map(jsonEvidence)
	if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonEvidence(item)]))
	return value
}

const requireLogPosition = (log: Log): { transactionHash: Hash; transactionIndex: number; logIndex: number; blockHash: Hash; blockNumber: bigint } => {
	if (log.transactionHash === null || log.transactionIndex === null || log.logIndex === null || log.blockHash === null || log.blockNumber === null) {
		throw new Error('RPC returned a pending log while indexing a confirmed block')
	}
	return {
		transactionHash: log.transactionHash,
		transactionIndex: log.transactionIndex,
		logIndex: log.logIndex,
		blockHash: log.blockHash,
		blockNumber: log.blockNumber,
	}
}

class ChainContinuityError extends Error {}
class ChainConfigurationError extends Error {}
class LeaseLostError extends Error {}

export const confirmCanonicalBlock = async (number: bigint, expectedHash: Hash, lookup: (blockNumber: bigint) => Promise<Hash>): Promise<void> => {
	const observedHash = await lookup(number)
	if (observedHash !== expectedHash) throw new ChainContinuityError(`Block ${number} changed while it was being indexed`)
}

const databaseFailureMessage = 'Database request failed; retrying'
const databaseFailureNames = new Set(['DatabaseConsistencyError', 'PostgresError'])

export const safeIndexerFailure = (error: unknown): string => {
	if (error instanceof ChainConfigurationError) return error.message
	if (error instanceof ChainContinuityError) return 'The remote canonical chain changed while indexing; retrying'
	if (errorChainIncludes(error, databaseFailureNames)) return databaseFailureMessage
	return 'RPC request failed; retrying'
}

type NetworkLifecycle = {
	readonly verify: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly failure: (message: string) => Promise<void>
	readonly intervalMs: number
	readonly signal: AbortSignal
}

export const runNetworkLifecycle = async ({ verify, poll, failure, intervalMs, signal }: NetworkLifecycle): Promise<void> => {
	let verified = false
	while (!signal.aborted) {
		const startedAt = Date.now()
		let caughtUp = true
		try {
			if (!verified) {
				await verify()
				verified = true
			}
			caughtUp = await poll()
		} catch (error) {
			if (error instanceof LeaseLostError) throw error
			await failure(safeIndexerFailure(error))
		}
		await wait(caughtUp ? Math.max(0, intervalMs - (Date.now() - startedAt)) : 0, signal)
	}
}

type LeaseControl = Pick<IndexerLease, 'assertHeld' | 'release'>

type OwnershipLifecycle<TLease extends LeaseControl> = {
	readonly acquire: () => Promise<TLease | undefined>
	readonly seed: (lease: TLease) => Promise<void>
	readonly runOwned: (lease: TLease) => Promise<void>
	readonly failure: (message: string, lease: TLease | undefined) => Promise<void>
	readonly standby: () => void
	readonly intervalMs: number
	readonly signal: AbortSignal
}

export const runIndexerOwnershipLifecycle = async <TLease extends LeaseControl>({
	acquire,
	seed,
	runOwned,
	failure,
	standby,
	intervalMs,
	signal,
}: OwnershipLifecycle<TLease>): Promise<void> => {
	let standbyReported = false
	while (!signal.aborted) {
		let lease: TLease | undefined
		try {
			lease = await acquire()
			if (lease === undefined) {
				if (!standbyReported) {
					standby()
					standbyReported = true
				}
			} else {
				standbyReported = false
				await lease.assertHeld()
				await seed(lease)
				await runOwned(lease)
			}
		} catch {
			try {
				await failure(databaseFailureMessage, lease)
			} catch (error) {
				console.error(`Unable to record the indexer failure before retrying ownership (${error instanceof Error ? error.name : typeof error})`)
				// A database outage can prevent status recording too; retry ownership regardless.
			}
		} finally {
			try {
				await lease?.release()
			} catch (error) {
				console.error(`Unable to release the indexer lease cleanly (${error instanceof Error ? error.name : typeof error})`)
				// PostgreSQL already releases advisory locks when their session is lost.
			}
		}
		if (!signal.aborted) await wait(intervalMs, signal)
	}
}

export const isProtocolActivitySource = (contract: ContractMetadata | undefined): boolean =>
	contract !== undefined &&
	contract.kind !== 'weth' &&
	contract.kind !== 'reputationToken' &&
	contract.kind !== 'multicall3' &&
	contract.kind !== 'proxyDeployer'

export const isProtocolEvidenceEmitter = (contract: ContractMetadata | undefined): contract is ContractMetadata => contract !== undefined

const requireReceiptPosition = (receipt: TransactionReceipt, blockHash: Hash, blockNumber: bigint): void => {
	if (receipt.blockHash !== blockHash || receipt.blockNumber !== blockNumber) {
		throw new ChainContinuityError(`Receipt ${receipt.transactionHash} no longer belongs to block ${blockNumber}`)
	}
	for (const log of receipt.logs) {
		const position = requireLogPosition(log)
		if (position.blockHash !== blockHash || position.blockNumber !== blockNumber) {
			throw new ChainContinuityError(`Log ${position.transactionHash}:${position.logIndex} no longer belongs to block ${blockNumber}`)
		}
	}
}

class NetworkIndexer {
	readonly #network: NetworkConfig
	readonly #database: ScannerDatabase
	readonly #bus: LiveBus
	readonly #client: PublicClient
	readonly #signal: AbortSignal
	#lease: IndexerLease | undefined

	constructor(network: NetworkConfig, database: ScannerDatabase, bus: LiveBus, signal: AbortSignal) {
		this.#network = network
		this.#database = database
		this.#bus = bus
		this.#signal = signal
		this.#client = createPublicClient({ transport: http(network.rpcUrl, { timeout: 20_000, retryCount: 2 }) })
	}

	async run(): Promise<void> {
		await runIndexerOwnershipLifecycle({
			acquire: () => this.#database.tryAcquireIndexerLock(this.#network.chainId),
			seed: (lease) => this.#database.seedNetwork(this.#network, lease),
			runOwned: async (lease) => {
				this.#lease = lease
				try {
					await runNetworkLifecycle({
						verify: async () => {
							const remoteChainId = await this.#client.getChainId()
							if (remoteChainId !== this.#network.chainId) {
								throw new ChainConfigurationError(`RPC chain mismatch: configured ${this.#network.chainId}, received ${remoteChainId}`)
							}
						},
						poll: () => this.#poll(),
						failure: (message) => this.#recordFailure(message, this.#requireLease()),
						intervalMs: runtimeConfig.pollIntervalMs,
						signal: this.#signal,
					})
				} finally {
					this.#lease = undefined
				}
			},
			failure: async (message, lease) => {
				if (lease === undefined) {
					console.error(`[${this.#network.id}] ownership unavailable: ${message}`)
					return
				}
				await this.#recordFailure(message, lease)
			},
			standby: () => console.info(`[${this.#network.id}] standby: another replica owns the network indexer lock`),
			intervalMs: runtimeConfig.pollIntervalMs,
			signal: this.#signal,
		})
	}

	async #recordFailure(message: string, lease: IndexerLease): Promise<void> {
		await this.#database.recordFailure(this.#network.chainId, message, lease)
		this.#bus.publish('status', { chainId: this.#network.chainId })
		console.error(`[${this.#network.id}] ${message}`)
	}

	async #assertLease(): Promise<void> {
		try {
			await this.#requireLease().assertHeld()
		} catch (error) {
			throw new LeaseLostError('Indexer lease was lost; reacquiring', { cause: error })
		}
	}

	#requireLease(): IndexerLease {
		if (this.#lease === undefined) throw new LeaseLostError('Indexer lease is unavailable; reacquiring')
		return this.#lease
	}

	async #reconcileReorg(): Promise<void> {
		const checkpoint = await this.#database.checkpoint(this.#network.chainId)
		if (checkpoint === undefined) return
		const remote = await this.#client.getBlock({ blockNumber: checkpoint.number })
		if (remote.hash === checkpoint.hash) return
		const floor = reorgSearchFloor(this.#network.startBlock, checkpoint.number, this.#network.confirmationDepth)
		for (let number = checkpoint.number - 1n; number >= floor; number--) {
			const [storedHash, block] = await Promise.all([
				this.#database.canonicalHash(this.#network.chainId, number),
				this.#client.getBlock({ blockNumber: number }),
			])
			if (storedHash !== undefined && storedHash === block.hash) {
				await this.#assertLease()
				await this.#database.rewind(this.#network.chainId, number, storedHash, this.#requireLease())
				return
			}
			if (number === 0n) break
		}
		await this.#assertLease()
		await this.#database.rewind(this.#network.chainId, -1n, undefined, this.#requireLease())
	}

	async #poll(): Promise<boolean> {
		await this.#assertLease()
		await this.#reconcileReorg()
		const observedHead = await this.#client.getBlockNumber()
		const checkpoint = await this.#database.checkpoint(this.#network.chainId)
		let nextBlock = checkpoint === undefined ? this.#network.startBlock : checkpoint.number + 1n
		if (nextBlock > observedHead) {
			await this.#assertLease()
			await this.#database.updateObservedHead(this.#network.chainId, observedHead, 'live', this.#requireLease())
			this.#bus.publish('status', { chainId: this.#network.chainId, blockNumber: observedHead.toString() })
			return true
		}

		const end = nextBlock + BigInt(runtimeConfig.blockBatchSize - 1) < observedHead ? nextBlock + BigInt(runtimeConfig.blockBatchSize - 1) : observedHead
		let contracts = await this.#database.contracts(this.#network.chainId)
		let tokenMetadata = await this.#database.tokenMetadata(this.#network.chainId)
		let expectedParentHash = checkpoint?.hash
		if (expectedParentHash === undefined && requiresParentLookup(nextBlock, this.#network.startBlock)) {
			expectedParentHash = (await this.#client.getBlock({ blockNumber: nextBlock - 1n })).hash
		}
		while (nextBlock <= end && !this.#signal.aborted) {
			let indexed: { block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }
			try {
				indexed = await this.#indexBlock(nextBlock, observedHead, contracts, tokenMetadata, expectedParentHash)
			} catch (error) {
				if (error instanceof ChainContinuityError) {
					await this.#reconcileReorg()
					return false
				}
				throw error
			}
			await this.#assertLease()
			await this.#database.storeBlock(this.#network.chainId, indexed.block, this.#requireLease())
			contracts = indexed.contracts
			tokenMetadata = indexed.tokenMetadata
			expectedParentHash = indexed.block.hash
			this.#bus.publish('block', { chainId: this.#network.chainId, blockNumber: nextBlock.toString(), logs: indexed.block.logs.length })
			nextBlock++
		}
		return end >= observedHead
	}

	async #getKnownLogs(blockNumber: bigint, addresses: readonly Address[], blockHash: Hash): Promise<Log[]> {
		const groups = chunks(addresses, 75)
		const pages = await mapLimit(groups, 3, (address) => this.#client.getLogs({ address, fromBlock: blockNumber, toBlock: blockNumber }))
		const unique = new Map<string, Log>()
		for (const log of pages.flat()) {
			const position = requireLogPosition(log)
			if (position.blockHash !== blockHash || position.blockNumber !== blockNumber) {
				throw new ChainContinuityError(`RPC log response changed while indexing block ${blockNumber}`)
			}
			unique.set(`${position.transactionHash}:${position.logIndex}`, log)
		}
		return [...unique.values()].sort((left, right) => {
			const a = requireLogPosition(left)
			const b = requireLogPosition(right)
			return a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
		})
	}

	async #indexBlock(
		number: bigint,
		observedHead: bigint,
		currentContracts: ReadonlyMap<string, ContractMetadata>,
		currentTokenMetadata: ReadonlyMap<string, TokenMetadata>,
		expectedParentHash: Hash | undefined,
	): Promise<{ block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }> {
		const block = await this.#client.getBlock({ blockNumber: number, includeTransactions: true })
		if (expectedParentHash !== undefined && block.parentHash !== expectedParentHash) {
			throw new ChainContinuityError(`Block ${number} does not extend the indexed canonical chain`)
		}
		const contracts = new Map(currentContracts)
		const knownAddresses = [...contracts.values()].filter(isProtocolActivitySource).map(({ address }) => address)
		const knownLogs = knownAddresses.length === 0 ? [] : await this.#getKnownLogs(number, knownAddresses, block.hash)
		const relevantHashes = new Set<Hash>(knownLogs.map((log) => requireLogPosition(log).transactionHash))
		const transactionByHash = new Map<Hash, { transaction: Transaction; index: number }>()
		block.transactions.forEach((transaction, index) => {
			if (typeof transaction === 'string') return
			transactionByHash.set(transaction.hash, { transaction, index })
			if (transaction.to !== null && isProtocolActivitySource(contracts.get(transaction.to.toLowerCase()))) relevantHashes.add(transaction.hash)
		})

		const receipts: TransactionReceipt[] = []
		const receiptByHash = new Map<Hash, TransactionReceipt>()
		const fetchMissingReceipts = async (): Promise<void> => {
			const missing = [...relevantHashes].filter((hash) => !receiptByHash.has(hash))
			for (const receipt of await mapLimit(missing, 8, (hash) => this.#client.getTransactionReceipt({ hash }))) {
				requireReceiptPosition(receipt, block.hash, number)
				receipts.push(receipt)
				receiptByHash.set(receipt.transactionHash, receipt)
			}
		}
		await fetchMissingReceipts()
		const discovered: ContractMetadata[] = []
		while (true) {
			const discoveredAddresses: Address[] = []
			const labels = labelsFrom(contracts)
			for (const receipt of receipts) {
				for (const log of receipt.logs) {
					const emitter = log.address.toLowerCase()
					const contract = contracts.get(emitter)
					if (contract === undefined) continue
					const decoded = decodeLogRecord(contract.kind, log.topics, log.data, labels)
					for (const candidate of discoveriesFrom(decoded)) {
						const key = candidate.address.toLowerCase()
						if (contracts.has(key)) continue
						const metadata: ContractMetadata = {
							...candidate,
							provenance: `${contract.label}.${decoded.name ?? 'event'}`,
							discoveryBlock: number,
							discoveryTxHash: receipt.transactionHash,
						}
						contracts.set(key, metadata)
						discovered.push(metadata)
						discoveredAddresses.push(metadata.address)
					}
				}
			}
			if (discoveredAddresses.length === 0) break
			const activityAddresses = discoveredAddresses.filter((address) => isProtocolActivitySource(contracts.get(address.toLowerCase())))
			for (const log of activityAddresses.length === 0 ? [] : await this.#getKnownLogs(number, activityAddresses, block.hash)) {
				relevantHashes.add(requireLogPosition(log).transactionHash)
			}
			for (const { transaction } of transactionByHash.values()) {
				if (transaction.to !== null && isProtocolActivitySource(contracts.get(transaction.to.toLowerCase()))) relevantHashes.add(transaction.hash)
			}
			await fetchMissingReceipts()
		}

		const labels = labelsFrom(contracts)
		const tokenMetadata = new Map(currentTokenMetadata)
		const tokenCandidates = new Set<Address>()
		for (const metadata of tokenMetadata.values()) if (metadata.decimals === undefined) tokenCandidates.add(metadata.address)
		for (const contract of contracts.values()) {
			if (contract.kind === 'reputationToken' || contract.kind === 'shareToken' || contract.kind === 'weth') tokenCandidates.add(contract.address)
		}
		for (const receipt of receipts) {
			for (const item of receipt.logs) {
				const contract = contracts.get(item.address.toLowerCase())
				if (contract === undefined) continue
				const decoded = decodeLogRecord(contract.kind, item.topics, item.data, labels)
				for (const candidate of tokenAddressesFrom(contract.kind, decoded, contract.address)) tokenCandidates.add(candidate)
			}
		}
		for (const hash of relevantHashes) {
			const pair = transactionByHash.get(hash)
			if (pair?.transaction.to === null || pair?.transaction.to === undefined) continue
			const contract = contracts.get(pair.transaction.to.toLowerCase())
			if (contract === undefined) continue
			const decoded = decodeAction(contract, pair.transaction.input, labels)
			for (const candidate of tokenAddressesFrom(contract.kind, decoded, contract.address)) tokenCandidates.add(candidate)
		}
		const readTokenMetadata = await mapLimit(
			[...tokenCandidates].filter((candidate) => tokenMetadataNeedsRead(tokenMetadata.get(candidate.toLowerCase()), number)),
			4,
			(candidate) => this.#readTokenMetadata(candidate, number),
		)
		for (const metadata of readTokenMetadata) tokenMetadata.set(metadata.address.toLowerCase(), metadata)
		const displayLabels = new Map(labels)
		const contractKinds = new Map([...contracts].map(([address, contract]) => [address, contract.kind] as const))
		for (const metadata of tokenMetadata.values()) {
			const label = metadata.name ?? metadata.symbol
			if (label !== undefined) displayLabels.set(metadata.address.toLowerCase(), metadata.symbol === undefined ? label : `${label} (${metadata.symbol})`)
		}
		const storedLogs: StoredLog[] = []
		for (const receipt of receipts) {
			for (const log of receipt.logs) {
				const contract = contracts.get(log.address.toLowerCase())
				if (!isProtocolEvidenceEmitter(contract)) continue
				const position = requireLogPosition(log)
				storedLogs.push({
					...position,
					address: getAddress(log.address),
					topics: log.topics,
					data: log.data,
					decoded: decodeLogRecord(contract.kind, log.topics, log.data, displayLabels, tokenMetadata, contract.address, contractKinds),
				})
			}
		}

		const storedTransactions: StoredTransaction[] = []
		for (const hash of relevantHashes) {
			const pair = transactionByHash.get(hash)
			const receipt = receiptByHash.get(hash)
			if (pair === undefined || receipt === undefined) throw new Error(`Block ${number} did not contain relevant transaction ${hash}`)
			const to = pair.transaction.to === null ? null : getAddress(pair.transaction.to)
			storedTransactions.push({
				hash,
				transactionIndex: pair.index,
				from: getAddress(pair.transaction.from),
				to,
				value: pair.transaction.value,
				input: pair.transaction.input,
				status: receipt.status,
				gasUsed: receipt.gasUsed,
				receipt: jsonEvidence(receipt),
				decoded: decodeAction(to === null ? undefined : contracts.get(to.toLowerCase()), pair.transaction.input, displayLabels, tokenMetadata, contractKinds),
			})
		}

		const finalizedThrough = observedHead > this.#network.confirmationDepth ? observedHead - this.#network.confirmationDepth : 0n
		await confirmCanonicalBlock(number, block.hash, async (blockNumber) => (await this.#client.getBlock({ blockNumber })).hash)
		return {
			contracts,
			tokenMetadata,
			block: {
				number,
				hash: block.hash,
				parentHash: block.parentHash,
				timestamp: new Date(Number(block.timestamp) * 1000),
				observedHead,
				finalizedThrough,
				contracts: discovered,
				tokenMetadata: readTokenMetadata,
				transactions: storedTransactions,
				logs: storedLogs,
			},
		}
	}

	async #readTokenMetadata(address: Address, blockNumber: bigint): Promise<TokenMetadata> {
		return await readTokenMetadata(address, blockNumber, {
			decimals: () => this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'decimals', blockNumber }),
			name: () => this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'name', blockNumber }),
			symbol: () => this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'symbol', blockNumber }),
		})
	}
}

export const startIndexers = (networks: readonly NetworkConfig[], database: ScannerDatabase, bus: LiveBus, signal: AbortSignal): readonly Promise<void>[] =>
	networks.map(async (network) => {
		try {
			await new NetworkIndexer(network, database, bus, signal).run()
		} catch (error) {
			const message = safeIndexerFailure(error)
			console.error(`[${network.id}] indexer stopped: ${message}`)
		}
	})
