/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getDownloadedStorageKey, resetLocalEntityStoreForTesting, serializeStoredValue, type LocalEntityScope } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { derivePoolBrowseRows, filterPoolBrowseRows, securityPoolDownloadStore, sortPoolBrowseRows, toCachedSecurityPool } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolBrowse.js'
import { describe, expect, test } from 'bun:test'

function createPool(index: number, overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		mintingCapacityAttoEth: 10n * 10n ** 18n,
		currentRetentionRate: 10n,
		feeEligibleUnderwritingLimitAttoEth: 0n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: false,
		hasForkContinuationEscalationGame: false,
		hasLoadedVaults: true,
		initialReportPriorityFeeAttoEthPerGas: 1n,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails({ endTime: BigInt(index * 100), title: `Pool ${index.toString()}` }),
		migratedAttoRep: 0n,
		ordinaryEscalationGameStarted: false,
		parent: zeroAddress,
		questionId: `0x${index.toString(16)}`,
		questionOutcome: 'none',
		securityPoolAddress: getAddress(`0x${index.toString(16).padStart(40, '0')}`),
		settlementCollateralAttoEth: 0n,
		shareTokenSupplyAttoShares: 0n,
		statoblastSecurityMultiplierBps: 20_000n,
		systemState: 'operational',
		totalUnderwritingLimitAttoEth: 10n * 10n ** 18n,
		totalPoolHeldAttoRep: 0n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 2n,
		vaults: [{ underwritingLimitAttoEth: 1n, claimableFeesAttoEth: 0n, disputeStakedAttoRep: 0n, vaultAddress: zeroAddress, vaultAttoRepBacking: 1n }],
		...overrides,
	}
}

function toRows(pools: readonly ListedSecurityPool[]) {
	return derivePoolBrowseRows(pools.map((pool, index) => ({ data: pool, favoritedAt: undefined, fetchedAt: index, id: pool.securityPoolAddress })))
}

const scope: LocalEntityScope = { app: 'statoblast', kind: 'pool', network: 'test-0x1' }

void describe('pool browse cache', () => {
	installDomTestLifecycle({
		afterTest: () => {
			resetLocalEntityStoreForTesting()
		},
		beforeTest: () => {
			resetLocalEntityStoreForTesting()
		},
	})

	void test('round-trips a cached pool through storage without its vault positions', () => {
		const pool = createPool(1, { feeAccrualState: { feeEndTimestamp: 1n, feeIndexRemainder: 2n, lastUpdatedFeeAccumulator: 3n, totalFeesOwedRemainder: 4n }, lastOraclePrice: 3n * 10n ** 18n, minimumSecurityBondDebtAttoEth: 5n })
		const cached = toCachedSecurityPool(pool)
		expect(cached.vaults).toEqual([])
		expect(cached.hasLoadedVaults).toBe(false)
		securityPoolDownloadStore.record(scope, [{ data: cached, id: cached.securityPoolAddress }], 1)
		resetLocalEntityStoreForTesting()
		expect(securityPoolDownloadStore.read(scope).map(entry => entry.data)).toEqual([cached])
	})

	void test('drops a cached pool with an unknown system state or a malformed address', () => {
		const cached = toCachedSecurityPool(createPool(1))
		const items = [
			{ data: { ...cached, systemState: 'paused' }, fetchedAt: 1, id: 'a' },
			{ data: { ...cached, securityPoolAddress: '0x123' }, fetchedAt: 1, id: 'b' },
			{ data: cached, fetchedAt: 1, id: 'c' },
		]
		window.localStorage.setItem(getDownloadedStorageKey(scope), serializeStoredValue({ items, version: 1 }))
		expect(securityPoolDownloadStore.read(scope).map(entry => entry.id)).toEqual(['c'])
	})
})

void describe('pool browse rows', () => {
	void test('filters by universe, state, and text over every downloaded pool', () => {
		const rows = toRows([createPool(1), createPool(2, { universeId: 2n }), createPool(3, { questionOutcome: 'yes' }), createPool(14)])
		expect(filterPoolBrowseRows(rows, { activeUniverseId: 1n, normalizedSearchText: '', stateFilter: 'all' }).map(row => row.pool.marketDetails.title)).toEqual(['Pool 1', 'Pool 3', 'Pool 14'])
		expect(filterPoolBrowseRows(rows, { activeUniverseId: 1n, normalizedSearchText: '', stateFilter: 'ended' }).map(row => row.pool.marketDetails.title)).toEqual(['Pool 3'])
		expect(filterPoolBrowseRows(rows, { activeUniverseId: 1n, normalizedSearchText: 'pool 14', stateFilter: 'all' }).map(row => row.pool.marketDetails.title)).toEqual(['Pool 14'])
		expect(filterPoolBrowseRows(rows, { activeUniverseId: 1n, normalizedSearchText: '0x000000000000000000000000000000000000000e', stateFilter: 'all' }).map(row => row.pool.marketDetails.title)).toEqual(['Pool 14'])
	})

	void test('filters with the badge vocabulary, so every pool badged Fork migration matches that filter', () => {
		const rows = toRows([createPool(1, { systemState: 'poolForked' }), createPool(2, { systemState: 'forkMigration' }), createPool(3)])
		expect(rows.map(row => row.lifecycleState)).toEqual(['poolForked', 'forkMigration', 'operational'])
		expect(filterPoolBrowseRows(rows, { activeUniverseId: 1n, normalizedSearchText: '', stateFilter: 'forkMigration' }).map(row => row.pool.marketDetails.title)).toEqual(['Pool 1', 'Pool 2'])
	})

	void test('sorts by remaining capacity, largest first, with pools that cannot mint at zero', () => {
		const rows = toRows([
			createPool(1, { settlementCollateralAttoEth: 4n * 10n ** 18n }),
			createPool(2, { totalUnderwritingLimitAttoEth: 0n, mintingCapacityAttoEth: 0n }),
			createPool(3, { settlementCollateralAttoEth: 1n * 10n ** 18n }),
			createPool(4, { ordinaryEscalationGameStarted: true }),
			createPool(5, { mintingCapacityAttoEth: 0n }),
		])
		expect(sortPoolBrowseRows(rows, 'remainingCapacity', 0n).map(row => row.pool.marketDetails.title)).toEqual(['Pool 3', 'Pool 1', 'Pool 2', 'Pool 4', 'Pool 5'])
		expect(rows.find(row => row.pool.marketDetails.title === 'Pool 4')?.remainingCapacity).toBe(0n)
	})

	void test('unknown capacity and either escalation game keep minting closed', () => {
		const rows = toRows([createPool(1, { mintingCapacityAttoEth: undefined }), createPool(2, { ordinaryEscalationGameStarted: true }), createPool(3, { hasForkContinuationEscalationGame: true })])
		expect(rows.map(row => row.remainingCapacity)).toEqual([0n, 0n, 0n])
	})

	void test('sorts open pools by soonest end and puts ended pools after them, most recent first', () => {
		const rows = toRows([createPool(1), createPool(5), createPool(3), createPool(2)])
		expect(sortPoolBrowseRows(rows, 'endTime', 250n).map(row => row.pool.marketDetails.title)).toEqual(['Pool 3', 'Pool 5', 'Pool 2', 'Pool 1'])
	})

	void test('sorts by lifecycle state and keeps collection order for ties', () => {
		const rows = toRows([createPool(1, { questionOutcome: 'yes' }), createPool(2), createPool(3, { systemState: 'forkTruthAuction' }), createPool(4)])
		expect(sortPoolBrowseRows(rows, 'state', 0n).map(row => row.pool.marketDetails.title)).toEqual(['Pool 2', 'Pool 4', 'Pool 3', 'Pool 1'])
		expect(sortPoolBrowseRows(rows, 'recent', 0n).map(row => row.pool.marketDetails.title)).toEqual(['Pool 1', 'Pool 2', 'Pool 3', 'Pool 4'])
	})
})
