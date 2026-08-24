import { describe, expect, test } from 'bun:test'
import { marketConsensusSettings, type CentralizedMarketSettings } from '../src/monitoring/centralized-markets.ts'
import { observeConstantProductMarkets, readConstantProductPairWithQuorum } from '../src/monitoring/constant-product-markets.ts'
import { estimateMarketConsensus } from '../src/monitoring/market-consensus.ts'

const REP: `0x${string}` = '0x0000000000000000000000000000000000000001'
const WETH: `0x${string}` = '0x0000000000000000000000000000000000000002'
const PAIR: `0x${string}` = '0x0000000000000000000000000000000000000003'
const UNIT = 10n ** 18n
const BLOCK_HASH: `0x${string}` = `0x${'1'.repeat(64)}`

function snapshot(blockNumber = 100n, blockTimestamp = 10n, blockHash = BLOCK_HASH) {
	return { blockHash, blockNumber, blockTimestamp, chainId: 1, reserve0: 200_000n * UNIT, reserve1: 1_000n * UNIT, token0: REP, token1: WETH }
}

const settings: CentralizedMarketSettings = {
	assetAddress: REP,
	assetChainId: 1,
	assetSymbol: 'REP',
	depthBps: 500n,
	maximumDexDeviationBps: 1_000n,
	maximumObservationAgeMilliseconds: 30_000,
	maximumVenueDispersionBps: 500n,
	minimumAskDepthAttoEth: 0n,
	minimumBidDepthAttoEth: 0n,
	minimumSourceCount: 2,
	orderBookLimit: 20,
	requestTimeoutMilliseconds: 5_000,
	requiredForExecution: false,
	sources: [],
	venueConsensus: {
		allowSingleGroupFallback: false,
		dexProbeDepthAttoEth: UNIT,
		dexSources: [{ feeBps: 30, pair: PAIR, sourceId: 'uniswap-v2' }],
		maximumGroupDeviationBps: 500n,
		minimumDexAskDepthAttoEth: UNIT / 2n,
		minimumDexBidDepthAttoEth: UNIT / 2n,
		minimumDexSourceCount: 1,
		minimumSourceObservationCount: 1,
		minimumSourceObservationSpanMilliseconds: 0,
		minimumTotalSourceCount: 2,
	},
}

describe('constant-product DEX observations', () => {
	test('rejects a canonical block hash paired with forged reserve state from one RPC', async () => {
		const honest = snapshot()
		const forged = { ...honest, reserve0: honest.reserve0 * 10n }
		await expect(
			readConstantProductPairWithQuorum(PAIR, ['primary', 'quorum-a', 'quorum-b'], 2, async (endpoint, pair) => {
				expect(pair).toBe(PAIR)
				return endpoint === 'primary' ? forged : honest
			}),
		).rejects.toThrow('RPC disagreement for DEX pair')
	})

	test('derives a two-sided executable REP/ETH price and depth', async () => {
		const result = await observeConstantProductMarkets(settings, REP, WETH, async pair => {
			expect(pair).toBe(PAIR)
			return snapshot()
		})
		expect(result.reasons).toEqual([])
		expect(result.observations).toHaveLength(1)
		expect(result.observations[0]?.sourceId).toBe('uniswap-v2')
		expect(result.observations[0]?.askDepthAttoEth).toBe(UNIT)
		expect(result.observations[0]?.observedAt).toBe(10_000)
		expect(result.observations[0]?.observationId).toBe(`1:100:${BLOCK_HASH}`)
	})

	test('cannot build persistence by polling one cached canonical block at different local times', async () => {
		const first = await observeConstantProductMarkets(settings, REP, WETH, async () => snapshot())
		const second = await observeConstantProductMarkets(settings, REP, WETH, async () => snapshot())
		const persistence = {
			...marketConsensusSettings(settings),
			allowSingleGroupFallback: true,
			minimumDexSourceCount: 1,
			minimumSourceObservationCount: 2,
			minimumSourceObservationSpanMilliseconds: 5_000,
			minimumTotalSourceCount: 1,
		}
		const estimate = estimateMarketConsensus([...first.observations, ...second.observations], persistence, REP, 1, 20_000)
		expect(first.observations[0]?.observationId).toBe(second.observations[0]?.observationId)
		expect(estimate.reliable).toBe(false)
	})

	test('does not expose adapter errors', async () => {
		const result = await observeConstantProductMarkets(settings, REP, WETH, async () => {
			throw new Error('RPC secret detail')
		})
		expect(result.observations).toEqual([])
		expect(result.reasons).toEqual(['uniswap-v2 observation unavailable'])
	})
})
