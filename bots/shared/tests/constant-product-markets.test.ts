import { describe, expect, test } from 'bun:test'
import { marketConsensusSettings, type CentralizedMarketSettings } from '../src/monitoring/centralized-markets.ts'
import { observeConstantProductMarkets, readConstantProductPairWithQuorum, requireCurrentConstantProductMarketEvidence } from '../src/monitoring/constant-product-markets.ts'
import { estimateMarketConsensus } from '../src/monitoring/market-consensus.ts'

const REP: `0x${string}` = '0x0000000000000000000000000000000000000001'
const WETH: `0x${string}` = '0x0000000000000000000000000000000000000002'
const PAIR: `0x${string}` = '0x0000000000000000000000000000000000000003'
const UNIT = 10n ** 18n
const BLOCK_HASH: `0x${string}` = `0x${'1'.repeat(64)}`

function snapshot(blockNumber = 100n, blockTimestamp = 10n, blockHash = BLOCK_HASH) {
	return { blockHash, blockNumber, blockTimestamp, chainId: 1, reserve0: 200_000n * UNIT, reserve1: 1_000n * UNIT, token0: REP, token1: WETH }
}

function pairState(reserve0 = 200_000n * UNIT) {
	return { reserve0, reserve1: 1_000n * UNIT, token0: REP, token1: WETH }
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
	test('rejects identical pair values read from different endpoint block identities', async () => {
		const replacementHash = `0x${'2'.repeat(64)}` as const
		const endpointBlocks = new Map([
			['primary', BLOCK_HASH],
			['quorum-a', replacementHash],
			['quorum-b', BLOCK_HASH],
		])
		await expect(
			readConstantProductPairWithQuorum({
				block: { hash: BLOCK_HASH, number: 100n },
				chainId: 1,
				endpoints: ['primary', 'quorum-a', 'quorum-b'],
				pair: PAIR,
				readBlock: async endpoint => {
					const hash = endpointBlocks.get(endpoint)
					if (hash === undefined) throw new Error('Missing endpoint block fixture')
					return { hash, number: 100n, timestamp: 10n }
				},
				readPairAtBlock: async () => pairState(),
				requirement: 2,
			}),
		).rejects.toThrow('DEX pair snapshot failed safety verification')
	})

	test('rejects a canonical block hash paired with forged reserve state from one RPC', async () => {
		const honest = snapshot()
		const forged = { ...honest, reserve0: honest.reserve0 * 10n }
		await expect(
			readConstantProductPairWithQuorum({
				block: { hash: BLOCK_HASH, number: 100n },
				chainId: 1,
				endpoints: ['primary', 'quorum-a', 'quorum-b'],
				pair: PAIR,
				readBlock: async () => ({ hash: BLOCK_HASH, number: 100n, timestamp: 10n }),
				readPairAtBlock: async (endpoint, pair) => {
					expect(pair).toBe(PAIR)
					return pairState(endpoint === 'primary' ? forged.reserve0 : honest.reserve0)
				},
				requirement: 2,
			}),
		).rejects.toThrow('DEX pair snapshot failed safety verification')
	})

	test('does not downgrade a cross-endpoint reserve disagreement to an unavailable observation', async () => {
		await expect(
			observeConstantProductMarkets(settings, REP, WETH, async pair =>
				readConstantProductPairWithQuorum({
					block: { hash: BLOCK_HASH, number: 100n },
					chainId: 1,
					endpoints: ['primary', 'quorum-a'],
					pair,
					readBlock: async () => ({ hash: BLOCK_HASH, number: 100n, timestamp: 10n }),
					readPairAtBlock: async endpoint => pairState(endpoint === 'primary' ? 200_000n * UNIT : 100_000n * UNIT),
					requirement: 1,
				}),
			),
		).rejects.toThrow('DEX pair snapshot failed safety verification')
	})

	test('revalidates retained DEX evidence against every available reader before execution', async () => {
		const observed = await observeConstantProductMarkets(settings, REP, WETH, async () => snapshot())
		const estimate = estimateMarketConsensus(observed.observations, { ...marketConsensusSettings(settings), allowSingleGroupFallback: true, minimumTotalSourceCount: 1 }, REP, 1, 10_000)
		await expect(
			requireCurrentConstantProductMarketEvidence(settings, REP, WETH, estimate, async (pair, block) =>
				readConstantProductPairWithQuorum({
					block,
					chainId: 1,
					endpoints: ['primary', 'quorum-a'],
					pair,
					readBlock: async () => ({ hash: BLOCK_HASH, number: 100n, timestamp: 10n }),
					readPairAtBlock: async endpoint => pairState(endpoint === 'primary' ? 200_000n * UNIT : 100_000n * UNIT),
					requirement: 1,
				}),
			),
		).rejects.toThrow('DEX pair snapshot failed safety verification')
	})

	test('rejects changed raw pair state even when token and reserve swaps preserve the derived quote', async () => {
		const observed = await observeConstantProductMarkets(settings, REP, WETH, async () => snapshot())
		const estimate = estimateMarketConsensus(observed.observations, { ...marketConsensusSettings(settings), allowSingleGroupFallback: true, minimumTotalSourceCount: 1 }, REP, 1, 10_000)
		const swapped = snapshot()

		await expect(
			requireCurrentConstantProductMarketEvidence(settings, REP, WETH, estimate, async () => ({
				...swapped,
				reserve0: swapped.reserve1,
				reserve1: swapped.reserve0,
				token0: swapped.token1,
				token1: swapped.token0,
			})),
		).rejects.toThrow('DEX pair snapshot failed safety verification')
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
		expect(result.observations[0]?.pairSnapshotId).toBe(`${PAIR}:${REP}:${WETH}:${(200_000n * UNIT).toString()}:${(1_000n * UNIT).toString()}:${BLOCK_HASH}:100`)
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
