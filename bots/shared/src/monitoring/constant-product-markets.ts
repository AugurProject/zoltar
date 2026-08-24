import type { CentralizedMarketSettings } from './centralized-markets.ts'
import type { MarketConsensusObservation } from './market-consensus.ts'
import { settledQuorumValue } from './read-quorum.ts'
import { bigintToSafeNumber } from '../ethereum.ts'

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

export async function readConstantProductPairWithQuorum(
	pair: `0x${string}`,
	endpoints: readonly string[],
	requirement: 1 | 2,
	readPair: (endpoint: string, pair: `0x${string}`) => Promise<PairSnapshot>,
) {
	return await settledQuorumValue(
		`DEX pair ${pair}`,
		endpoints.map(async endpoint => ({ endpoint, value: await readPair(endpoint, pair) })),
		requirement,
	)
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

export async function observeConstantProductMarkets(settings: CentralizedMarketSettings, assetId: `0x${string}`, weth: `0x${string}`, readPair: ConstantProductPairReader) {
	const consensus = settings.venueConsensus
	if (consensus === undefined || consensus.dexSources.length === 0) return { observations: [] as MarketConsensusObservation[], reasons: [] as string[] }
	if (settings.assetAddress.toLowerCase() !== assetId.toLowerCase()) throw new Error('DEX market configuration does not match the exact REP asset')
	const settled = await Promise.allSettled(
		consensus.dexSources.map(async source => {
			const pair = await readPair(source.pair)
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
		}),
	)
	return {
		observations: settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : [])),
		reasons: settled.flatMap((result, index) => (result.status === 'rejected' ? [`${consensus.dexSources[index]?.sourceId ?? 'Unknown DEX'} observation unavailable`] : [])),
	}
}
