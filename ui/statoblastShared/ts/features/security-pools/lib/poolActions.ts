import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { TradingShareBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import type { PoolLifecycleStep } from './poolLifecycle.js'
import type { SecurityPoolStateModel } from './securityPoolState.js'
import type { SecurityPoolReportingStage } from './securityPoolState/types.js'
import type { SelectedPoolView } from './securityPoolWorkflow.js'

export type PoolActionId =
	| 'connectWallet'
	| 'reviewStagedOperations'
	| 'depositRep'
	| 'manageVault'
	| 'mintShares'
	| 'submitFirstReport'
	| 'reportOrEscalate'
	| 'escalationStake'
	| 'withdrawEscalation'
	| 'triggerFork'
	| 'migrateVault'
	| 'reviewForkMigration'
	| 'bidTruthAuction'
	| 'claimForkSettlement'
	| 'redeemShares'
	| 'withdrawVaultRep'
	| 'claimFees'

type PoolActionTone = 'attention' | 'action' | 'info'

/** One thing the user can do on a pool now, with the tab that holds it and the deadline that bounds it. */
export type PoolActionItem = {
	amount?: { unit: 'ETH' | 'REP'; value: bigint }
	count?: bigint
	deadline?: bigint
	id: PoolActionId
	tab?: SelectedPoolView
	tone: PoolActionTone
}

/** The connected account's position in the pool; `undefined` when the account has no vault there. */
export type PoolAccountVault = {
	claimableFeesAttoEth: bigint
	disputeStakedAttoRep: bigint
	repAttoRep: bigint
}

export type PoolActionInput = {
	accountConnected: boolean
	auctionEndsAt?: bigint | undefined
	escalationEndsAt?: bigint | undefined
	/** The loaded fork details report that auction proceeds or settlements can be claimed now. */
	forkClaimAvailable?: boolean
	forkTriggerAvailable?: boolean
	hasForkActivity: boolean
	migrationEndsAt?: bigint | undefined
	now: bigint | undefined
	poolState: SecurityPoolStateModel | undefined
	reportingStage?: SecurityPoolReportingStage | undefined
	shareBalances: TradingShareBalances | undefined
	stagedOperationCount?: bigint
	step: PoolLifecycleStep | undefined
	vault: PoolAccountVault | undefined
}

const TONE_ORDER: Record<PoolActionTone, number> = { attention: 0, action: 1, info: 2 }

function isEnabled(poolState: SecurityPoolStateModel | undefined, action: keyof SecurityPoolStateModel['actions']) {
	return poolState?.actions[action].enabled === true
}

function hasShares(shareBalances: TradingShareBalances | undefined) {
	return shareBalances !== undefined && (shareBalances.yesAttoShares > 0n || shareBalances.noAttoShares > 0n || shareBalances.invalidAttoShares > 0n)
}

function futureDeadline(deadline: bigint | undefined, now: bigint | undefined) {
	if (deadline === undefined || deadline === 0n) return undefined
	if (now !== undefined && deadline <= now) return undefined
	return deadline
}

function withDeadline(item: PoolActionItem, deadline: bigint | undefined, now: bigint | undefined): PoolActionItem {
	const bounded = futureDeadline(deadline, now)
	return bounded === undefined ? item : { ...item, deadline: bounded }
}

function getOperationalItems(input: PoolActionInput): PoolActionItem[] {
	const items: PoolActionItem[] = []
	if (input.accountConnected && isEnabled(input.poolState, 'depositRepToVault')) items.push({ id: input.vault === undefined ? 'depositRep' : 'manageVault', tab: 'vaults', tone: 'action' })
	if (input.accountConnected && isEnabled(input.poolState, 'createCompleteSet')) items.push({ id: 'mintShares', tab: 'trading', tone: 'action' })
	return items
}

function getEscalationItems(input: PoolActionInput): PoolActionItem[] {
	const items: PoolActionItem[] = []
	if (input.reportingStage === 'notStarted') items.push({ id: 'submitFirstReport', tab: 'reporting', tone: 'action' })
	else if (input.reportingStage === 'timedOut') items.push({ id: 'reportOrEscalate', tab: 'reporting', tone: 'action' })
	else items.push(withDeadline({ id: 'reportOrEscalate', tab: 'reporting', tone: 'action' }, input.escalationEndsAt, input.now))
	const stake = input.vault?.disputeStakedAttoRep ?? 0n
	if (stake > 0n) {
		const withdrawable = input.reportingStage === 'activeWithdrawable'
		items.push({ amount: { unit: 'REP', value: stake }, id: withdrawable ? 'withdrawEscalation' : 'escalationStake', tab: 'reporting', tone: withdrawable ? 'action' : 'info' })
	}
	return items
}

function getForkMigrationItems(input: PoolActionInput): PoolActionItem[] {
	if (input.forkTriggerAvailable === true) return [{ id: 'triggerFork', tab: 'reporting', tone: 'action' }]
	if (input.vault !== undefined && input.vault.repAttoRep > 0n) return [withDeadline({ amount: { unit: 'REP', value: input.vault.repAttoRep }, id: 'migrateVault', tab: 'fork-workflow', tone: 'action' }, input.migrationEndsAt, input.now)]
	return [withDeadline({ id: 'reviewForkMigration', tab: 'fork-workflow', tone: 'action' }, input.migrationEndsAt, input.now)]
}

function getSettledItems(input: PoolActionInput): PoolActionItem[] {
	const items: PoolActionItem[] = []
	if (hasShares(input.shareBalances) && isEnabled(input.poolState, 'redeemShares')) items.push({ id: 'redeemShares', tab: 'trading', tone: 'action' })
	if (input.vault !== undefined && input.vault.repAttoRep > 0n && isEnabled(input.poolState, 'redeemRepFromVault')) items.push({ amount: { unit: 'REP', value: input.vault.repAttoRep }, id: 'withdrawVaultRep', tab: 'vaults', tone: 'action' })
	const stake = input.vault?.disputeStakedAttoRep ?? 0n
	if (stake > 0n) items.push({ amount: { unit: 'REP', value: stake }, id: 'withdrawEscalation', tab: 'reporting', tone: 'action' })
	if (input.accountConnected && input.hasForkActivity && input.forkClaimAvailable === true) items.push({ id: 'claimForkSettlement', tab: 'fork-workflow', tone: 'action' })
	return items
}

function getStageItems(input: PoolActionInput): PoolActionItem[] {
	switch (input.step) {
		case undefined:
			return []
		case 'operational':
			return getOperationalItems(input)
		case 'escalation':
			return getEscalationItems(input)
		case 'forkMigration':
			return getForkMigrationItems(input)
		case 'truthAuction':
			return [withDeadline({ id: 'bidTruthAuction', tab: 'fork-workflow', tone: 'action' }, input.auctionEndsAt, input.now)]
		case 'settled':
			return getSettledItems(input)
		default:
			return assertNever(input.step)
	}
}

function getAttentionItems(input: PoolActionInput): PoolActionItem[] {
	const items: PoolActionItem[] = []
	if (input.stagedOperationCount !== undefined && input.stagedOperationCount > 0n) items.push({ count: input.stagedOperationCount, id: 'reviewStagedOperations', tab: 'staged-operations', tone: 'attention' })
	return items
}

function compareActionItems(left: PoolActionItem, right: PoolActionItem) {
	const toneOrder = TONE_ORDER[left.tone] - TONE_ORDER[right.tone]
	if (toneOrder !== 0) return toneOrder
	if (left.deadline === undefined && right.deadline === undefined) return 0
	if (left.deadline === undefined) return 1
	if (right.deadline === undefined) return -1
	if (left.deadline === right.deadline) return 0
	return left.deadline < right.deadline ? -1 : 1
}

/**
 * Lists what the user can do on one pool right now: warnings that block other work first, then stage actions ordered by
 * their deadline, then informational milestones. Account-specific entries (fees, stake, vault, shares) need a connected wallet.
 */
export function derivePoolActionItems(input: PoolActionInput): PoolActionItem[] {
	const accountItems: PoolActionItem[] = []
	const fees = input.vault?.claimableFeesAttoEth ?? 0n
	if (fees > 0n && isEnabled(input.poolState, 'redeemFees')) accountItems.push({ amount: { unit: 'ETH', value: fees }, id: 'claimFees', tab: 'vaults', tone: 'action' })
	const items = [...getAttentionItems(input), ...getStageItems(input), ...accountItems]
	if (!input.accountConnected) items.push({ id: 'connectWallet', tone: 'info' })
	return items.sort(compareActionItems)
}
