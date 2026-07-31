import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { parseSettings } from '../../src/config/settings.ts'
import { FORK_MIGRATION_WINDOW_SECONDS, inheritedChildPoolSelections, isPoolExecutionEligible, isVaultMigrationSourceEligible, selectVaultMigration, validateApprovedUniverseSelection } from '../../src/core/fork-migration.ts'
import { validatePoolUniverseRep } from '../../src/monitoring/pool-monitor.ts'
import { initialRuntimeState, operatorSnapshot, type PoolObservation, type UniverseObservation } from '../../src/state/operator-state.ts'

const wallet = getAddress('0x0000000000000000000000000000000000000009')
const forker = getAddress('0x0000000000000000000000000000000000000008')

function settings(approvedUniverses = ['101']) {
	return parseSettings({
		approvedUniverses,
		centralizedMarkets: {
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
			maximumLiquidationDebtEth: '25',
			maximumOracleRequestCostEth: '0.02',
			maximumRepPerPool: '10000',
			maximumTotalDeployedRep: '25000',
			minimumLiquidationDebtEth: '1',
			minimumRepWithdrawal: '10',
			minimumRewardValueEth: '0.02',
			redeemFeesAboveEth: '0.01',
			stalePriceFundingBufferBps: 15_000,
			stagedOperationValidForSeconds: 240,
			vaultTargetHealthBps: 12_500,
			vaultTopUpHealthBps: 11_000,
			vaultWithdrawHealthBps: 15_000,
			walletRepReserve: '100',
		},
		submission: {
			minimumRelaySuccesses: 1,
			mode: 'public',
			relayUrls: [],
		},
		version: 1,
	})
}

function pool(parameters: { address: string; approvedUniverse?: boolean; forkActivationTime?: bigint; forkOutcomeIndex?: bigint; parent?: string; parentUniverseId?: bigint; selected?: boolean; systemState?: bigint; universeId: bigint; vaultRep?: bigint }): PoolObservation {
	return {
		activeVaultCount: 0n,
		address: getAddress(parameters.address),
		approvedUniverse: parameters.approvedUniverse ?? false,
		botVault: {
			address: wallet,
			allowance: 0n,
			ownership: parameters.vaultRep ?? 0n,
			rep: parameters.vaultRep ?? 0n,
			unpaidEthFees: 0n,
		},
		candidates: [],
		collateralEth: 0n,
		currentRetentionRate: 0n,
		forkActivationTime: parameters.forkActivationTime ?? 0n,
		forkOutcomeIndex: parameters.forkOutcomeIndex,
		initialReportPriorityFeeWeiPerGas: 0n,
		isPriceValid: true,
		lastPrice: 0n,
		lastSettlementTimestamp: 0n,
		manager: zeroAddress,
		minLiquidationPriceDistanceBps: 0n,
		minimumToken1Report: 0n,
		multiplierBps: 20_000n,
		parent: getAddress(parameters.parent ?? zeroAddress),
		parentUniverseId: parameters.parentUniverseId,
		pendingReportId: 0n,
		pendingReportSponsor: zeroAddress,
		questionId: 1n,
		repToken: zeroAddress,
		requestPriceCostEth: 0n,
		selected: parameters.selected ?? false,
		securityPoolForker: forker,
		stagedOperations: [],
		systemState: parameters.systemState ?? 0n,
		totalAllowanceEth: 0n,
		totalRep: 0n,
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
	vaultRep: 20n,
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

	test('waits while a staged operation still involves the bot vault', () => {
		const stagedParent: PoolObservation = {
			...parent,
			stagedOperations: [
				{
					amount: 1n,
					id: 1n,
					initiatorVault: wallet,
					isPendingSettlement: true,
					operation: 0n,
					queuedAt: 1n,
					snapshotDenominator: 1n,
					snapshotTargetAllowance: 1n,
					snapshotTargetOwnership: 1n,
					snapshotTotalRep: 1n,
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
