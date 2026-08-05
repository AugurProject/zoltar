import { describe, expect, test } from 'bun:test'
import { parseSettings } from '../../src/config/settings.ts'
import { FORK_MIGRATION_WINDOW_SECONDS, inheritedChildPoolSelections, isPoolExecutionEligible, isVaultMigrationSourceEligible, selectVaultMigration, validateApprovedUniverseSelection } from '../../src/core/fork-migration.ts'
import { validatePoolUniverseRep } from '../../src/monitoring/pool-monitor.ts'
import { initialRuntimeState, operatorSnapshot, type PoolObservation, type UniverseObservation } from '../../src/state/operator-state.ts'
import { getAddress, zeroAddress } from '../helpers/ethereum.ts'

const wallet = getAddress('0x0000000000000000000000000000000000000009')
const forker = getAddress('0x0000000000000000000000000000000000000008')

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
			maxVaultsPerPool: 100,
			once: true,
			pollMilliseconds: 12_000,
			stateFile: '.state/fork-migration-test.json',
			ui: false,
			uiHost: '127.0.0.1',
			uiPort: 4183,
		},
		selectedPools: [],
		strategy: {
			allowAutomaticDeposits: true,
			allowAutomaticVaultMigrations: true,
			allowAutomaticWithdrawals: true,
			candidatePriority: 'largest-bonus',
			fallbackRepPerEthPrice: '0',
			maximumGasCostEth: '0.02',
			maximumLiquidationCoverageCommitmentEth: '25',
			maximumOracleRequestCostEth: '0.02',
			maximumPerPoolRep: '10000',
			maximumTotalDeployedRep: '25000',
			minimumLiquidationCoverageCommitmentEth: '1',
			minimumRepWithdrawalRep: '10',
			minimumRewardValueEth: '0.02',
			redeemFeesAboveEth: '0.01',
			stalePriceFundingBufferBps: 15_000,
			stagedOperationValidForSeconds: 240,
			vaultTargetHealthBps: 12_500,
			vaultTopUpHealthBps: 11_000,
			vaultWithdrawHealthBps: 15_000,
			walletReserveRep: '100',
		},
		submission: {
			minimumBundleRelaySuccesses: 1,
			mode: 'public',
			relayUrls: [],
		},
		version: 1,
	})
}

function pool(parameters: { address: string; approvedUniverse?: boolean; forkActivationTime?: bigint; forkOutcomeIndex?: bigint; parent?: string; parentUniverseId?: bigint; selected?: boolean; systemState?: bigint; universeId: bigint; vaultAttoRep?: bigint }): PoolObservation {
	return {
		activeVaultCount: 0n,
		address: getAddress(parameters.address),
		approvedUniverse: parameters.approvedUniverse ?? false,
		botVault: {
			address: wallet,
			coverageCommitmentAttoEth: 0n,
			backingUnits: parameters.vaultAttoRep ?? 0n,
			vaultAttoRepBacking: parameters.vaultAttoRep ?? 0n,
			claimableFeesAttoEth: 0n,
		},
		candidates: [],
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 0n,
		forkActivationTime: parameters.forkActivationTime ?? 0n,
		forkOutcomeIndex: parameters.forkOutcomeIndex,
		initialReportPriorityFeeAttoEthPerGas: 0n,
		isPriceValid: true,
		lastPrice: 0n,
		lastSettlementTimestamp: 0n,
		manager: zeroAddress,
		minLiquidationPriceDistanceBps: 0n,
		minimumToken1ReportAttoEth: 0n,
		multiplierBps: 20_000n,
		parent: getAddress(parameters.parent ?? zeroAddress),
		parentUniverseId: parameters.parentUniverseId,
		pendingReportId: 0n,
		pendingReportSponsor: zeroAddress,
		questionId: 1n,
		repToken: zeroAddress,
		requestPriceCostAttoEth: 0n,
		selected: parameters.selected ?? false,
		securityPoolForker: forker,
		stagedOperations: [],
		systemState: parameters.systemState ?? 0n,
		totalCoverageCommitmentAttoEth: 0n,
		totalAttoRep: 0n,
		truncatedVaults: false,
		universeId: parameters.universeId,
		vaults: [],
	}
}

const parent = pool({
	address: '0x0000000000000000000000000000000000000010',
	forkActivationTime: 1_000n,
	selected: true,
	systemState: 1n,
	universeId: 0n,
	vaultAttoRep: 20n,
})

const approvedChild = pool({
	address: '0x0000000000000000000000000000000000000011',
	approvedUniverse: true,
	forkOutcomeIndex: 1n,
	parent: parent.address,
	parentUniverseId: 0n,
	systemState: 2n,
	universeId: 101n,
})

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
	test('trusts genesis REP through the configured Zoltar universe record without a token accessor', () => {
		const genesisRep = getAddress('0x0000000000000000000000000000000000000077')
		const genesisPool = { ...parent, repToken: genesisRep }
		const genesisUniverse = { ...rootUniverse, repToken: genesisRep }
		expect(() => validatePoolUniverseRep(genesisPool, [genesisUniverse])).not.toThrow()
		expect(() => validatePoolUniverseRep({ ...genesisPool, repToken: wallet }, [genesisUniverse])).toThrow('does not match universe 0 REP')
		expect(() => validatePoolUniverseRep({ ...genesisPool, universeId: 999n }, [genesisUniverse])).toThrow('belongs to unknown universe 999')
	})

	test('routes a selected parent vault to its approved direct child during the migration window', () => {
		const migration = selectVaultMigration([parent, approvedChild], [rootUniverse, approvedChildUniverse], settings(), 1_000n)
		expect(migration?.parent.address).toBe(parent.address)
		expect(migration?.childPool?.address).toBe(approvedChild.address)
		expect(migration?.childUniverse.id).toBe(101n)
		expect(migration?.outcomeIndex).toBe(1n)
		expect(migration?.deadline).toBe(1_000n + FORK_MIGRATION_WINDOW_SECONDS)
	})

	test('can route into an approved universe before its child pool exists', () => {
		const migration = selectVaultMigration([parent], [rootUniverse, approvedChildUniverse], settings(), 1_000n)
		expect(migration?.childPool).toBeUndefined()
		expect(migration?.childUniverse.id).toBe(101n)
	})

	test('inherits a selected parent pool onto its registered approved child independent of execution settings', () => {
		expect(inheritedChildPoolSelections([parent, approvedChild], [parent.address]).map(pool => pool.address)).toEqual([approvedChild.address])
		expect(inheritedChildPoolSelections([parent, approvedChild], [parent.address, approvedChild.address])).toEqual([])
	})

	test('does not migrate after the fork migration window closes', () => {
		expect(selectVaultMigration([parent, approvedChild], [rootUniverse, approvedChildUniverse], settings(), 1_000n + FORK_MIGRATION_WINDOW_SECONDS + 1n)).toBeUndefined()
	})

	test('uses the exact migration window boundary for planning and dashboard eligibility', () => {
		const deadline = parent.forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
		expect(isVaultMigrationSourceEligible(parent, deadline)).toBe(true)
		expect(isVaultMigrationSourceEligible(parent, deadline + 1n)).toBe(false)
		expect(isVaultMigrationSourceEligible({ ...parent, forkActivationTime: 0n }, 0n)).toBe(false)

		const state = initialRuntimeState(false, wallet)
		state.pools = [parent]
		state.universes = [rootUniverse, approvedChildUniverse]
		state.lastScannedTimestamp = deadline
		const eligible = operatorSnapshot(state, false).universes.find(universe => universe.id === '101')
		expect(eligible?.migratableVaultCount).toBe(1)
		state.lastScannedTimestamp = deadline + 1n
		const expired = operatorSnapshot(state, false).universes.find(universe => universe.id === '101')
		expect(expired?.migratableVaultCount).toBe(0)
	})

	test('does not apply root REP market evidence to a child-universe REP pool', () => {
		const rootRep = getAddress('0x0000000000000000000000000000000000000077')
		const childRep = getAddress('0x0000000000000000000000000000000000000088')
		const rootPool = { ...parent, lastPrice: 10n * 10n ** 18n, repToken: rootRep }
		const childPool = { ...approvedChild, lastPrice: 10n * 10n ** 18n, repToken: childRep }
		const state = initialRuntimeState(false, wallet)
		state.pools = [rootPool, childPool]
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
		const snapshot = operatorSnapshot(state, false, centralizedMarkets)
		expect(snapshot.pools.find(candidate => candidate.address === rootPool.address)?.centralizedPriceAllowed).toBe(true)
		expect(snapshot.pools.find(candidate => candidate.address === childPool.address)?.centralizedPriceAllowed).toBe(false)
		expect(snapshot.pools.find(candidate => candidate.address === childPool.address)?.centralizedPriceDeviationBps).toBeUndefined()

		const childObservation = (observation: (typeof state.marketConsensus.cex.observations)[number]) => ({ ...observation, assetId: childRep, observationId: `${observation.observationId}:child` })
		const childConsensus = {
			...state.marketConsensus,
			assetId: childRep,
			cex: { ...state.marketConsensus.cex, observations: state.marketConsensus.cex.observations.map(childObservation) },
			dex: { ...state.marketConsensus.dex, observations: state.marketConsensus.dex.observations.map(childObservation) },
		}
		state.marketConsensusByAsset.set(childRep.toLowerCase(), childConsensus)
		const childConfiguration = { ...centralizedMarkets, assetAddress: childRep }
		const childSnapshot = operatorSnapshot(state, false, [centralizedMarkets, childConfiguration])
		expect(childSnapshot.pools.find(candidate => candidate.address === childPool.address)?.centralizedPriceAllowed).toBe(true)
		const inactiveConfiguration = { ...centralizedMarkets, assetAddress: getAddress('0x0000000000000000000000000000000000000099') }
		state.marketConsensusByAsset.delete(childRep.toLowerCase())
		const missingChildSnapshot = operatorSnapshot(state, false, [centralizedMarkets, childConfiguration, inactiveConfiguration])
		expect(missingChildSnapshot.alerts.some(alert => alert.message.includes('0x0000…0088') && alert.message.includes('unavailable'))).toBe(true)
		expect(missingChildSnapshot.alerts.some(alert => alert.message.includes('0x0000…0099'))).toBe(false)
		state.marketConsensus = { ...state.marketConsensus, cex: { ...state.marketConsensus.cex, reliable: false } }
		state.activities.push({ at: new Date().toISOString(), kind: 'scan', message: 'DEX market evidence reset after canonical head replacement', status: 'info' }, { at: new Date().toISOString(), kind: 'scan', message: 'DEX market evidence reset after canonical head replacement', status: 'info' })
		const warningSnapshot = operatorSnapshot(state, false, centralizedMarkets)
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
		const persistenceSnapshot = operatorSnapshot(state, false, centralizedMarkets)
		expect(persistenceSnapshot.marketSources.find(source => source.id === 'alpha')).toMatchObject({ reason: 'Observed but excluded by persistence, depth, or dispersion policy', status: 'excluded' })
		expect(persistenceSnapshot.marketSources.find(source => source.id === 'one')).toMatchObject({ reason: 'Observed but excluded by persistence, depth, or dispersion policy', status: 'excluded' })
	})

	test('waits while a staged operation still involves the bot vault', () => {
		const stagedParent: PoolObservation = {
			...parent,
			stagedOperations: [
				{
					operationAmountAttoRepOrAttoEth: 1n,
					id: 1n,
					initiatorVault: wallet,
					isPendingSettlement: true,
					operation: 0n,
					queuedAt: 1n,
					snapshotTotalRepBackingUnits: 1n,
					snapshotTargetCoverageCommitmentAttoEth: 1n,
					snapshotTargetBackingUnits: 1n,
					snapshotTotalPoolHeldAttoRep: 1n,
					targetVault: getAddress('0x0000000000000000000000000000000000000099'),
					validForSeconds: 240n,
				},
			],
		}
		expect(selectVaultMigration([stagedParent], [rootUniverse, approvedChildUniverse], settings(), 1_000n)).toBeUndefined()
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

	test('only executes pool strategy for selected operational pools in approved universes', () => {
		expect(isPoolExecutionEligible({ approvedUniverse: true, selected: true, systemState: 0n })).toBe(true)
		expect(isPoolExecutionEligible({ approvedUniverse: false, selected: true, systemState: 0n })).toBe(false)
		expect(isPoolExecutionEligible({ approvedUniverse: true, selected: false, systemState: 0n })).toBe(false)
		expect(isPoolExecutionEligible({ approvedUniverse: true, selected: true, systemState: 2n })).toBe(false)
	})
})
