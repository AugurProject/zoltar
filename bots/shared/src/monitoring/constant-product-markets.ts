import type { CentralizedMarketSettings } from './centralized-markets.ts'
import type { MarketConsensusEstimate, MarketConsensusObservation } from './market-consensus.ts'
import { settledQuorumValue } from './read-quorum.ts'
import { operationalFailureDisposition } from './resilience.ts'
import { bigintToSafeNumber, getAddress, isHex, type Address, type Hash } from '../ethereum.ts'

const UNIT = 10n ** 18n
const BPS = 10_000n

export type PairSnapshot = {
	blockHash: `0x${string}`
	blockNumber: bigint
	blockTimestamp: bigint
	chainId: number
	reserve0: bigint
	reserve1: bigint
	token0: `0x${string}`
	token1: `0x${string}`
}

export type ConstantProductPairReader = (pair: `0x${string}`) => Promise<PairSnapshot>

export class DexPairSnapshotSafetyError extends Error {
	constructor(pair: Address, cause: unknown) {
		super(`DEX pair snapshot failed safety verification for ${pair}`, { cause })
		this.name = 'DexPairSnapshotSafetyError'
	}
}

type ConstantProductPairQuorumParameters = {
	block: Readonly<{ hash: Hash; number: bigint }>
	chainId: number
	endpoints: readonly string[]
	pair: Address
	readBlock: (endpoint: string, blockNumber: bigint) => Promise<Readonly<{ hash: unknown; number: unknown; timestamp: unknown }>>
	readPairAtBlock: (endpoint: string, pair: Address, blockHash: Hash) => Promise<Readonly<{ reserve0: unknown; reserve1: unknown; token0: unknown; token1: unknown }>>
	requirement: 1 | 2
}

function canonicalEndpointBlock(value: Readonly<{ hash: unknown; number: unknown; timestamp: unknown }>, expected: Readonly<{ hash: Hash; number: bigint }>, pair: Address) {
	const { hash, number, timestamp } = value
	if (typeof hash !== 'string' || !isHex(hash) || hash.length !== 66 || typeof number !== 'bigint' || typeof timestamp !== 'bigint') throw new Error(`DEX pair ${pair} endpoint returned malformed canonical block identity`)
	if (number !== expected.number || hash.toLowerCase() !== expected.hash.toLowerCase()) throw new Error(`DEX pair ${pair} endpoint canonical block does not match the scan anchor`)
	return { hash: hash as Hash, number, timestamp }
}

function canonicalPairState(value: Readonly<{ reserve0: unknown; reserve1: unknown; token0: unknown; token1: unknown }>, pair: Address) {
	const { reserve0, reserve1, token0, token1 } = value
	if (typeof reserve0 !== 'bigint' || typeof reserve1 !== 'bigint' || typeof token0 !== 'string' || typeof token1 !== 'string') throw new Error(`DEX pair ${pair} endpoint returned malformed pair state`)
	return { reserve0, reserve1, token0: getAddress(token0), token1: getAddress(token1) }
}

async function readEndpointPairSnapshot(parameters: ConstantProductPairQuorumParameters, endpoint: string) {
	const block = canonicalEndpointBlock(await parameters.readBlock(endpoint, parameters.block.number), parameters.block, parameters.pair)
	const pair = canonicalPairState(await parameters.readPairAtBlock(endpoint, parameters.pair, block.hash), parameters.pair)
	canonicalEndpointBlock(await parameters.readBlock(endpoint, parameters.block.number), parameters.block, parameters.pair)
	return {
		blockHash: block.hash,
		blockNumber: block.number,
		blockTimestamp: block.timestamp,
		chainId: parameters.chainId,
		...pair,
	} satisfies PairSnapshot
}

export async function readConstantProductPairWithQuorum(parameters: ConstantProductPairQuorumParameters) {
	try {
		return await settledQuorumValue(
			`DEX pair ${parameters.pair}`,
			parameters.endpoints.map(async endpoint => ({ endpoint, value: await readEndpointPairSnapshot(parameters, endpoint) })),
			parameters.requirement,
		)
	} catch (error) {
		if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
		throw new DexPairSnapshotSafetyError(parameters.pair, error)
	}
}

function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number) {
	const amountWithFee = amountIn * (BPS - BigInt(feeBps))
	return (amountWithFee * reserveOut) / (reserveIn * BPS + amountWithFee)
}

function deviationBps(left: bigint, right: bigint) {
	if (left <= 0n || right <= 0n) return BPS
	const distance = left > right ? left - right : right - left
	return (distance * BPS) / right
}

type ConstantProductDexSource = NonNullable<CentralizedMarketSettings['venueConsensus']>['dexSources'][number]

function constantProductObservation(settings: CentralizedMarketSettings, assetId: `0x${string}`, weth: `0x${string}`, source: ConstantProductDexSource, pair: PairSnapshot) {
	if (pair.chainId !== settings.assetChainId) throw new Error('pair snapshot is from the wrong chain')
	if (pair.blockNumber < 0n || pair.blockTimestamp < 0n || pair.blockTimestamp > BigInt(Number.MAX_SAFE_INTEGER) || !/^0x[0-9a-fA-F]{64}$/.test(pair.blockHash)) throw new Error('pair snapshot has invalid canonical block provenance')
	const token0 = pair.token0.toLowerCase()
	const token1 = pair.token1.toLowerCase()
	const asset = assetId.toLowerCase()
	const wrapped = weth.toLowerCase()
	if (!((token0 === asset && token1 === wrapped) || (token0 === wrapped && token1 === asset))) throw new Error('pair does not contain the configured REP and WETH assets')
	const reserveAttoRep = token0 === asset ? pair.reserve0 : pair.reserve1
	const reserveAttoWeth = token0 === wrapped ? pair.reserve0 : pair.reserve1
	if (reserveAttoRep <= 0n || reserveAttoWeth <= 0n) throw new Error('pair has empty reserves')
	const consensus = settings.venueConsensus
	if (consensus === undefined) throw new Error('DEX market consensus is not configured')
	const probeAttoEth = consensus.dexProbeDepthAttoEth
	if (probeAttoEth <= 0n || probeAttoEth >= reserveAttoWeth) throw new Error('DEX probe depth is outside pair reserves')
	const repAtSpotAttoRep = (reserveAttoRep * probeAttoEth) / reserveAttoWeth
	const repBoughtAttoRep = amountOut(probeAttoEth, reserveAttoWeth, reserveAttoRep, source.feeBps)
	const ethReceivedAttoEth = amountOut(repAtSpotAttoRep, reserveAttoRep, reserveAttoWeth, source.feeBps)
	if (repAtSpotAttoRep <= 0n || repBoughtAttoRep <= 0n || ethReceivedAttoEth <= 0n) throw new Error('DEX probe produced an empty quote')
	const askPriceRepPerEth = (repBoughtAttoRep * UNIT) / probeAttoEth
	const bidPriceRepPerEth = (repAtSpotAttoRep * UNIT) / ethReceivedAttoEth
	if (deviationBps(askPriceRepPerEth, bidPriceRepPerEth) > consensus.maximumGroupDeviationBps) throw new Error('DEX executable spread exceeds the configured group deviation')
	return {
		assetId,
		askDepthAttoEth: probeAttoEth,
		bidDepthAttoEth: ethReceivedAttoEth,
		blockHash: pair.blockHash,
		blockNumber: pair.blockNumber,
		chainId: pair.chainId,
		kind: 'dex',
		marketId: source.pair,
		observationId: `${pair.chainId.toString()}:${pair.blockNumber.toString()}:${pair.blockHash.toLowerCase()}`,
		observedAt: bigintToSafeNumber(pair.blockTimestamp * 1_000n, 'Pair block timestamp'),
		priceRepPerEth: (askPriceRepPerEth + bidPriceRepPerEth) / 2n,
		sourceId: source.sourceId,
	} satisfies MarketConsensusObservation
}

export async function requireCurrentConstantProductMarketEvidence(settings: CentralizedMarketSettings, assetId: `0x${string}`, weth: `0x${string}`, estimate: MarketConsensusEstimate | undefined, readPair: (pair: Address, block: Readonly<{ hash: Hash; number: bigint }>) => Promise<PairSnapshot>) {
	if (estimate === undefined || !estimate.dex.reliable || settings.venueConsensus === undefined) return
	const configuredSources = new Map(settings.venueConsensus.dexSources.map(source => [source.sourceId.toLowerCase(), source]))
	for (const observation of estimate.dex.observations) {
		const source = configuredSources.get(observation.sourceId.toLowerCase())
		if (source === undefined) continue
		if (observation.marketId === undefined || observation.marketId.toLowerCase() !== source.pair.toLowerCase() || observation.blockHash === undefined || observation.blockNumber === undefined) {
			throw new DexPairSnapshotSafetyError(getAddress(source.pair), new Error('Configured DEX evidence has incomplete or mismatched provenance'))
		}
		let current: MarketConsensusObservation
		try {
			const pair = await readPair(getAddress(source.pair), { hash: observation.blockHash, number: observation.blockNumber })
			current = constantProductObservation(settings, assetId, weth, source, pair)
		} catch (error) {
			if (error instanceof DexPairSnapshotSafetyError || operationalFailureDisposition(error) === 'connectivity-degraded') throw error
			throw new DexPairSnapshotSafetyError(getAddress(source.pair), error)
		}
		if (current.observationId !== observation.observationId || current.observedAt !== observation.observedAt || current.priceRepPerEth !== observation.priceRepPerEth || current.askDepthAttoEth !== observation.askDepthAttoEth || current.bidDepthAttoEth !== observation.bidDepthAttoEth) {
			throw new DexPairSnapshotSafetyError(getAddress(source.pair), new Error('Configured DEX evidence changed during final revalidation'))
		}
	}
}

export async function observeConstantProductMarkets(settings: CentralizedMarketSettings, assetId: `0x${string}`, weth: `0x${string}`, readPair: ConstantProductPairReader) {
	const consensus = settings.venueConsensus
	if (consensus === undefined || consensus.dexSources.length === 0) return { observations: [] as MarketConsensusObservation[], reasons: [] as string[] }
	if (settings.assetAddress.toLowerCase() !== assetId.toLowerCase()) throw new Error('DEX market configuration does not match the exact REP asset')
	const settled = await Promise.allSettled(
		consensus.dexSources.map(async source => {
			const pair = await readPair(source.pair)
			return constantProductObservation(settings, assetId, weth, source, pair)
		}),
	)
	const safetyFailure = settled.find(result => result.status === 'rejected' && result.reason instanceof DexPairSnapshotSafetyError)
	if (safetyFailure?.status === 'rejected') throw safetyFailure.reason
	return {
		observations: settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : [])),
		reasons: settled.flatMap((result, index) => (result.status === 'rejected' ? [`${consensus.dexSources[index]?.sourceId ?? 'Unknown DEX'} observation unavailable`] : [])),
	}
}
