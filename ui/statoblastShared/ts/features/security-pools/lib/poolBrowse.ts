import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { matchesLocalSearch, type LocalBrowseEntry } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { createDownloadedEntityStore } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue, readStoredMarketDetails } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { calculateMintingCapacityAttoEth, getRemainingMintCapacity } from '../../markets/lib/trading.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from './securityPoolState.js'
import { resolveUiRepPerEthPrice, type UiPriceOracle } from './uiPriceOracle.js'

export type PoolSortKey = 'recent' | 'remainingCapacity' | 'endTime' | 'state'
export type PoolStateFilter = 'all' | SecurityPoolLifecycleState

export type PoolBrowseRow = Readonly<{
	capacity: bigint | undefined
	fetchedAt: number
	lifecycleState: SecurityPoolLifecycleState | undefined
	pool: ListedSecurityPool
	remainingCapacity: bigint | undefined
}>

const REPORTING_OUTCOMES = ['invalid', 'yes', 'no', 'none'] as const
const SYSTEM_STATES = ['operational', 'poolForked', 'forkMigration', 'forkTruthAuction'] as const
// Pools that accept new open interest come first, fork work next, finished pools last.
const LIFECYCLE_SORT_ORDER: readonly SecurityPoolLifecycleState[] = ['operational', 'forkTruthAuction', 'forkMigration', 'poolForked', 'ended']

/** Browse rows never show vault positions, so the cache drops them; opening the pool reloads its vaults. */
export function toCachedSecurityPool(pool: ListedSecurityPool): ListedSecurityPool {
	return { ...pool, hasLoadedVaults: false, vaults: [] }
}

function decodeCachedSecurityPool(value: unknown) {
	return decodeStoredValue(value, (read): ListedSecurityPool => {
		const feeAccrualState = read.optional('feeAccrualState', key => {
			const state = read.record(key)
			return { feeEndTimestamp: state.bigint('feeEndTimestamp'), feeIndexRemainder: state.bigint('feeIndexRemainder'), lastUpdatedFeeAccumulator: state.bigint('lastUpdatedFeeAccumulator'), totalFeesOwedRemainder: state.bigint('totalFeesOwedRemainder') }
		})
		const minimumSecurityBondDebtAttoEth = read.optional('minimumSecurityBondDebtAttoEth', read.bigint)
		const minimumVaultRepDepositAttoRep = read.optional('minimumVaultRepDepositAttoRep', read.bigint)
		return {
			currentRetentionRate: read.bigint('currentRetentionRate'),
			feeEligibleCapacityOwnershipAttoRep: read.bigint('feeEligibleCapacityOwnershipAttoRep'),
			forkOutcome: read.oneOf('forkOutcome', REPORTING_OUTCOMES),
			forkOwnSecurityPool: read.boolean('forkOwnSecurityPool'),
			hasForkActivity: read.boolean('hasForkActivity'),
			hasForkContinuationEscalationGame: read.boolean('hasForkContinuationEscalationGame'),
			hasLoadedVaults: false,
			initialReportPriorityFeeAttoEthPerGas: read.bigint('initialReportPriorityFeeAttoEthPerGas'),
			lastOraclePrice: read.optional('lastOraclePrice', read.bigint),
			lastOracleSettlementTimestamp: read.bigint('lastOracleSettlementTimestamp'),
			managerAddress: read.address('managerAddress'),
			marketDetails: readStoredMarketDetails(read.record('marketDetails')),
			migratedAttoRep: read.bigint('migratedAttoRep'),
			ordinaryEscalationGameStarted: read.boolean('ordinaryEscalationGameStarted'),
			parent: read.address('parent'),
			questionId: read.string('questionId'),
			questionOutcome: read.oneOf('questionOutcome', REPORTING_OUTCOMES),
			securityPoolAddress: read.address('securityPoolAddress'),
			settlementCollateralAttoEth: read.bigint('settlementCollateralAttoEth'),
			shareTokenSupplyAttoShares: read.bigint('shareTokenSupplyAttoShares'),
			statoblastSecurityMultiplierBps: read.bigint('statoblastSecurityMultiplierBps'),
			systemState: read.oneOf('systemState', SYSTEM_STATES),
			totalCapacityOwnershipAttoRep: read.bigint('totalCapacityOwnershipAttoRep'),
			totalPoolHeldAttoRep: read.bigint('totalPoolHeldAttoRep'),
			truthAuctionAddress: read.address('truthAuctionAddress'),
			truthAuctionStartedAt: read.bigint('truthAuctionStartedAt'),
			universeHasForked: read.boolean('universeHasForked'),
			universeId: read.bigint('universeId'),
			vaultCount: read.bigint('vaultCount'),
			vaults: [],
			...(feeAccrualState === undefined ? {} : { feeAccrualState }),
			...(minimumSecurityBondDebtAttoEth === undefined ? {} : { minimumSecurityBondDebtAttoEth }),
			...(minimumVaultRepDepositAttoRep === undefined ? {} : { minimumVaultRepDepositAttoRep }),
		}
	})
}

export const securityPoolDownloadStore = createDownloadedEntityStore(decodeCachedSecurityPool, 150)

function getPoolLifecycleState(pool: ListedSecurityPool) {
	return evaluateSecurityPoolState({
		lifecycleState: deriveSecurityPoolLifecycleState({
			hasForkActivity: pool.hasForkActivity,
			isChildPool: pool.parent !== zeroAddress,
			questionOutcome: pool.questionOutcome,
			systemState: pool.systemState,
			universeHasForked: pool.universeHasForked,
		}),
		universeHasForked: pool.universeHasForked,
	}).lifecycleState
}

export function derivePoolBrowseRows(entries: readonly LocalBrowseEntry<ListedSecurityPool>[], { currentTimestamp, repPerEthPrice, uiPriceOracle }: { currentTimestamp: bigint | undefined; repPerEthPrice: bigint | undefined; uiPriceOracle: UiPriceOracle }): PoolBrowseRow[] {
	return entries.map(({ data: pool, fetchedAt }) => {
		const calculationPrice = resolveUiRepPerEthPrice({ currentTimestamp, openOraclePrice: pool.lastOraclePrice, openOracleSettlementTimestamp: pool.lastOracleSettlementTimestamp, priceOracle: uiPriceOracle, uniswapPrice: repPerEthPrice })
		const capacity = calculateMintingCapacityAttoEth(pool.totalCapacityOwnershipAttoRep, calculationPrice, pool.statoblastSecurityMultiplierBps)
		return { capacity, fetchedAt, lifecycleState: getPoolLifecycleState(pool), pool, remainingCapacity: getRemainingMintCapacity(capacity, pool.settlementCollateralAttoEth, pool.shareTokenSupplyAttoShares) }
	})
}

function poolMatchesSearch(pool: ListedSecurityPool, normalizedSearchText: string) {
	return matchesLocalSearch(normalizedSearchText, [pool.securityPoolAddress, pool.questionId, pool.marketDetails.title, pool.marketDetails.description])
}

/** Universe, state, and text filters run over every downloaded pool before anything is displayed. */
export function filterPoolBrowseRows(rows: readonly PoolBrowseRow[], { activeUniverseId, normalizedSearchText, stateFilter }: { activeUniverseId: bigint; normalizedSearchText: string; stateFilter: PoolStateFilter }) {
	return rows.filter(row => row.pool.universeId === activeUniverseId && (stateFilter === 'all' || row.lifecycleState === stateFilter) && poolMatchesSearch(row.pool, normalizedSearchText))
}

function compareBigintDescending(left: bigint | undefined, right: bigint | undefined) {
	if (left === right) return 0
	if (left === undefined) return 1
	if (right === undefined) return -1
	return left > right ? -1 : 1
}

function getLifecycleSortRank(state: SecurityPoolLifecycleState | undefined) {
	const rank = state === undefined ? -1 : LIFECYCLE_SORT_ORDER.indexOf(state)
	return rank === -1 ? LIFECYCLE_SORT_ORDER.length : rank
}

function compareEndTime(left: PoolBrowseRow, right: PoolBrowseRow, currentTimestamp: bigint | undefined) {
	const leftEnd = left.pool.marketDetails.endTime
	const rightEnd = right.pool.marketDetails.endTime
	const leftEnded = currentTimestamp !== undefined && leftEnd <= currentTimestamp
	const rightEnded = currentTimestamp !== undefined && rightEnd <= currentTimestamp
	if (leftEnded !== rightEnded) return leftEnded ? 1 : -1
	// Open pools end soonest first; ended pools list the most recently ended first.
	return leftEnded ? compareBigintDescending(leftEnd, rightEnd) : compareBigintDescending(rightEnd, leftEnd)
}

/** Stable sorts: remaining capacity largest first (unknown last), open pools ending soonest first, state by lifecycle order. Recent keeps the collection order (newest favorite or fetch first), which also breaks ties. */
export function sortPoolBrowseRows(rows: readonly PoolBrowseRow[], sortKey: PoolSortKey, currentTimestamp: bigint | undefined) {
	const recent = [...rows]
	if (sortKey === 'recent') return recent
	if (sortKey === 'remainingCapacity') return recent.sort((left, right) => compareBigintDescending(left.remainingCapacity, right.remainingCapacity))
	if (sortKey === 'endTime') return recent.sort((left, right) => compareEndTime(left, right, currentTimestamp))
	return recent.sort((left, right) => getLifecycleSortRank(left.lifecycleState) - getLifecycleSortRank(right.lifecycleState))
}
