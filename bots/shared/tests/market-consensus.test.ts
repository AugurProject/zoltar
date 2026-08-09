import { describe, expect, test } from 'bun:test'
import {
	clearOrphanedDexEvidenceForHeadReplacement,
	consensusAllowsCandidate,
	discardDexMarketObservations,
	estimateMarketConsensus,
	marketConsensusAllowsExecution,
	marketObservationsForAsset,
	requireCanonicalBlock,
	requireCanonicalDexEvidence,
	type MarketConsensusObservation,
	type MarketConsensusSettings,
} from '../src/monitoring/market-consensus.ts'

const UNIT = 10n ** 18n
const settings: MarketConsensusSettings = {
	allowSingleGroupFallback: false,
	maximumGroupDeviationBps: 500n,
	maximumObservationAgeMilliseconds: 30_000,
	maximumVenueDispersionBps: 500n,
	minimumAskDepthAttoEthPerSource: 1n * UNIT,
	minimumBidDepthAttoEthPerSource: 1n * UNIT,
	minimumCexAskDepthAttoEth: 2n * UNIT,
	minimumCexBidDepthAttoEth: 2n * UNIT,
	minimumCexSourceCount: 2,
	minimumDexSourceCount: 2,
	minimumSourceObservationCount: 1,
	minimumSourceObservationSpanMilliseconds: 0,
	minimumTotalSourceCount: 3,
}

function observation(kind: 'cex' | 'dex', sourceId: string, price: bigint, marketId?: string): MarketConsensusObservation {
	return { assetId: 'rep', askDepthAttoEth: 2n * UNIT, bidDepthAttoEth: 2n * UNIT, chainId: 1, kind, ...(marketId === undefined ? {} : { marketId }), observationId: `${kind}:${sourceId}:1`, observedAt: 10_000, priceRepPerEth: price * UNIT, sourceId }
}

describe('cross-venue market consensus', () => {
	test('rejects a same-number canonical block hash change', async () => {
		const expected: `0x${string}` = `0x${'1'.repeat(64)}`
		await expect(requireCanonicalBlock(100n, expected, async () => expected)).resolves.toBeUndefined()
		await expect(requireCanonicalBlock(100n, expected, async () => `0x${'2'.repeat(64)}`)).rejects.toThrow('Canonical block changed during market observation')
		expect(discardDexMarketObservations([observation('cex', 'alpha', 200n), observation('dex', 'one', 200n)])).toEqual([observation('cex', 'alpha', 200n)])
	})
	test('clears retained DEX evidence when a later poll reveals a replaced canonical block', async () => {
		const cex = observation('cex', 'alpha', 200n)
		const dex = observation('dex', 'one', 200n)
		const evidence: { marketConsensus: unknown; marketConsensusByAsset: Map<string, unknown>; marketObservations: MarketConsensusObservation[] } = { marketConsensus: { reliable: true }, marketConsensusByAsset: new Map([['rep', { reliable: true }]]), marketObservations: [cex, dex] }
		expect(await clearOrphanedDexEvidenceForHeadReplacement({ hash: `0x${'1'.repeat(64)}`, number: 100n }, { hash: `0x${'2'.repeat(64)}`, number: 100n }, evidence, async () => undefined)).toBe(true)
		expect(evidence.marketConsensus).toBeUndefined()
		expect(evidence.marketConsensusByAsset.size).toBe(0)
		expect(evidence.marketObservations).toEqual([cex])
		evidence.marketConsensus = { reliable: true }
		evidence.marketConsensusByAsset.set('rep', { reliable: true })
		evidence.marketObservations = [cex, dex]
		expect(await clearOrphanedDexEvidenceForHeadReplacement({ hash: `0x${'2'.repeat(64)}`, number: 100n }, { hash: `0x${'3'.repeat(64)}`, number: 101n }, evidence, async () => `0x${'4'.repeat(64)}`)).toBe(true)
		expect(evidence.marketConsensus).toBeUndefined()
		expect(evidence.marketConsensusByAsset.size).toBe(0)
		expect(evidence.marketObservations).toEqual([cex])
		expect(await clearOrphanedDexEvidenceForHeadReplacement({ hash: `0x${'2'.repeat(64)}`, number: 100n }, { hash: `0x${'3'.repeat(64)}`, number: 101n }, evidence, async () => `0x${'2'.repeat(64)}`)).toBe(false)
	})

	test('clears all DEX-derived evidence before handling a regressed or unreadable head', async () => {
		const cex = observation('cex', 'alpha', 200n)
		const dex = observation('dex', 'one', 200n)
		for (const readCanonicalHash of [async () => undefined, async () => Promise.reject(new Error('future block unavailable'))]) {
			const evidence: { marketConsensus: unknown; marketConsensusByAsset: Map<string, unknown>; marketObservations: MarketConsensusObservation[] } = {
				marketConsensus: { reliable: true },
				marketConsensusByAsset: new Map([['rep', { reliable: true }]]),
				marketObservations: [cex, dex],
			}
			expect(await clearOrphanedDexEvidenceForHeadReplacement({ hash: `0x${'1'.repeat(64)}`, number: 101n }, { hash: `0x${'2'.repeat(64)}`, number: 100n }, evidence, readCanonicalHash)).toBe(true)
			expect(evidence.marketConsensus).toBeUndefined()
			expect(evidence.marketConsensusByAsset.size).toBe(0)
			expect(evidence.marketObservations).toEqual([cex])
		}
		const evidence: { marketConsensus: unknown; marketConsensusByAsset: Map<string, unknown>; marketObservations: MarketConsensusObservation[] } = {
			marketConsensus: { reliable: true },
			marketConsensusByAsset: new Map([['rep', { reliable: true }]]),
			marketObservations: [cex, dex],
		}
		await expect(clearOrphanedDexEvidenceForHeadReplacement({ hash: `0x${'1'.repeat(64)}`, number: 100n }, { hash: `0x${'2'.repeat(64)}`, number: 101n }, evidence, async () => Promise.reject(new Error('canonical read failed')))).rejects.toThrow('canonical read failed')
		expect(evidence.marketConsensus).toBeUndefined()
		expect(evidence.marketConsensusByAsset.size).toBe(0)
		expect(evidence.marketObservations).toEqual([cex])
	})

	test('partitions mixed root and child evidence before exact-asset estimation', () => {
		const root = observation('cex', 'root', 200n)
		const child = { ...observation('dex', 'child', 300n), assetId: 'child-rep' }
		const wrongChain = { ...observation('cex', 'wrong-chain', 400n), chainId: 2 }
		expect(marketObservationsForAsset([root, child, wrongChain], 'rep', 1)).toEqual([root])
		expect(marketObservationsForAsset([root, child, wrongChain], 'CHILD-REP', 1)).toEqual([child])
	})
	test('revalidates every canonical DEX evidence block at the final boundary', async () => {
		const hash = `0x${'1'.repeat(64)}` as const
		const dex = { ...observation('dex', 'one', 200n), blockHash: hash, blockNumber: 100n }
		const estimate = estimateMarketConsensus([observation('cex', 'alpha', 200n), observation('cex', 'beta', 200n), dex, { ...dex, sourceId: 'two' }], settings, 'rep', 1, 10_000)
		await expect(requireCanonicalDexEvidence(estimate, async () => hash)).resolves.toBeUndefined()
		await expect(requireCanonicalDexEvidence(estimate, async () => `0x${'2'.repeat(64)}`)).rejects.toThrow('Canonical block changed during market observation')
	})
	test('requires explicit fallback and counts only the selected reliable group toward total quorum', () => {
		const observations = [observation('cex', 'alpha', 200n), observation('cex', 'bad-cex', 500n), observation('dex', 'uniswap-v2', 201n), observation('dex', 'sushiswap-v2', 199n)]
		const estimate = estimateMarketConsensus(observations, settings, 'rep', 1, 10_000)
		expect(estimate.cex.reliable).toBe(false)
		expect(estimate.dex.reliable).toBe(true)
		expect(estimate.priceRepPerEth).toBeUndefined()
		expect(estimate.reliable).toBe(false)
		const fallback = estimateMarketConsensus(observations, { ...settings, allowSingleGroupFallback: true }, 'rep', 1, 10_000)
		expect(fallback.priceRepPerEth).toBe(200n * UNIT)
		expect(fallback.sourceCount).toBe(2)
		expect(fallback.reliable).toBe(false)
		const sufficientFallback = estimateMarketConsensus(observations, { ...settings, allowSingleGroupFallback: true, minimumTotalSourceCount: 2 }, 'rep', 1, 10_000)
		expect(sufficientFallback.reliable).toBe(true)
	})

	test('rejects wrong-chain evidence and a failure domain reused across venue groups', () => {
		expect(() => estimateMarketConsensus([{ ...observation('cex', 'alpha', 200n), chainId: 2 }], settings, 'rep', 1, 10_000)).toThrow('exact REP asset and chain')
		const estimate = estimateMarketConsensus([observation('cex', 'shared', 200n), observation('cex', 'beta', 200n), observation('dex', 'shared', 200n), observation('dex', 'two', 200n)], settings, 'rep', 1, 10_000)
		expect(estimate.reliable).toBe(false)
		expect(estimate.reasons).toContain('A failure-domain source ID is reused across CEX and DEX')
	})

	test('rejects disagreement between two internally coherent groups', () => {
		const estimate = estimateMarketConsensus([observation('cex', 'alpha', 300n), observation('cex', 'beta', 302n), observation('dex', 'uniswap-v2', 200n), observation('dex', 'sushiswap-v2', 201n)], settings, 'rep', 1, 10_000)
		expect(estimate.reliable).toBe(false)
		expect(estimate.reasons).toContain('CEX and DEX consensus groups disagree')
	})

	test('excludes the candidate DEX source from its own reference', () => {
		const estimate = estimateMarketConsensus([observation('cex', 'alpha', 200n), observation('cex', 'beta', 201n), observation('dex', 'candidate', 500n), observation('dex', 'uniswap-v2', 199n), observation('dex', 'sushiswap-v2', 200n)], settings, 'rep', 1, 10_000, 'candidate')
		expect(estimate.dex.observations.map(value => value.sourceId)).not.toContain('candidate')
		expect(consensusAllowsCandidate(500n * UNIT, estimate, 1_000n)).toBe(false)
	})

	test('excludes an explicitly configured duplicate of the candidate market', () => {
		const estimate = estimateMarketConsensus([observation('cex', 'alpha', 200n), observation('cex', 'beta', 201n), observation('dex', 'renamed-candidate', 500n, '0xpool'), observation('dex', 'one', 199n), observation('dex', 'two', 200n)], settings, 'rep', 1, 10_000, 'candidate-venue', '0xpool')
		expect(estimate.dex.observations.map(value => value.sourceId)).not.toContain('renamed-candidate')
	})

	test('counts one latest observation per independent source', () => {
		const estimate = estimateMarketConsensus([observation('cex', 'alpha', 100n), { ...observation('cex', 'alpha', 200n), observationId: 'cex:alpha:2', observedAt: 10_001 }, observation('cex', 'beta', 200n), observation('dex', 'one', 200n), observation('dex', 'two', 200n)], settings, 'rep', 1, 10_001)
		expect(estimate.cex.observations).toHaveLength(2)
		expect(estimate.cex.priceRepPerEth).toBe(200n * UNIT)
	})

	test('canonicalizes duplicate source timestamps independently of input order', () => {
		const strict = { ...settings, minimumTotalSourceCount: 4 }
		const alpha = observation('cex', 'alpha', 200n)
		const conflictingAlpha = { ...alpha, priceRepPerEth: 400n * UNIT }
		const remaining = [observation('cex', 'beta', 200n), observation('dex', 'one', 200n), observation('dex', 'two', 200n)]
		expect(estimateMarketConsensus([alpha, conflictingAlpha, ...remaining], strict, 'rep', 1, 10_000).reliable).toBe(false)
		expect(estimateMarketConsensus([conflictingAlpha, alpha, ...remaining], strict, 'rep', 1, 10_000).reliable).toBe(false)
		expect(estimateMarketConsensus([alpha, { ...alpha }, ...remaining], strict, 'rep', 1, 10_000).reliable).toBe(true)
		const deeperAlpha = { ...conflictingAlpha, askDepthAttoEth: 3n * UNIT, bidDepthAttoEth: 3n * UNIT }
		expect(estimateMarketConsensus([alpha, deeperAlpha, ...remaining.map(value => ({ ...value, priceRepPerEth: 400n * UNIT }))], strict, 'rep', 1, 10_000).reliable).toBe(true)
		expect(estimateMarketConsensus([deeperAlpha, alpha, ...remaining.map(value => ({ ...value, priceRepPerEth: 400n * UNIT }))], strict, 'rep', 1, 10_000).reliable).toBe(true)
	})

	test('requires observations to persist across the configured time span', () => {
		const persistentSettings = { ...settings, minimumSourceObservationCount: 2, minimumSourceObservationSpanMilliseconds: 5_000 }
		const firstRound = [observation('cex', 'alpha', 200n), observation('cex', 'beta', 200n), observation('dex', 'one', 200n), observation('dex', 'two', 200n)]
		expect(estimateMarketConsensus(firstRound, persistentSettings, 'rep', 1, 10_000).reliable).toBe(false)
		const secondRound = firstRound.map(value => ({ ...value, observationId: `${value.observationId}:2`, observedAt: 15_000 }))
		expect(estimateMarketConsensus([...firstRound, ...secondRound], persistentSettings, 'rep', 1, 15_000).reliable).toBe(true)
	})

	test('does not treat repeated polls of cached venue data as temporal persistence', () => {
		const persistentSettings = { ...settings, minimumSourceObservationCount: 2, minimumSourceObservationSpanMilliseconds: 5_000 }
		const cached = [observation('cex', 'alpha', 200n), observation('cex', 'beta', 200n), observation('dex', 'one', 200n), observation('dex', 'two', 200n)]
		expect(estimateMarketConsensus([...cached, ...cached], persistentSettings, 'rep', 1, 15_000).reliable).toBe(false)
	})

	test('requires a newly changed price regime to persist instead of inheriting warm-up history', () => {
		const persistentSettings = { ...settings, minimumSourceObservationCount: 2, minimumSourceObservationSpanMilliseconds: 5_000 }
		const stable = [observation('cex', 'alpha', 200n), observation('cex', 'beta', 200n), observation('dex', 'one', 200n), observation('dex', 'two', 200n)]
		const warm = stable.map(value => ({ ...value, observationId: `${value.observationId}:warm`, observedAt: 15_000 }))
		const spike = stable.map(value => ({ ...value, observationId: `${value.observationId}:spike`, observedAt: 20_000, priceRepPerEth: 400n * UNIT }))
		expect(estimateMarketConsensus([...stable, ...warm, ...spike], persistentSettings, 'rep', 1, 20_000).reliable).toBe(false)
		const persistedSpike = spike.map(value => ({ ...value, observationId: `${value.observationId}:persisted`, observedAt: 25_000 }))
		expect(estimateMarketConsensus([...stable, ...warm, ...spike, ...persistedSpike], persistentSettings, 'rep', 1, 25_000).reliable).toBe(true)
	})

	test('requires a returned price regime to rebuild persistence after an intervening move', () => {
		const persistentSettings = { ...settings, maximumObservationAgeMilliseconds: 30_000, minimumSourceObservationCount: 2, minimumSourceObservationSpanMilliseconds: 5_000 }
		const stable = [observation('cex', 'alpha', 200n), observation('cex', 'beta', 200n), observation('dex', 'one', 200n), observation('dex', 'two', 200n)]
		const warm = stable.map(value => ({ ...value, observationId: `${value.observationId}:warm`, observedAt: 15_000 }))
		const moved = stable.map(value => ({ ...value, observationId: `${value.observationId}:moved`, observedAt: 20_000, priceRepPerEth: 400n * UNIT }))
		const returned = stable.map(value => ({ ...value, observationId: `${value.observationId}:returned`, observedAt: 21_000 }))
		expect(estimateMarketConsensus([...stable, ...warm, ...moved, ...returned], persistentSettings, 'rep', 1, 21_000).reliable).toBe(false)
		const persistedReturn = returned.map(value => ({ ...value, observationId: `${value.observationId}:persisted`, observedAt: 26_000 }))
		expect(estimateMarketConsensus([...stable, ...warm, ...moved, ...returned, ...persistedReturn], persistentSettings, 'rep', 1, 26_000).reliable).toBe(true)
	})

	test('fails closed for unreliable or asset-mismatched evidence only in required mode', () => {
		const estimate = estimateMarketConsensus([observation('cex', 'alpha', 200n), observation('cex', 'beta', 200n), observation('dex', 'one', 200n), observation('dex', 'two', 200n)], settings, 'rep', 1, 10_000)
		const required = { maximumDeviationBps: 500n, maximumObservationAgeMilliseconds: 30_000, requiredForExecution: true }
		const advisory = { ...required, requiredForExecution: false }
		expect(marketConsensusAllowsExecution(200n * UNIT, estimate, required, 'child-rep', 1, 10_000)).toBe(false)
		expect(marketConsensusAllowsExecution(200n * UNIT, estimate, advisory, 'child-rep', 1, 10_000)).toBe(true)
		expect(marketConsensusAllowsExecution(200n * UNIT, estimate, required, 'rep', 1, 40_001)).toBe(false)
		expect(marketConsensusAllowsExecution(200n * UNIT, estimate, advisory, 'rep', 1, 40_001)).toBe(true)
		expect(marketConsensusAllowsExecution(200n * UNIT, estimate, required, 'rep', 2, 10_000)).toBe(false)
	})
})
