import { requireDeployedContractsOnce } from '@zoltar/bot-shared/monitoring/deployed-contracts'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { bigintToSafeNumber, formatUnits, getAddress, isAddress, type Address, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { augurMarketAbi, augurUniverseAbi, constantProductFactoryAbi, constantProductPairAbi, erc20Abi, factoryAbi, poolAbi } from '#contracts/abi'
import { batchRead, batchValue, type BatchCall, type BatchReader, type BatchResult } from '#core/batch-read'
import { requiredBigint, requiredRpcAddress, requiredTuple } from '#core/rpc-validation'
import { childPayouts, payoutDistributionHash } from '#monitoring/augur-payouts'
import { constantProductSpotPriceWeth, poolSpotPriceWeth } from '#monitoring/spot-prices'

const MAINNET_AUGUR_GENESIS_UNIVERSE = getAddress('0x49244BD018Ca9fd1f06ecC07B9E9De773246e5AA')
const UNISWAP_V3_FEES = [100, 500, 3000, 10000] as const

type DeploymentReader = Parameters<typeof requireDeployedContractsOnce>[0]

const MAX_OBSERVED_MONITORING_TOKENS = 64

type MarketPoolSnapshot = {
	address: Address
	fee: number
	liquidity: string
	priceWeth: string | undefined
	url: string
	venue: string
}

type ConstantProductVenueKind = 'sushiswap-v2' | 'uniswap-v2'

const MAINNET_CONSTANT_PRODUCT_VENUES: readonly { factory: Address; fee: number; kind: ConstantProductVenueKind; name: string }[] = [
	{ factory: getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'), fee: 3_000, kind: 'uniswap-v2', name: 'Uniswap V2' },
	{ factory: getAddress('0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'), fee: 3_000, kind: 'sushiswap-v2', name: 'SushiSwap V2' },
]

export type TokenMarketSnapshot = {
	address: Address
	balance: string | undefined
	decimals: number
	name: string
	pools: readonly MarketPoolSnapshot[]
	symbol: string
}

export type MarketPricePoint = {
	blockNumber: string
	pool: Address
	priceWeth: string
	sampledAt: string
	symbol: string
	token: Address
	venue: string
}

type PriceHistoryLimits = {
	maximumBytes?: number | undefined
	maximumRecords?: number | undefined
}

const DEFAULT_PRICE_HISTORY_MAXIMUM_BYTES = 8 * 1024 * 1024
const DEFAULT_PRICE_HISTORY_MAXIMUM_RECORDS = 2_000

function completeLines(bytes: Buffer, fromStart: boolean) {
	if (fromStart) return bytes
	const firstNewline = bytes.indexOf(0x0a)
	return firstNewline === -1 ? Buffer.alloc(0) : bytes.subarray(firstNewline + 1)
}

function uniqueAddresses(addresses: readonly Address[]) {
	const unique = new Map<string, Address>()
	for (const address of addresses) unique.set(address.toLowerCase(), getAddress(address))
	return [...unique.values()]
}

function tokenCatalogForScan(discoveredAugurTokens: readonly Address[], configuredTokens: readonly Address[], observedTokens: readonly Address[], approvedTokens: readonly Address[] = []) {
	const executionTokens = uniqueAddresses(approvedTokens)
	const monitoringTokens = uniqueAddresses([...executionTokens, ...discoveredAugurTokens, ...configuredTokens])
	const monitoringKeys = new Set(monitoringTokens.map(address => address.toLowerCase()))
	const boundedObservedTokens = uniqueAddresses(observedTokens)
		.filter(address => !monitoringKeys.has(address.toLowerCase()))
		.slice(0, MAX_OBSERVED_MONITORING_TOKENS)
	return {
		executionTokens,
		monitoringTokens: [...monitoringTokens, ...boundedObservedTokens],
	}
}

const DEFAULT_AUGUR_DISCOVERY_REFRESH_MILLISECONDS = 60_000

/**
 * Augur REP discovery only changes when the genesis universe forks, so the discovered set is reused
 * across scans and refreshed on a short timer instead of being re-read from the chain every block.
 */
export function createTokenCatalogTracker(discoverAugurTokens: (configured: readonly Address[], observed: readonly Address[]) => Promise<readonly Address[]>, options: { now?: (() => number) | undefined; refreshMilliseconds?: number | undefined } = {}) {
	const now = options.now ?? Date.now
	const refreshMilliseconds = options.refreshMilliseconds ?? DEFAULT_AUGUR_DISCOVERY_REFRESH_MILLISECONDS
	if (!Number.isSafeInteger(refreshMilliseconds) || refreshMilliseconds < 0) throw new Error('Augur discovery refresh must be a non-negative integer')
	let discovered: { at: number; tokens: readonly Address[] } | undefined
	return async (configuredTokens: readonly Address[], observedTokens: readonly Address[], approvedTokens: readonly Address[] = []) => {
		const current = now()
		if (discovered === undefined || current - discovered.at >= refreshMilliseconds) discovered = { at: current, tokens: await discoverAugurTokens([], []) }
		return tokenCatalogForScan(discovered.tokens, configuredTokens, observedTokens, approvedTokens)
	}
}

export async function discoverAugurRepTokens(client: BatchReader, multicall3: Address, chainId: number, configured: readonly Address[], observed: readonly Address[]) {
	const addresses = [...configured, ...observed]
	if (chainId !== 1) return uniqueAddresses(addresses)
	const [genesisRep, forkingMarket] = await batchRead(client, multicall3, [
		{ address: MAINNET_AUGUR_GENESIS_UNIVERSE, abi: augurUniverseAbi, functionName: 'getReputationToken' },
		{ address: MAINNET_AUGUR_GENESIS_UNIVERSE, abi: augurUniverseAbi, functionName: 'getForkingMarket' },
	])
	addresses.push(requiredRpcAddress(batchValue(genesisRep, 'Augur genesis REP token'), 'Augur genesis REP token'))
	const market = requiredRpcAddress(batchValue(forkingMarket, 'Augur forking market'), 'Augur forking market')
	if (market === zeroAddress) return uniqueAddresses(addresses)
	const [rawNumTicks, rawNumberOfOutcomes] = await batchRead(client, multicall3, [
		{ address: market, abi: augurMarketAbi, functionName: 'getNumTicks' },
		{ address: market, abi: augurMarketAbi, functionName: 'getNumberOfOutcomes' },
	])
	const payouts = childPayouts(requiredBigint(batchValue(rawNumTicks, 'Augur forking market numTicks'), 'Augur forking market numTicks'), requiredBigint(batchValue(rawNumberOfOutcomes, 'Augur forking market outcomes'), 'Augur forking market outcomes'))
	const childUniverses = await batchRead(
		client,
		multicall3,
		payouts.map(payout => ({ address: MAINNET_AUGUR_GENESIS_UNIVERSE, abi: augurUniverseAbi, functionName: 'getChildUniverse', args: [payoutDistributionHash(payout)] })),
	)
	const universes = childUniverses.map((result, index) => requiredRpcAddress(batchValue(result, `Augur child universe ${index.toString()}`), `Augur child universe ${index.toString()}`)).filter(universe => universe !== zeroAddress)
	const childTokens = await batchRead(
		client,
		multicall3,
		universes.map(universe => ({ address: universe, abi: augurUniverseAbi, functionName: 'getReputationToken' })),
	)
	for (const [index, result] of childTokens.entries()) addresses.push(requiredRpcAddress(batchValue(result, `Augur child universe ${universes[index] ?? index.toString()} REP token`), 'Augur child REP token'))
	return uniqueAddresses(addresses)
}

export type TokenMetadata = { decimals: number; name: string; symbol: string }

/** ERC-20 name, symbol, and decimals are immutable, so one read per token serves every later scan. */
export function createTokenMetadataCache() {
	return new Map<string, TokenMetadata>()
}

function metadataCalls(address: Address) {
	return [
		{ address, abi: erc20Abi, functionName: 'name' },
		{ address, abi: erc20Abi, functionName: 'symbol' },
		{ address, abi: erc20Abi, functionName: 'decimals' },
	] satisfies BatchCall[]
}

function decodeMetadata(results: readonly BatchResult[], token: Address): TokenMetadata {
	const name = batchValue(results[0], `Token ${token} name`)
	const symbol = batchValue(results[1], `Token ${token} symbol`)
	const decimals = batchValue(results[2], `Token ${token} decimals`)
	if (typeof name !== 'string' || typeof symbol !== 'string') throw new Error(`Token ${token} metadata is not valid`)
	return { decimals: bigintToSafeNumber(requiredBigint(decimals, `Token ${token} decimals`), 'Token decimals'), name, symbol }
}

export function formatTokenAmount(value: bigint, decimals: number) {
	return formatUnits(value, decimals)
}

export type DiscoveredTokenPools = {
	constantProduct: readonly { address: Address; fee: number; kind: ConstantProductVenueKind; venue: string }[]
	token: Address
	v3: readonly { address: Address; fee: (typeof UNISWAP_V3_FEES)[number] }[]
}

/**
 * Resolves every candidate Uniswap V3 pool and mainnet constant-product pair for the monitored tokens
 * in one batched read so the market overview and the execution pool set share a single discovery.
 */
export async function discoverTokenPools(
	client: DeploymentReader & BatchReader,
	parameters: {
		blockNumber?: bigint | undefined
		chainId: number
		factory: Address
		multicall3: Address
		tokens: readonly Address[]
		weth: Address
	},
): Promise<readonly DiscoveredTokenPools[]> {
	await requireDeployedContractsOnce(client, [{ name: 'Uniswap V3 factory', address: parameters.factory }], parameters.blockNumber)
	const venues = parameters.chainId === 1 ? MAINNET_CONSTANT_PRODUCT_VENUES : []
	const calls = parameters.tokens.flatMap(token => [
		...UNISWAP_V3_FEES.map(fee => ({ address: parameters.factory, abi: factoryAbi, functionName: 'getPool', args: [parameters.weth, token, fee] }) satisfies BatchCall),
		...venues.map(venue => ({ address: venue.factory, abi: constantProductFactoryAbi, functionName: 'getPair', args: [token, parameters.weth] }) satisfies BatchCall),
	])
	const results = await batchRead(client, parameters.multicall3, calls, parameters.blockNumber)
	const stride = UNISWAP_V3_FEES.length + venues.length
	return parameters.tokens.map((token, tokenIndex) => {
		const base = tokenIndex * stride
		const v3 = UNISWAP_V3_FEES.flatMap((fee, feeIndex) => {
			const address = requiredRpcAddress(batchValue(results[base + feeIndex], 'Uniswap V3 factory getPool'), 'Uniswap V3 factory getPool')
			return address === zeroAddress ? [] : [{ address, fee }]
		})
		const constantProduct = venues.flatMap((venue, venueIndex) => {
			const result = results[base + UNISWAP_V3_FEES.length + venueIndex]
			if (result === undefined || result.status === 'failure') {
				console.error(`venue=${venue.name} token=${token} skipped=${result === undefined ? 'missing pair read' : result.error.message}`)
				return []
			}
			const address = requiredRpcAddress(result.result, `${venue.name} pair`)
			return address === zeroAddress ? [] : [{ address, fee: venue.fee, kind: venue.kind, venue: venue.name }]
		})
		return { constantProduct, token, v3 }
	})
}

export async function loadTokenMarkets(
	client: BatchReader,
	parameters: {
		blockNumber?: bigint | undefined
		explorerUrl: string
		metadataCache: Map<string, TokenMetadata>
		multicall3: Address
		pools: readonly DiscoveredTokenPools[]
		wallet: Address | undefined
		weth: Address
	},
) {
	const calls: BatchCall[] = []
	const enqueue = (...batch: BatchCall[]) => {
		const index = calls.length
		calls.push(...batch)
		return index
	}
	const layout = parameters.pools.map(discovered => {
		const token = discovered.token
		const metadataIndex = parameters.metadataCache.has(token.toLowerCase()) ? undefined : enqueue(...metadataCalls(token))
		const v3Indexes = discovered.v3.map(pool => enqueue({ address: pool.address, abi: poolAbi, functionName: 'liquidity' }, { address: pool.address, abi: poolAbi, functionName: 'slot0' }))
		const constantProductIndexes = discovered.constantProduct.map(pool => enqueue({ address: pool.address, abi: constantProductPairAbi, functionName: 'token0' }, { address: pool.address, abi: constantProductPairAbi, functionName: 'getReserves' }))
		const balanceIndex = parameters.wallet === undefined ? undefined : enqueue({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [parameters.wallet] })
		return { balanceIndex, constantProductIndexes, metadataIndex, v3Indexes }
	})
	const results = await batchRead(client, parameters.multicall3, calls, parameters.blockNumber)
	const snapshots: TokenMarketSnapshot[] = []
	for (const [index, discovered] of parameters.pools.entries()) {
		const token = discovered.token
		const entry = layout[index]
		if (entry === undefined) throw new Error('Token market layout lost an entry')
		try {
			let metadata = parameters.metadataCache.get(token.toLowerCase())
			if (metadata === undefined) {
				if (entry.metadataIndex === undefined) throw new Error('Token metadata read is missing')
				metadata = decodeMetadata(results.slice(entry.metadataIndex, entry.metadataIndex + 3), token)
				parameters.metadataCache.set(token.toLowerCase(), metadata)
			}
			const decimals = metadata.decimals
			const pools: MarketPoolSnapshot[] = []
			for (const [poolIndex, pool] of discovered.v3.entries()) {
				const resultIndex = entry.v3Indexes[poolIndex]
				if (resultIndex === undefined) throw new Error('Uniswap V3 pool read is missing')
				try {
					const liquidity = requiredBigint(batchValue(results[resultIndex], 'Uniswap liquidity'), 'Uniswap liquidity')
					const slot0 = requiredTuple(batchValue(results[resultIndex + 1], 'Uniswap slot0'), 1, 'Uniswap slot0')
					pools.push({
						address: pool.address,
						fee: pool.fee,
						liquidity: liquidity.toString(),
						priceWeth: poolSpotPriceWeth(requiredBigint(slot0[0], 'Uniswap sqrtPriceX96'), token, parameters.weth, decimals),
						url: `${parameters.explorerUrl}/address/${pool.address}`,
						venue: 'Uniswap V3',
					})
				} catch (error) {
					console.error(`pool=${pool.address} marketSnapshotSkipped=${error instanceof Error ? error.message : String(error)}`)
				}
			}
			for (const [poolIndex, pool] of discovered.constantProduct.entries()) {
				const resultIndex = entry.constantProductIndexes[poolIndex]
				if (resultIndex === undefined) throw new Error('Constant-product pair read is missing')
				try {
					const token0 = requiredRpcAddress(batchValue(results[resultIndex], `${pool.venue} token0`), `${pool.venue} token0`)
					const reserves = requiredTuple(batchValue(results[resultIndex + 1], `${pool.venue} reserves`), 2, `${pool.venue} reserves`)
					const tokenIsZero = token0.toLowerCase() === token.toLowerCase()
					const reserveToken = requiredBigint(tokenIsZero ? reserves[0] : reserves[1], `${pool.venue} token reserve`)
					const reserveAttoWeth = requiredBigint(tokenIsZero ? reserves[1] : reserves[0], `${pool.venue} WETH reserve`)
					pools.push({
						address: pool.address,
						fee: pool.fee,
						liquidity: `${formatUnits(reserveToken, decimals)} token / ${formatUnits(reserveAttoWeth, 18)} WETH`,
						priceWeth: constantProductSpotPriceWeth(reserveToken, reserveAttoWeth, decimals),
						url: `${parameters.explorerUrl}/address/${pool.address}`,
						venue: pool.venue,
					})
				} catch (error) {
					console.error(`pool=${pool.address} marketSnapshotSkipped=${error instanceof Error ? error.message : String(error)}`)
				}
			}
			let balance: string | undefined
			if (entry.balanceIndex !== undefined) {
				const rawBalance = results[entry.balanceIndex]
				if (rawBalance === undefined || rawBalance.status === 'failure') console.error(`token=${token} balanceUnavailable=${rawBalance === undefined ? 'missing balance read' : rawBalance.error.message}`)
				else balance = formatUnits(requiredBigint(rawBalance.result, `Token ${token} balance`), decimals)
			}
			snapshots.push({ address: token, balance, ...metadata, pools })
		} catch (error) {
			console.error(`token=${token} marketDiscoverySkipped=${error instanceof Error ? error.message : String(error)}`)
		}
	}
	return snapshots
}

export function pricePoints(markets: readonly TokenMarketSnapshot[], blockNumber: bigint, sampledAt: string): MarketPricePoint[] {
	return markets.flatMap(token =>
		token.pools.flatMap(pool =>
			pool.priceWeth === undefined
				? []
				: [
						{
							blockNumber: blockNumber.toString(),
							pool: pool.address,
							priceWeth: pool.priceWeth,
							sampledAt,
							symbol: token.symbol,
							token: token.address,
							venue: `${pool.venue} ${(pool.fee / 10_000).toString()}%`,
						},
					],
		),
	)
}

export function missingPricePoints(existing: readonly MarketPricePoint[], candidates: readonly MarketPricePoint[]) {
	const recorded = new Set(existing.map(point => `${point.blockNumber}:${point.pool.toLowerCase()}`))
	return candidates.filter(point => !recorded.has(`${point.blockNumber}:${point.pool.toLowerCase()}`))
}

function priceHistoryLimits(options: PriceHistoryLimits | undefined) {
	const maximumBytes = options?.maximumBytes ?? DEFAULT_PRICE_HISTORY_MAXIMUM_BYTES
	const maximumRecords = options?.maximumRecords ?? DEFAULT_PRICE_HISTORY_MAXIMUM_RECORDS
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('Price history maximumBytes must be a positive integer')
	if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1) throw new Error('Price history maximumRecords must be a positive integer')
	return { maximumBytes, maximumRecords }
}

async function readPriceHistoryTail(path: string, maximumBytes: number) {
	const handle = await open(path, 'r')
	try {
		const file = await handle.stat()
		const start = Math.max(0, file.size - maximumBytes)
		const buffer = Buffer.alloc(file.size - start)
		let offset = 0
		while (offset < buffer.length) {
			const read = await handle.read(buffer, offset, buffer.length - offset, start + offset)
			if (read.bytesRead === 0) break
			offset += read.bytesRead
		}
		const bytes = buffer.subarray(0, offset)
		const complete = completeLines(bytes, start === 0)
		return complete.toString('utf8')
	} finally {
		await handle.close()
	}
}

async function replacePriceHistory(path: string, points: readonly MarketPricePoint[], chainId: number) {
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const handle = await open(temporaryPath, 'wx', 0o600)
		try {
			await handle.writeFile(`${points.map(point => JSON.stringify({ chainId, point })).join('\n')}\n`, { encoding: 'utf8' })
			await handle.sync()
		} finally {
			await handle.close()
		}
		await rename(temporaryPath, path)
		const directoryHandle = await open(dirname(path), 'r')
		try {
			await directoryHandle.sync()
		} finally {
			await directoryHandle.close()
		}
	} catch (error) {
		await rm(temporaryPath, { force: true })
		throw error
	}
}

export async function appendPriceHistory(path: string, points: readonly MarketPricePoint[], chainId: number, options?: PriceHistoryLimits) {
	if (points.length === 0) return
	if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('Price history chain ID must be a positive integer')
	const limits = priceHistoryLimits(options)
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	await appendFile(path, `${points.map(point => JSON.stringify({ chainId, point })).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
	const handle = await open(path, 'r')
	let size: number
	try {
		size = (await handle.stat()).size
	} finally {
		await handle.close()
	}
	if (size > limits.maximumBytes) await replacePriceHistory(path, await loadPriceHistory(path, chainId, limits.maximumRecords, limits), chainId)
}

function parsePriceHistoryPoint(value: unknown): MarketPricePoint | undefined {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		!('blockNumber' in value) ||
		typeof value.blockNumber !== 'string' ||
		!/^(0|[1-9]\d*)$/.test(value.blockNumber) ||
		!('pool' in value) ||
		typeof value.pool !== 'string' ||
		!isAddress(value.pool) ||
		!('priceWeth' in value) ||
		typeof value.priceWeth !== 'string' ||
		!/^(0|[1-9]\d*)(\.\d+)?$/.test(value.priceWeth) ||
		!('sampledAt' in value) ||
		typeof value.sampledAt !== 'string' ||
		Number.isNaN(Date.parse(value.sampledAt)) ||
		!('symbol' in value) ||
		typeof value.symbol !== 'string' ||
		value.symbol.length === 0 ||
		!('token' in value) ||
		typeof value.token !== 'string' ||
		!isAddress(value.token) ||
		!('venue' in value) ||
		typeof value.venue !== 'string' ||
		value.venue.length === 0
	) {
		return undefined
	}
	return {
		blockNumber: value.blockNumber,
		pool: getAddress(value.pool),
		priceWeth: value.priceWeth,
		sampledAt: value.sampledAt,
		symbol: value.symbol,
		token: getAddress(value.token),
		venue: value.venue,
	}
}

export async function loadPriceHistory(path: string, expectedChainId: number, maximum = DEFAULT_PRICE_HISTORY_MAXIMUM_RECORDS, options?: PriceHistoryLimits) {
	if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) throw new Error('Expected price history chain ID must be a positive integer')
	if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Price history maximum must be a positive integer')
	try {
		const contents = await readPriceHistoryTail(path, priceHistoryLimits(options).maximumBytes)
		const points: MarketPricePoint[] = []
		for (const [index, line] of contents.split('\n').entries()) {
			if (line.trim().length === 0) continue
			let parsed: unknown
			try {
				parsed = JSON.parse(line)
			} catch (error) {
				const reason = error instanceof Error ? error.message : 'unknown parse error'
				console.warn(`Skipping malformed price history record at line ${(index + 1).toString()} in ${path}: ${reason}`)
				continue
			}
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Reflect.get(parsed, 'chainId') !== expectedChainId) throw new Error(`Price history record at line ${(index + 1).toString()} belongs to another chain`)
			const point = parsePriceHistoryPoint(Reflect.get(parsed, 'point'))
			if (point !== undefined) points.push(point)
			else console.warn(`Skipping invalid price history record at line ${(index + 1).toString()} in ${path}`)
		}
		return points.slice(-maximum)
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
		throw error
	}
}
