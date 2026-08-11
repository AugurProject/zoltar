import { runtimeConfig } from './config.ts'
import type { AddressActivity, IndexedBlock, IndexerLease, RichListBalance, ScannerDatabase, StoredTransaction } from './database.ts'
import {
	type Address,
	createPublicClient,
	getAddress,
	type Hash,
	type Hex,
	http,
	type Log,
	type PublicClient,
	parseAbi,
	type Transaction,
	type TransactionReceipt,
	zeroAddress,
} from './ethereum.ts'
import { decodeAction, decodeLogRecord, discoveriesFrom, tokenAddressesFrom } from './metadata.ts'
import { unixSecondsToDate } from './time.ts'
import type { ContractMetadata, NetworkConfig, StoredLog, TokenMetadata } from './types.ts'

const erc20MetadataAbi = parseAbi([
	'function decimals() view returns (uint8)',
	'function name() view returns (string)',
	'function symbol() view returns (string)',
])
const erc20BalanceAbi = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
const priceCoordinatorDependenciesAbi = parseAbi(['function liquidationApprovalRegistry() view returns (address)'])

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

export const waitForIndexerDelay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		const finish = (): void => {
			clearTimeout(timeout)
			signal.removeEventListener('abort', finish)
			resolve()
		}
		const timeout = setTimeout(finish, milliseconds)
		if (signal.aborted) finish()
		else signal.addEventListener('abort', finish, { once: true })
	})

export const findContractDeploymentBlock = async (
	startBlock: bigint,
	observedHead: bigint,
	codeAt: (block: bigint) => Promise<Hex | undefined>,
): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> => {
	const hasCode = async (block: bigint): Promise<boolean> => {
		const code = await codeAt(block)
		return code !== undefined && code !== '0x'
	}
	if (!(await hasCode(observedHead))) return undefined
	if (await hasCode(startBlock)) return { block: startBlock, exact: false }
	let lower = startBlock
	let upper = observedHead
	while (lower + 1n < upper) {
		const middle = lower + (upper - lower) / 2n
		if (await hasCode(middle)) upper = middle
		else lower = middle
	}
	return { block: upper, exact: true }
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
	const result: T[][] = []
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
	return result
}

export const rpcLogAddressGroups = <T>(addresses: readonly T[]): readonly T[][] => chunks(addresses, 5)

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

export const addressActivityFrom = (
	transactions: readonly StoredTransaction[],
	logs: readonly StoredLog[],
	contracts: ReadonlyMap<string, ContractMetadata>,
): readonly AddressActivity[] => {
	const result = new Map<string, AddressActivity>()
	for (const transaction of transactions) {
		const transactionLogs = logs.filter((log) => log.transactionHash === transaction.hash)
		const referencedAddresses = [...(transaction.decoded.referencedAddresses ?? []), ...transactionLogs.flatMap((log) => log.decoded.referencedAddresses ?? [])]
		const pools = new Set<Address>()
		if (transaction.to !== null && contracts.get(transaction.to.toLowerCase())?.kind === 'securityPool') pools.add(transaction.to)
		for (const log of transactionLogs) if (contracts.get(log.address.toLowerCase())?.kind === 'securityPool') pools.add(log.address)
		for (const candidate of referencedAddresses) {
			if (contracts.get(candidate.toLowerCase())?.kind === 'securityPool') pools.add(candidate)
		}
		const participants = new Map<string, { address: Address; role: 'sender' | 'referenced' }>()
		participants.set(transaction.from.toLowerCase(), { address: transaction.from, role: 'sender' })
		for (const candidate of referencedAddresses) {
			if (!participants.has(candidate.toLowerCase())) participants.set(candidate.toLowerCase(), { address: candidate, role: 'referenced' })
		}
		const associatedPools: readonly (Address | undefined)[] = pools.size === 0 ? [undefined] : [...pools]
		for (const participant of participants.values()) {
			for (const poolAddress of associatedPools) {
				const key = `${transaction.hash}:${participant.address.toLowerCase()}:${poolAddress?.toLowerCase() ?? zeroAddress}`
				result.set(key, {
					transactionHash: transaction.hash,
					address: participant.address,
					role: participant.role,
					...(poolAddress === undefined ? {} : { poolAddress }),
				})
			}
		}
	}
	return [...result.values()]
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

type ChainProvider = { readonly getChainId: () => Promise<number> }

export const rpcEndpointLabel = (rpcUrl: string): string => {
	const url = new URL(rpcUrl)
	const hostnameParts = url.hostname.split('.')
	const isLocalOrIp = url.hostname === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':')
	const hostname = !isLocalOrIp && hostnameParts.length > 2 ? `*.${hostnameParts.slice(-2).join('.')}` : url.hostname
	return `${url.protocol}//${hostname}${url.port === '' ? '' : `:${url.port}`}`
}

export const rpcProviderLabel = (rpcUrl: string, index: number): string => `#${index + 1} ${rpcEndpointLabel(rpcUrl)}`

export const rpcFailureLogMessage = (message: string, endpoint: string, reason?: string): string =>
	`${message} (RPC: ${endpoint}${reason === undefined ? '' : `; reason: ${reason}`})`

export const withVerifiedProvider = async <TProvider extends ChainProvider, TResult>(
	providers: readonly TProvider[],
	chainId: number,
	operation: (provider: TProvider) => Promise<TResult>,
	stopFailover = (_error: unknown): boolean => false,
	onAttempt = (_provider: TProvider): void => {},
): Promise<TResult> => {
	let lastFailure: unknown
	for (const provider of providers) {
		onAttempt(provider)
		try {
			const remoteChainId = await provider.getChainId()
			if (remoteChainId !== chainId) throw new ChainConfigurationError(`RPC chain mismatch: configured ${chainId}, received ${remoteChainId}`)
			return await operation(provider)
		} catch (error) {
			if (stopFailover(error)) throw error
			lastFailure = error
		}
	}
	throw lastFailure ?? new ChainConfigurationError('No RPC provider is available for the configured network')
}

export const confirmCanonicalBlock = async (number: bigint, expectedHash: Hash, lookup: (blockNumber: bigint) => Promise<Hash>): Promise<void> => {
	const observedHash = await lookup(number)
	if (observedHash !== expectedHash) throw new ChainContinuityError(`Block ${number} changed while it was being indexed`)
}

export const commitCanonicalRead = async <T>(
	number: bigint,
	expectedHash: Hash,
	read: () => Promise<T>,
	lookup: (blockNumber: bigint) => Promise<Hash>,
	commit: (value: T) => Promise<void>,
): Promise<void> => {
	const value = await read()
	await confirmCanonicalBlock(number, expectedHash, lookup)
	await commit(value)
}

const databaseFailureMessage = 'Database request failed; retrying'
const databaseFailureNames = new Set(['DatabaseConsistencyError', 'PostgresError'])

export const indexingCompletion = (configuredStartBlock: bigint, indexedBlock: bigint, observedHead: bigint) => {
	if (observedHead < configuredStartBlock) return { completedBlocks: 0n, percentage: '100.00', remainingBlocks: 0n, totalBlocks: 0n }
	const boundedHead = observedHead
	const totalBlocks = boundedHead - configuredStartBlock + 1n
	const boundedIndexed = indexedBlock < configuredStartBlock ? configuredStartBlock - 1n : indexedBlock > boundedHead ? boundedHead : indexedBlock
	const completedBlocks = boundedIndexed - configuredStartBlock + 1n
	const remainingBlocks = totalBlocks - completedBlocks
	const roundedHundredths = (completedBlocks * 10_000n + totalBlocks / 2n) / totalBlocks
	const hundredths = remainingBlocks > 0n && roundedHundredths >= 10_000n ? 9_999n : roundedHundredths
	return {
		completedBlocks,
		percentage: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`,
		remainingBlocks,
		totalBlocks,
	}
}

export const compactIndexerDuration = (seconds: number): string => {
	const rounded = Math.max(1, Math.ceil(seconds))
	if (rounded < 60) return `${rounded}s`
	if (rounded < 3_600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`
	const totalHours = Math.ceil(rounded / 3_600)
	if (totalHours < 24) {
		const totalMinutes = Math.ceil(rounded / 60)
		const minutes = totalMinutes % 60
		return `${Math.floor(totalMinutes / 60)}h${minutes === 0 ? '' : ` ${minutes}m`}`
	}
	const hours = totalHours % 24
	return `${Math.floor(totalHours / 24)}d${hours === 0 ? '' : ` ${hours}h`}`
}

export const indexerWaitingMessage = (networkId: string, configuredStartBlock: bigint, observedHead: bigint): string =>
	`[${networkId}] indexer state: live; observed head #${observedHead}; 100.00% complete; caught up; waiting for configured start block #${configuredStartBlock}`

export const indexerProgressMessage = (
	networkId: string,
	startBlock: bigint,
	endBlock: bigint,
	observedHead: bigint,
	configuredStartBlock: bigint,
	blocksPerSecond?: number,
): string => {
	const state = endBlock >= observedHead ? 'live' : 'backfilling'
	const indexed = startBlock === endBlock ? `indexed block #${endBlock}` : `indexed blocks #${startBlock}–#${endBlock}`
	const completion = indexingCompletion(configuredStartBlock, endBlock, observedHead)
	const progress =
		state === 'live'
			? 'caught up'
			: `${completion.remainingBlocks} blocks behind; ${blocksPerSecond === undefined ? 'estimating ETA' : `ETA ${compactIndexerDuration(Number(completion.remainingBlocks) / blocksPerSecond)}`}`
	return `[${networkId}] indexer state: ${state}; ${indexed}; observed head #${observedHead}; ${completion.percentage}% complete; ${progress}`
}

export const safeIndexerFailure = (error: unknown): string => {
	if (error instanceof ChainConfigurationError) return error.message
	if (error instanceof ChainContinuityError) return 'The remote canonical chain changed while indexing; retrying'
	if (errorChainIncludes(error, databaseFailureNames)) return databaseFailureMessage
	return 'RPC request failed; retrying'
}

const safeErrorNames = new Set([
	'AbortError',
	'ChainConfigurationError',
	'ChainContinuityError',
	'ConnectTimeoutError',
	'ContractFunctionExecutionError',
	'ContractFunctionRevertedError',
	'DatabaseConsistencyError',
	'Error',
	'HeadersTimeoutError',
	'HttpRequestError',
	'LeaseLostError',
	'LimitExceededRpcError',
	'PostgresError',
	'ResourceUnavailableRpcError',
	'RpcRequestError',
	'SocketError',
	'TimeoutError',
	'TypeError',
	'UnknownRpcError',
])

const safeErrorIdentifier = (value: unknown): string | undefined => (typeof value === 'string' && safeErrorNames.has(value) ? value : undefined)

const safeNamedErrorCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'ERR_POSTGRES_CONNECTION_CLOSED'])

const safeErrorCode = (value: unknown): string | undefined => {
	if (typeof value === 'number' && Number.isSafeInteger(value)) return value.toString()
	return typeof value === 'string' && (/^HTTP_[1-5][0-9]{2}$/.test(value) || safeNamedErrorCodes.has(value)) ? value : undefined
}

export const safeIndexerFailureReason = (error: unknown): string => {
	const names: string[] = []
	let status: number | undefined
	let code: string | undefined
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		const name = 'name' in current ? safeErrorIdentifier(current.name) : undefined
		if (name !== undefined && names.at(-1) !== name) names.push(name)
		if (
			status === undefined &&
			'status' in current &&
			typeof current.status === 'number' &&
			Number.isInteger(current.status) &&
			current.status >= 100 &&
			current.status <= 599
		)
			status = current.status
		if (code === undefined && 'code' in current) code = safeErrorCode(current.code)
		current = 'cause' in current ? current.cause : undefined
	}
	const details = [names.length === 0 ? 'UnknownError' : names.slice(0, 4).join(' caused by ')]
	if (status !== undefined) details.push(`HTTP ${status}`)
	if (code !== undefined) details.push(`code ${code}`)
	return details.join('; ')
}

const deploymentReadTimeoutError = (): Error => {
	const error = new Error('Contract deployment history read timed out')
	error.name = 'TimeoutError'
	return error
}

export const boundedDeploymentRead = async <T>(read: () => Promise<T>, timeoutMs: number): Promise<T> =>
	await new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(deploymentReadTimeoutError())
		}, timeoutMs)
		void read()
			.then(resolve, reject)
			.finally(() => clearTimeout(timeout))
	})

export const deploymentReadBudget = (timeoutMs = 5_000, now = Date.now): (<T>(read: () => Promise<T>) => Promise<T>) => {
	const deadline = now() + timeoutMs
	return async <T>(read: () => Promise<T>): Promise<T> => {
		const remaining = deadline - now()
		if (remaining <= 0) throw deploymentReadTimeoutError()
		const value = await boundedDeploymentRead(read, remaining)
		if (now() > deadline) throw deploymentReadTimeoutError()
		return value
	}
}

export const contractDeploymentScanDue = (lastCompletedAt: number | undefined, now: number, cooldownMs = 60_000): boolean =>
	lastCompletedAt === undefined || now - lastCompletedAt >= cooldownMs

type NetworkLifecycle = {
	readonly verify: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly failure: (message: string, nextRetryAt: Date, reason: string) => Promise<void>
	readonly intervalMs: number
	readonly signal: AbortSignal
	readonly random?: () => number
}

export const retryDelayMs = (consecutiveFailures: number, intervalMs: number, random = Math.random): number => {
	const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 8)
	const base = Math.min(intervalMs * 2 ** exponent, 300_000)
	return Math.min(Math.round(base * (0.8 + random() * 0.4)), 300_000)
}

export const runNetworkLifecycle = async ({ verify, poll, failure, intervalMs, signal, random }: NetworkLifecycle): Promise<void> => {
	let verified = false
	let consecutiveFailures = 0
	while (!signal.aborted) {
		const startedAt = Date.now()
		let caughtUp = true
		let delayAfterFailure: number | undefined
		try {
			if (!verified) {
				await verify()
				verified = true
			}
			caughtUp = await poll()
			consecutiveFailures = 0
		} catch (error) {
			if (error instanceof LeaseLostError) throw error
			consecutiveFailures++
			delayAfterFailure = retryDelayMs(consecutiveFailures, intervalMs, random)
			await failure(safeIndexerFailure(error), new Date(Date.now() + delayAfterFailure), safeIndexerFailureReason(error))
		}
		await waitForIndexerDelay(delayAfterFailure ?? (caughtUp ? Math.max(0, intervalMs - (Date.now() - startedAt)) : 0), signal)
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
		} catch (error) {
			console.error(`Indexer ownership operation failed (${error instanceof Error ? error.name : typeof error})`)
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
		if (!signal.aborted) await waitForIndexerDelay(intervalMs, signal)
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
	readonly #providers: readonly { readonly client: PublicClient; readonly endpoint: string; readonly getChainId: () => Promise<number> }[]
	#client: PublicClient
	#activeRpcEndpoint: string
	#indexingStartReported = false
	#lastProgressLogAt: number | undefined
	#progressSample: { block: bigint; sampledAt: number; blocksPerSecond?: number } | undefined
	#lastReportedPhase: 'backfilling' | 'degraded' | 'live' | undefined
	#lastDeploymentScanAt: number | undefined
	readonly #signal: AbortSignal
	#lease: IndexerLease | undefined

	constructor(network: NetworkConfig, database: ScannerDatabase, signal: AbortSignal) {
		this.#network = network
		this.#database = database
		this.#signal = signal
		this.#providers = network.rpcUrls.map((rpcUrl, index) => {
			const client = createPublicClient({ transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) })
			return { client, endpoint: rpcProviderLabel(rpcUrl, index), getChainId: () => client.getChainId() }
		})
		const firstProvider = this.#providers[0]
		if (firstProvider === undefined) throw new ChainConfigurationError('At least one RPC provider is required')
		this.#client = firstProvider.client
		this.#activeRpcEndpoint = firstProvider.endpoint
	}

	async run(): Promise<void> {
		console.info(`[${this.#network.id}] indexer state: starting`)
		console.info(`[${this.#network.id}] RPC providers: ${this.#providers.map(({ endpoint }) => endpoint).join(', ')}`)
		await runIndexerOwnershipLifecycle({
			acquire: () => this.#database.tryAcquireIndexerLock(this.#network.chainId),
			seed: (lease) => this.#database.seedNetwork(this.#network, lease),
			runOwned: async (lease) => {
				this.#lease = lease
				try {
					await runNetworkLifecycle({
						verify: () => this.#withProviderFailover(async () => undefined),
						poll: () => this.#withProviderFailover(() => this.#poll()),
						failure: (message, nextRetryAt, reason) => this.#recordFailure(message, nextRetryAt, this.#requireLease(), reason),
						intervalMs: runtimeConfig.pollIntervalMs,
						signal: this.#signal,
					})
				} finally {
					this.#lease = undefined
				}
			},
			failure: async (message, lease) => {
				if (lease === undefined) {
					console.error(`[${this.#network.id}] indexer state: degraded; ownership unavailable: ${message}`)
					return
				}
				await this.#recordFailure(message, new Date(Date.now() + runtimeConfig.pollIntervalMs), lease)
			},
			standby: () => console.info(`[${this.#network.id}] indexer state: standby; another replica owns the network indexer lock`),
			intervalMs: runtimeConfig.pollIntervalMs,
			signal: this.#signal,
		})
	}

	async #withProviderFailover<T>(operation: () => Promise<T>): Promise<T> {
		return await withVerifiedProvider(
			this.#providers,
			this.#network.chainId,
			async ({ client }) => {
				this.#client = client
				return await operation()
			},
			(error) => error instanceof LeaseLostError || errorChainIncludes(error, databaseFailureNames),
			(provider) => {
				this.#activeRpcEndpoint = provider.endpoint
			},
		)
	}

	async #verifyRemoteChain(): Promise<void> {
		const remoteChainId = await this.#client.getChainId()
		if (remoteChainId !== this.#network.chainId) {
			throw new ChainConfigurationError(`RPC chain mismatch: configured ${this.#network.chainId}, received ${remoteChainId}`)
		}
	}

	async #recordFailure(message: string, nextRetryAt: Date, lease: IndexerLease, reason?: string): Promise<void> {
		await this.#database.recordFailure(this.#network.chainId, message, nextRetryAt, lease)
		const logMessage =
			message === databaseFailureMessage
				? `${message}${reason === undefined ? '' : ` (reason: ${reason})`}`
				: rpcFailureLogMessage(message, this.#activeRpcEndpoint, reason)
		this.#lastReportedPhase = 'degraded'
		console.error(`[${this.#network.id}] indexer state: degraded; ${logMessage}`)
	}

	#reportProgress(startBlock: bigint, endBlock: bigint, observedHead: bigint): void {
		const phase = endBlock >= observedHead ? 'live' : 'backfilling'
		const now = Date.now()
		const previousSample = this.#progressSample
		let blocksPerSecond = previousSample?.blocksPerSecond
		if (previousSample !== undefined && endBlock > previousSample.block && now - previousSample.sampledAt >= 1_000) {
			const observedRate = Number(endBlock - previousSample.block) / ((now - previousSample.sampledAt) / 1_000)
			blocksPerSecond = blocksPerSecond === undefined ? observedRate : blocksPerSecond * 0.7 + observedRate * 0.3
			this.#progressSample = { block: endBlock, sampledAt: now, blocksPerSecond }
		} else if (previousSample === undefined || endBlock < previousSample.block) {
			this.#progressSample = { block: endBlock, sampledAt: now }
		}
		if (phase === 'backfilling' && this.#lastReportedPhase === phase && this.#lastProgressLogAt !== undefined && now - this.#lastProgressLogAt < 30_000) return
		this.#lastReportedPhase = phase
		this.#lastProgressLogAt = now
		console.info(indexerProgressMessage(this.#network.id, startBlock, endBlock, observedHead, this.#network.startBlock, blocksPerSecond))
	}

	#reportWaitingForStart(observedHead: bigint): void {
		if (this.#lastReportedPhase === 'live') return
		this.#lastReportedPhase = 'live'
		this.#lastProgressLogAt = Date.now()
		console.info(indexerWaitingMessage(this.#network.id, this.#network.startBlock, observedHead))
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

	async #refreshContractDeployment(indexedBoundary: bigint): Promise<void> {
		const now = Date.now()
		if (!contractDeploymentScanDue(this.#lastDeploymentScanAt, now)) return
		try {
			const candidate = await this.#database.contractDeploymentCandidate(this.#network.chainId, indexedBoundary, this.#requireLease())
			if (candidate === undefined) return
			const readWithinBudget = deploymentReadBudget()
			const deployment = await findContractDeploymentBlock(this.#network.startBlock, indexedBoundary, (blockNumber) =>
				readWithinBudget(() => this.#client.getBytecode({ address: candidate.address, blockNumber })),
			)
			const resolved =
				deployment === undefined
					? undefined
					: {
							...deployment,
							timestamp: new Date(Number((await readWithinBudget(() => this.#client.getBlock({ blockNumber: deployment.block }))).timestamp) * 1_000),
						}
			await this.#assertLease()
			await this.#database.recordContractDeployment(this.#network.chainId, candidate.address, indexedBoundary, resolved, this.#requireLease())
		} catch (error) {
			console.warn(`[${this.#network.id}] contract deployment check skipped: ${safeIndexerFailureReason(error)}`)
		} finally {
			this.#lastDeploymentScanAt = Date.now()
		}
	}

	async #poll(): Promise<boolean> {
		await this.#assertLease()
		await this.#verifyRemoteChain()
		await this.#reconcileReorg()
		const observedHead = await this.#client.getBlockNumber()
		const checkpoint = await this.#database.checkpoint(this.#network.chainId)
		let nextBlock = checkpoint === undefined ? this.#network.startBlock : checkpoint.number + 1n
		if (nextBlock > observedHead) {
			if (checkpoint !== undefined) await this.#refreshRichListBalances(checkpoint.number, checkpoint.hash)
			await this.#verifyRemoteChain()
			await this.#assertLease()
			await this.#database.updateObservedHead(this.#network.chainId, observedHead, 'live', this.#requireLease())
			if (checkpoint === undefined) this.#reportWaitingForStart(observedHead)
			else if (this.#lastReportedPhase !== 'live') this.#reportProgress(observedHead, observedHead, observedHead)
			if (checkpoint !== undefined) await this.#refreshContractDeployment(checkpoint.number)
			return true
		}

		if (!this.#indexingStartReported) {
			const completion = indexingCompletion(this.#network.startBlock, nextBlock - 1n, observedHead)
			console.info(
				`[${this.#network.id}] indexer state: backfilling; fetching from block #${nextBlock}; observed head #${observedHead}; ${completion.percentage}% complete; ${completion.remainingBlocks} blocks behind; estimating ETA`,
			)
			this.#progressSample = { block: nextBlock - 1n, sampledAt: Date.now() }
			this.#indexingStartReported = true
		}
		const batchStart = nextBlock
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
			await this.#verifyRemoteChain()
			await this.#assertLease()
			await this.#database.storeBlock(this.#network.chainId, indexed.block, this.#requireLease())
			contracts = indexed.contracts
			tokenMetadata = indexed.tokenMetadata
			expectedParentHash = indexed.block.hash
			nextBlock++
		}
		if (nextBlock > batchStart) {
			const indexedThrough = nextBlock - 1n
			this.#reportProgress(batchStart, indexedThrough, observedHead)
			await this.#refreshContractDeployment(indexedThrough)
		}
		return end >= observedHead
	}

	async #getKnownLogs(blockNumber: bigint, addresses: readonly Address[], blockHash: Hash): Promise<Log[]> {
		const groups = rpcLogAddressGroups(addresses)
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
			for (const coordinator of discovered.filter((contract) => contract.kind === 'priceCoordinator')) {
				const registryAddress = await this.#client.readContract({
					address: coordinator.address,
					abi: priceCoordinatorDependenciesAbi,
					functionName: 'liquidationApprovalRegistry',
					blockNumber: number,
				})
				const registry = getAddress(registryAddress)
				if (!contracts.has(registry.toLowerCase())) {
					const metadata: ContractMetadata = {
						address: registry,
						kind: 'liquidationApprovalRegistry',
						label: 'Liquidation Approval Registry',
						provenance: `${coordinator.label}.liquidationApprovalRegistry`,
						discoveryBlock: number,
						discoveryTxHash: coordinator.discoveryTxHash,
					}
					contracts.set(registry.toLowerCase(), metadata)
					discovered.push(metadata)
					discoveredAddresses.push(registry)
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
		const displayContext = { nativeSymbol: this.#network.nativeSymbol }
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
					decoded: decodeLogRecord(contract.kind, log.topics, log.data, displayLabels, tokenMetadata, contract.address, contractKinds, displayContext),
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
				decoded: decodeAction(
					to === null ? undefined : contracts.get(to.toLowerCase()),
					pair.transaction.input,
					displayLabels,
					tokenMetadata,
					contractKinds,
					displayContext,
				),
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
				timestamp: unixSecondsToDate(block.timestamp, 'Block timestamp'),
				observedHead,
				finalizedThrough,
				contracts: discovered,
				tokenMetadata: readTokenMetadata,
				transactions: storedTransactions,
				logs: storedLogs,
				addressActivity: addressActivityFrom(storedTransactions, storedLogs, contracts),
			},
		}
	}

	async #refreshRichListBalances(blockNumber: bigint, blockHash: Hash): Promise<void> {
		const targets = await this.#database.richListBalanceTargets(this.#network.chainId)
		if (targets.addresses.length === 0) return
		await commitCanonicalRead(
			blockNumber,
			blockHash,
			async () => {
				const balances: RichListBalance[] = []
				const nativeBalances = await mapLimit(targets.addresses, 8, async (owner) => ({
					owner,
					assetAddress: zeroAddress,
					assetKind: 'native' as const,
					balance: await this.#client.getBalance({ address: owner, blockNumber }),
				}))
				balances.push(...nativeBalances)
				const tokenRequests = targets.addresses.flatMap((owner) => targets.assets.map((asset) => ({ owner, asset })))
				balances.push(
					...(await mapLimit(tokenRequests, 8, async ({ owner, asset }) => ({
						owner,
						assetAddress: asset.address,
						assetKind: asset.kind,
						balance: await this.#client.readContract({
							address: asset.address,
							abi: erc20BalanceAbi,
							functionName: 'balanceOf',
							args: [owner],
							blockNumber,
						}),
					}))),
				)
				return balances
			},
			async (number) => (await this.#client.getBlock({ blockNumber: number })).hash,
			async (balances) => {
				await this.#assertLease()
				await this.#database.storeRichListBalances(this.#network.chainId, blockNumber, blockHash, balances, this.#requireLease())
			},
		)
	}

	async #readTokenMetadata(address: Address, blockNumber: bigint): Promise<TokenMetadata> {
		return await readTokenMetadata(address, blockNumber, {
			decimals: () => this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'decimals', blockNumber }),
			name: () => this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'name', blockNumber }),
			symbol: () => this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'symbol', blockNumber }),
		})
	}
}

export const startIndexers = (networks: readonly NetworkConfig[], database: ScannerDatabase, signal: AbortSignal): readonly Promise<void>[] =>
	networks.map((network) => runIndexerTask(network.id, () => new NetworkIndexer(network, database, signal).run()))

export const runIndexerTask = async (networkId: string, run: () => Promise<void>): Promise<void> => {
	try {
		await run()
		console.info(`[${networkId}] indexer state: stopped`)
	} catch (error) {
		const message = safeIndexerFailure(error)
		console.error(`[${networkId}] indexer state: stopped; ${message}`)
	}
}
