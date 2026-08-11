import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { bigintToSafeNumber, formatUnits, getAddress, isAddress, keccak256, type Address, type Chain, type Hex, type PublicClient, type Transport, zeroAddress } from '#ethereum'
import { augurMarketAbi, augurUniverseAbi, constantProductFactoryAbi, constantProductPairAbi, erc20Abi, factoryAbi, poolAbi } from '#contracts/abi'

const MAINNET_AUGUR_GENESIS_UNIVERSE = getAddress('0x49244BD018Ca9fd1f06ecC07B9E9De773246e5AA')
export const UNISWAP_V3_FEES = [100, 500, 3000, 10000] as const

type ReadClient = PublicClient<Transport, Chain>

export type TokenConfiguration = {
	addresses: readonly Address[]
}

export const MAX_OBSERVED_MONITORING_TOKENS = 64

export type MarketPoolSnapshot = {
	address: Address
	fee: number
	liquidity: string
	priceWeth: string | undefined
	url: string
	venue: string
}

const MAINNET_CONSTANT_PRODUCT_VENUES = [
	{ factory: getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'), fee: 3_000, name: 'Uniswap V2' },
	{ factory: getAddress('0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'), fee: 3_000, name: 'SushiSwap V2' },
] as const

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

export async function availableTokenBalances(tokens: readonly Address[], readBalance: (token: Address) => Promise<bigint>) {
	const entries = await Promise.all(
		tokens.map(async token => {
			try {
				return [[token.toLowerCase(), await readBalance(token)] as const]
			} catch (error) {
				console.error(`token=${token} balanceUnavailable=${error instanceof Error ? error.message : String(error)}`)
				return []
			}
		}),
	)
	return new Map(entries.flat())
}

function uniqueAddresses(addresses: readonly Address[]) {
	const unique = new Map<string, Address>()
	for (const address of addresses) unique.set(address.toLowerCase(), getAddress(address))
	return [...unique.values()]
}

export function tokenCatalogForScan(discoveredAugurTokens: readonly Address[], configuredTokens: readonly Address[], observedTokens: readonly Address[]) {
	const executionTokens = uniqueAddresses([...discoveredAugurTokens, ...configuredTokens])
	const executionKeys = new Set(executionTokens.map(address => address.toLowerCase()))
	const boundedObservedTokens = uniqueAddresses(observedTokens)
		.filter(address => !executionKeys.has(address.toLowerCase()))
		.slice(0, MAX_OBSERVED_MONITORING_TOKENS)
	return {
		executionTokens,
		monitoringTokens: [...executionTokens, ...boundedObservedTokens],
	}
}

export function createTokenCatalogTracker(discoverAugurTokens: (configured: readonly Address[], observed: readonly Address[]) => Promise<readonly Address[]>) {
	return async (configuredTokens: readonly Address[], observedTokens: readonly Address[]) => {
		const discoveredAugurTokens = await discoverAugurTokens([], [])
		return tokenCatalogForScan(discoveredAugurTokens, configuredTokens, observedTokens)
	}
}

export function childPayouts(numTicks: bigint, numberOfOutcomes: bigint) {
	if (numberOfOutcomes < 2n || numberOfOutcomes > 32n) throw new Error(`Unsupported Augur outcome count: ${numberOfOutcomes.toString()}`)
	const count = bigintToSafeNumber(numberOfOutcomes, 'Augur outcome count')
	return Array.from({ length: count }, (_, winner) => Array.from({ length: count }, (_, index) => (index === winner ? numTicks : 0n)))
}

export function payoutDistributionHash(payout: readonly bigint[]) {
	const packed = payout.map(value => value.toString(16).padStart(64, '0')).join('')
	return keccak256(`0x${packed}` as Hex)
}

export async function discoverAugurRepTokens(client: ReadClient, chainId: number, configured: readonly Address[], observed: readonly Address[]) {
	const addresses = [...configured, ...observed]
	if (chainId !== 1) return uniqueAddresses(addresses)
	const genesisRep = await client.readContract({
		address: MAINNET_AUGUR_GENESIS_UNIVERSE,
		abi: augurUniverseAbi,
		functionName: 'getReputationToken',
	})
	addresses.push(genesisRep)
	const market = await client.readContract({
		address: MAINNET_AUGUR_GENESIS_UNIVERSE,
		abi: augurUniverseAbi,
		functionName: 'getForkingMarket',
	})
	if (market !== zeroAddress) {
		const [numTicks, numberOfOutcomes] = await Promise.all([client.readContract({ address: market, abi: augurMarketAbi, functionName: 'getNumTicks' }), client.readContract({ address: market, abi: augurMarketAbi, functionName: 'getNumberOfOutcomes' })])
		for (const payout of childPayouts(numTicks, numberOfOutcomes)) {
			const payoutHash = payoutDistributionHash(payout)
			const universe = await client.readContract({
				address: MAINNET_AUGUR_GENESIS_UNIVERSE,
				abi: augurUniverseAbi,
				functionName: 'getChildUniverse',
				args: [payoutHash],
			})
			if (universe === zeroAddress) continue
			addresses.push(
				await client.readContract({
					address: universe,
					abi: augurUniverseAbi,
					functionName: 'getReputationToken',
				}),
			)
		}
	}
	return uniqueAddresses(addresses)
}

async function tokenMetadata(client: ReadClient, address: Address) {
	const [name, symbol, decimals] = await Promise.all([client.readContract({ address, abi: erc20Abi, functionName: 'name' }), client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }), client.readContract({ address, abi: erc20Abi, functionName: 'decimals' })])
	return { decimals: bigintToSafeNumber(decimals, 'Token decimals'), name, symbol }
}

export function poolSpotPriceWeth(sqrtPriceX96: bigint, token: Address, weth: Address, decimals: number) {
	if (sqrtPriceX96 === 0n) return undefined
	const squared = sqrtPriceX96 * sqrtPriceX96
	const q192 = 2n ** 192n
	const oneToken = 10n ** BigInt(decimals)
	const attoWeth = BigInt(token.toLowerCase()) < BigInt(weth.toLowerCase()) ? (oneToken * squared) / q192 : (oneToken * q192) / squared
	return formatUnits(attoWeth, 18)
}

export function constantProductSpotPriceWeth(reserveToken: bigint, reserveAttoWeth: bigint, tokenDecimals: number) {
	if (reserveToken === 0n || reserveAttoWeth === 0n) return undefined
	return formatUnits((reserveAttoWeth * 10n ** BigInt(tokenDecimals)) / reserveToken, 18)
}

export function formatTokenAmount(value: bigint, decimals: number) {
	return formatUnits(value, decimals)
}

async function loadConstantProductPools(client: ReadClient, chainId: number, token: Address, weth: Address, tokenDecimals: number, explorerUrl: string) {
	if (chainId !== 1) return []
	const pools: MarketPoolSnapshot[] = []
	for (const venue of MAINNET_CONSTANT_PRODUCT_VENUES) {
		const address = await client.readContract({
			address: venue.factory,
			abi: constantProductFactoryAbi,
			functionName: 'getPair',
			args: [token, weth],
		})
		if (address === zeroAddress) continue
		const [token0, reserves] = await Promise.all([client.readContract({ address, abi: constantProductPairAbi, functionName: 'token0' }), client.readContract({ address, abi: constantProductPairAbi, functionName: 'getReserves' })])
		const tokenIsZero = token0.toLowerCase() === token.toLowerCase()
		const reserveToken = tokenIsZero ? reserves[0] : reserves[1]
		const reserveAttoWeth = tokenIsZero ? reserves[1] : reserves[0]
		pools.push({
			address,
			fee: venue.fee,
			liquidity: `${formatUnits(reserveToken, tokenDecimals)} token / ${formatUnits(reserveAttoWeth, 18)} WETH`,
			priceWeth: constantProductSpotPriceWeth(reserveToken, reserveAttoWeth, tokenDecimals),
			url: `${explorerUrl}/address/${address}`,
			venue: venue.name,
		})
	}
	return pools
}

export async function loadTokenMarkets(
	client: ReadClient,
	parameters: {
		explorerUrl: string
		factory: Address
		chainId: number
		tokens: readonly Address[]
		weth: Address
		wallet: Address | undefined
	},
) {
	const snapshots: TokenMarketSnapshot[] = []
	for (const token of parameters.tokens) {
		try {
			const metadata = await tokenMetadata(client, token)
			const pools: MarketPoolSnapshot[] = []
			for (const fee of UNISWAP_V3_FEES) {
				const address = await client.readContract({
					address: parameters.factory,
					abi: factoryAbi,
					functionName: 'getPool',
					args: [parameters.weth, token, fee],
				})
				if (address === zeroAddress) continue
				const [liquidity, slot0] = await Promise.all([client.readContract({ address, abi: poolAbi, functionName: 'liquidity' }), client.readContract({ address, abi: poolAbi, functionName: 'slot0' })])
				pools.push({
					address,
					fee,
					liquidity: liquidity.toString(),
					priceWeth: poolSpotPriceWeth(slot0[0], token, parameters.weth, metadata.decimals),
					url: `${parameters.explorerUrl}/address/${address}`,
					venue: 'Uniswap V3',
				})
			}
			pools.push(...(await loadConstantProductPools(client, parameters.chainId, token, parameters.weth, metadata.decimals, parameters.explorerUrl)))
			const wallet = parameters.wallet
			const tokenBalances =
				wallet === undefined
					? undefined
					: await availableTokenBalances([token], address =>
							client.readContract({
								address,
								abi: erc20Abi,
								functionName: 'balanceOf',
								args: [wallet],
							}),
						)
			const rawBalance = tokenBalances?.get(token.toLowerCase())
			const balance = rawBalance === undefined ? undefined : formatUnits(rawBalance, metadata.decimals)
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
		const firstNewline = bytes.indexOf(0x0a)
		const complete = start === 0 ? bytes : firstNewline === -1 ? Buffer.alloc(0) : bytes.subarray(firstNewline + 1)
		return complete.toString('utf8')
	} finally {
		await handle.close()
	}
}

async function replacePriceHistory(path: string, points: readonly MarketPricePoint[]) {
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const handle = await open(temporaryPath, 'wx', 0o600)
		try {
			await handle.writeFile(`${points.map(point => JSON.stringify(point)).join('\n')}\n`, { encoding: 'utf8' })
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

export async function appendPriceHistory(path: string, points: readonly MarketPricePoint[], options?: PriceHistoryLimits) {
	if (points.length === 0) return
	const limits = priceHistoryLimits(options)
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	await appendFile(path, `${points.map(point => JSON.stringify(point)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
	const handle = await open(path, 'r')
	let size: number
	try {
		size = (await handle.stat()).size
	} finally {
		await handle.close()
	}
	if (size > limits.maximumBytes) await replacePriceHistory(path, await loadPriceHistory(path, limits.maximumRecords, limits))
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

export async function loadPriceHistory(path: string, maximum = DEFAULT_PRICE_HISTORY_MAXIMUM_RECORDS, options?: PriceHistoryLimits) {
	if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Price history maximum must be a positive integer')
	try {
		const contents = await readPriceHistoryTail(path, priceHistoryLimits(options).maximumBytes)
		const points: MarketPricePoint[] = []
		for (const [index, line] of contents.split('\n').entries()) {
			if (line.trim().length === 0) continue
			try {
				const point = parsePriceHistoryPoint(JSON.parse(line))
				if (point !== undefined) {
					points.push(point)
				} else {
					console.warn(`Skipping invalid price history record at line ${(index + 1).toString()} in ${path}`)
				}
			} catch (error) {
				const reason = error instanceof Error ? error.message : 'unknown parse error'
				console.warn(`Skipping malformed price history record at line ${(index + 1).toString()} in ${path}: ${reason}`)
			}
		}
		return points.slice(-maximum)
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
		throw error
	}
}
