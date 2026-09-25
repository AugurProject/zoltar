import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ListedSecurityPool, TradingShareBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import type { PortfolioPoolSnapshot } from '../../../protocol/portfolio.js'
import { derivePoolActionItems, type PoolAccountVault, type PoolActionId, type PoolActionItem } from '../../security-pools/lib/poolActions.js'
import { deriveListedPoolLifecycleStep, type PoolLifecycleStep } from '../../security-pools/lib/poolLifecycle.js'
import { deriveVaultAdmissionClosed, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../../security-pools/lib/securityPoolState.js'
import { AUCTION_TIME_SECONDS } from '../../truth-auctions/lib/forkAuction.js'

/** A pool where the account holds a vault, an escalation stake, or shares. */
export type PortfolioHolding = {
	actions: PoolActionItem[]
	lifecycleState: SecurityPoolLifecycleState | undefined
	pool: ListedSecurityPool
	shareBalances: TradingShareBalances | undefined
	step: PoolLifecycleStep | undefined
	vault: PoolAccountVault | undefined
}

type PortfolioActionEntry = {
	holding: PortfolioHolding
	item: PoolActionItem
}

/** Entries that ask the account to act on a position it holds; stage suggestions such as depositing or minting stay on the pool page. */
const PORTFOLIO_ACTION_IDS: ReadonlySet<PoolActionId> = new Set(['bidTruthAuction', 'claimFees', 'claimForkSettlement', 'migrateVault', 'redeemShares', 'reportOrEscalate', 'reviewForkMigration', 'submitFirstReport', 'withdrawEscalation', 'withdrawVaultRep'])

function toAccountVault(pool: ListedSecurityPool, accountAddress: Address): PoolAccountVault | undefined {
	const vault = pool.vaults.find(candidate => sameAddress(candidate.vaultAddress, accountAddress))
	if (vault === undefined) return undefined
	if (vault.capacityOwnershipAttoRep === 0n && vault.vaultAttoRepBacking === 0n && vault.claimableFeesAttoEth === 0n && vault.disputeStakedAttoRep === 0n) return undefined
	return { claimableFeesAttoEth: vault.claimableFeesAttoEth, disputeStakedAttoRep: vault.disputeStakedAttoRep, repAttoRep: vault.vaultAttoRepBacking }
}

function nonZeroShares(shareBalances: TradingShareBalances | undefined) {
	if (shareBalances === undefined) return undefined
	return shareBalances.yesAttoShares > 0n || shareBalances.noAttoShares > 0n || shareBalances.invalidAttoShares > 0n ? shareBalances : undefined
}

function compareEntries(left: PortfolioActionEntry, right: PortfolioActionEntry) {
	const leftDeadline = left.item.deadline
	const rightDeadline = right.item.deadline
	if (leftDeadline !== undefined && rightDeadline !== undefined && leftDeadline !== rightDeadline) return leftDeadline < rightDeadline ? -1 : 1
	if (leftDeadline !== rightDeadline) return leftDeadline === undefined ? 1 : -1
	return 0
}

function toHolding(snapshot: PortfolioPoolSnapshot, accountAddress: Address, now: bigint | undefined): PortfolioHolding | undefined {
	const { pool } = snapshot
	const vault = toAccountVault(pool, accountAddress)
	const shareBalances = nonZeroShares(snapshot.shareBalances)
	if (vault === undefined && shareBalances === undefined) return undefined
	const { lifecycleState, step } = deriveListedPoolLifecycleStep(pool, now)
	const poolState = evaluateSecurityPoolState({ lifecycleState, universeHasForked: pool.universeHasForked, vaultAdmissionClosed: deriveVaultAdmissionClosed({ currentTimestamp: now, hasForkContinuationEscalationGame: pool.hasForkContinuationEscalationGame, questionEndTime: pool.marketDetails.endTime }) })
	const actions = derivePoolActionItems({
		accountConnected: true,
		auctionEndsAt: pool.truthAuctionStartedAt > 0n ? pool.truthAuctionStartedAt + AUCTION_TIME_SECONDS : undefined,
		hasForkActivity: pool.hasForkActivity,
		migrationEndsAt: snapshot.migrationEndsAt,
		now,
		poolState,
		shareBalances,
		step,
		vault,
	}).filter(item => PORTFOLIO_ACTION_IDS.has(item.id))
	return { actions, lifecycleState, pool, shareBalances, step, vault }
}

/**
 * Builds the connected account's portfolio from every loaded pool: the pools it holds positions in and one list of the
 * actions they need, soonest deadline first.
 */
export function derivePortfolioViewModel({ accountAddress, now, snapshots }: { accountAddress: Address; now: bigint | undefined; snapshots: readonly PortfolioPoolSnapshot[] }) {
	const holdings = snapshots.flatMap(snapshot => {
		const holding = toHolding(snapshot, accountAddress, now)
		return holding === undefined ? [] : [holding]
	})
	const actionEntries = holdings.flatMap(holding => holding.actions.map(item => ({ holding, item }))).sort(compareEntries)
	return { actionEntries, holdings }
}
