import { describe, expect, test } from 'bun:test'
import { parseSettings } from '../../src/config/settings.ts'
import { validateApprovedUniverseSelection } from '@zoltar/bot-shared/monitoring/universe-policy'
import { marketPriceAllowsExecution } from '../../src/core/candidate-selection.ts'
import { initialRuntimeState, operatorSnapshot, type UniverseObservation } from '../../src/state/operator-state.ts'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { storedStrategyFixture } from '../support/strategy-settings.ts'

const wallet = getAddress('0x0000000000000000000000000000000000000009')

function settings(approvedUniverses = ['101']) {
	return parseSettings({
		approvedUniverses,
		centralizedMarkets: {
			assetAddress: zeroAddress,
			assetChainId: 1,
			assetSymbol: 'REP',
			depthBps: 500,
			maximumDexDeviationBps: 1000,
			maximumObservationAgeMilliseconds: 30000,
			maximumVenueDispersionBps: 500,
			minimumAskDepthEth: '0',
			minimumBidDepthEth: '0',
			minimumSourceCount: 1,
			orderBookLimit: 20,
			requestTimeoutMilliseconds: 5000,
			requiredForExecution: false,
			sources: [],
		},
		connectivity: {
			publicRpcUrls: ['https://public.example'],
			quorumRpcUrls: [],
			readRpcUrl: 'https://read.example',
		},
		deployment: {
			securityPoolFactory: zeroAddress,
			weth: zeroAddress,
			zoltar: zeroAddress,
		},
		network: {
			chainId: 1,
			explorerUrl: 'https://example.test',
			name: 'mainnet',
		},
		paused: false,
		privateKey: null,
		runtime: {
			execute: false,
			once: true,
			pollMilliseconds: 12_000,
			stateFile: '.state/fork-migration-test.json',
			ui: false,
			uiHost: '127.0.0.1',
			uiPort: 4183,
		},
		selectedSecurityPools: [],
		strategy: storedStrategyFixture(),
		submission: {
			minimumBundleRelaySuccesses: 1,
			mode: 'public',
			relayUrls: [],
		},
		version: 2,
	})
}

function universe(id: bigint, approved: boolean, parentId?: bigint, outcomeIndex?: bigint): UniverseObservation {
	return {
		approved,
		forkQuestionId: 42n,
		forkTime: parentId === undefined ? 1_000n : 0n,
		id,
		outcomeIndex,
		parentId,
		repToken: zeroAddress,
	}
}

const rootUniverse = universe(0n, false)
const approvedChildUniverse = universe(101n, true, 0n, 1n)

describe('fork migration strategy', () => {
	test('does not apply root REP market evidence to a child-universe REP pool', () => {
		const rootRep = getAddress('0x0000000000000000000000000000000000000077')
		const childRep = getAddress('0x0000000000000000000000000000000000000088')
		const rootPool = { lastPrice: 10n * 10n ** 18n, repToken: rootRep }
		const childPool = { lastPrice: 10n * 10n ** 18n, repToken: childRep }
		const state = initialRuntimeState(false, wallet, 1)
		state.centralizedMarket = {
			assetId: rootRep,
			askDepthAttoEth: 4n * 10n ** 18n,
			bidDepthAttoEth: 4n * 10n ** 18n,
			chainId: 1,
			maximumPriceRepPerEth: 10n * 10n ** 18n,
			minimumPriceRepPerEth: 10n * 10n ** 18n,
			observations: [],
			priceRepPerEth: 10n * 10n ** 18n,
			reasons: [],
			reliable: true,
		}
		const observedAt = Date.now()
		const marketObservation = (kind: 'cex' | 'dex', sourceId: string) => ({ assetId: rootRep, askDepthAttoEth: 2n * 10n ** 18n, bidDepthAttoEth: 2n * 10n ** 18n, chainId: 1, kind, observationId: `${kind}:${sourceId}:1`, observedAt, priceRepPerEth: 10n * 10n ** 18n, sourceId })
		state.marketConsensus = {
			assetId: rootRep,
			cex: {
				askDepthAttoEth: 4n * 10n ** 18n,
				bidDepthAttoEth: 4n * 10n ** 18n,
				kind: 'cex',
				maximumPriceRepPerEth: 10n * 10n ** 18n,
				minimumPriceRepPerEth: 10n * 10n ** 18n,
				observations: [marketObservation('cex', 'alpha'), marketObservation('cex', 'beta')],
				priceRepPerEth: 10n * 10n ** 18n,
				reasons: [],
				reliable: true,
			},
			chainId: 1,
			dex: {
				askDepthAttoEth: 4n * 10n ** 18n,
				bidDepthAttoEth: 4n * 10n ** 18n,
				kind: 'dex',
				maximumPriceRepPerEth: 10n * 10n ** 18n,
				minimumPriceRepPerEth: 10n * 10n ** 18n,
				observations: [marketObservation('dex', 'one'), marketObservation('dex', 'two')],
				priceRepPerEth: 10n * 10n ** 18n,
				reasons: [],
				reliable: true,
			},
			priceRepPerEth: 10n * 10n ** 18n,
			reasons: [],
			reliable: true,
			sourceCount: 4,
		}
		const centralizedMarkets = {
			...settings().centralizedMarkets,
			assetAddress: rootRep,
			minimumSourceCount: 2,
			requiredForExecution: true,
			sources: [
				{ ethMarket: 'ETH/USD', exchangeId: 'alpha', repMarket: 'REP/USD' },
				{ ethMarket: 'ETH/USD', exchangeId: 'beta', repMarket: 'REP/USD' },
			],
			venueConsensus: {
				allowSingleGroupFallback: false,
				dexProbeDepthAttoEth: 1n * 10n ** 18n,
				dexSources: [
					{ feeBps: 30, pair: getAddress('0x0000000000000000000000000000000000000011'), sourceId: 'one' },
					{ feeBps: 30, pair: getAddress('0x0000000000000000000000000000000000000012'), sourceId: 'two' },
				],
				maximumGroupDeviationBps: 500n,
				minimumDexAskDepthAttoEth: 1n * 10n ** 18n,
				minimumDexBidDepthAttoEth: 1n * 10n ** 18n,
				minimumDexSourceCount: 2,
				minimumSourceObservationCount: 2,
				minimumSourceObservationSpanMilliseconds: 10_000,
				minimumTotalSourceCount: 3,
			},
		}
		const rootSettings = { ...settings(), centralizedMarkets }
		state.marketConsensusByAsset.set(rootRep.toLowerCase(), state.marketConsensus)
		expect(marketPriceAllowsExecution(rootPool, rootSettings, state)).toBe(true)
		expect(marketPriceAllowsExecution(childPool, rootSettings, state)).toBe(false)

		const childObservation = (observation: (typeof state.marketConsensus.cex.observations)[number]) => ({ ...observation, assetId: childRep, observationId: `${observation.observationId}:child` })
		const childConsensus = {
			...state.marketConsensus,
			assetId: childRep,
			cex: { ...state.marketConsensus.cex, observations: state.marketConsensus.cex.observations.map(childObservation) },
			dex: { ...state.marketConsensus.dex, observations: state.marketConsensus.dex.observations.map(childObservation) },
		}
		state.marketConsensusByAsset.set(childRep.toLowerCase(), childConsensus)
		const childConfiguration = { ...centralizedMarkets, assetAddress: childRep }
		const childSettings = { ...rootSettings, childMarketConfigurations: [childConfiguration] }
		expect(marketPriceAllowsExecution(childPool, childSettings, state)).toBe(true)
		state.marketConsensusByAsset.delete(childRep.toLowerCase())
		expect(marketPriceAllowsExecution(childPool, childSettings, state)).toBe(false)
		state.marketConsensusByAsset.delete(rootRep.toLowerCase())
		state.marketConsensus = { ...state.marketConsensus, cex: { ...state.marketConsensus.cex, reliable: false } }
		state.activities.push({ at: new Date().toISOString(), kind: 'scan', message: 'DEX market evidence reset after canonical head replacement', status: 'info' }, { at: new Date().toISOString(), kind: 'scan', message: 'DEX market evidence reset after canonical head replacement', status: 'info' })
		const warningSnapshot = operatorSnapshot(state, false, [centralizedMarkets])
		expect(warningSnapshot.alerts.some(alert => alert.message.includes('single-group fallback'))).toBe(true)
		expect(warningSnapshot.alerts.some(alert => alert.message.includes('2 canonical market-evidence resets'))).toBe(true)

		const centralizedObservation = {
			assetId: rootRep,
			askDepthAttoEth: 2n * 10n ** 18n,
			bestAskQuote: '0.1',
			bestBidQuote: '0.09',
			bidDepthAttoEth: 2n * 10n ** 18n,
			chainId: 1,
			exchangeId: 'alpha',
			ethTickerTimestamp: observedAt,
			observedAt,
			orderBookTimestamp: observedAt,
			priceRepPerEth: 10n * 10n ** 18n,
			repMarket: 'REP/USD',
			usesEthTicker: true,
		}
		state.centralizedMarket = { ...state.centralizedMarket, observations: [centralizedObservation] }
		state.marketObservations = [marketObservation('dex', 'one')]
		state.marketConsensus = {
			...state.marketConsensus,
			cex: { ...state.marketConsensus.cex, observations: state.marketConsensus.cex.observations.filter(observation => observation.sourceId !== 'alpha') },
			dex: { ...state.marketConsensus.dex, observations: state.marketConsensus.dex.observations.filter(observation => observation.sourceId !== 'one') },
		}
		const persistenceSnapshot = operatorSnapshot(state, false, [centralizedMarkets])
		expect(persistenceSnapshot.marketSources.find(source => source.id === 'alpha')).toMatchObject({ reason: 'Observed but excluded by persistence, depth, or dispersion policy', status: 'excluded' })
		expect(persistenceSnapshot.marketSources.find(source => source.id === 'one')).toMatchObject({ reason: 'Observed but excluded by persistence, depth, or dispersion policy', status: 'excluded' })
	})

	test('rejects competing approved children of the same parent universe', () => {
		const competingChildUniverse = universe(102n, true, 0n, 2n)
		expect(() => validateApprovedUniverseSelection([rootUniverse, approvedChildUniverse, competingChildUniverse], [101n, 102n])).toThrow('Select only one truthful child of universe 0')
	})

	test('rejects a descendant whose implied truth path conflicts with another approval', () => {
		const competingChildUniverse = universe(102n, false, 0n, 2n)
		const competingGrandchildUniverse = universe(201n, true, 102n, 1n)
		const tree = [rootUniverse, approvedChildUniverse, competingChildUniverse, competingGrandchildUniverse]
		expect(() => validateApprovedUniverseSelection(tree, [101n, 201n])).toThrow('Select only one truthful child of universe 0')
		expect(() => validateApprovedUniverseSelection(tree, [102n, 201n])).not.toThrow()
	})
})
