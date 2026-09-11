import type { EcosystemSnapshot, EvaluatedOperation, OperationPlan } from '../operations/types.ts'
import type { DurableRetirementState } from '../state/retirement.ts'

type RetirementOperationDisposition = 'claim-linked-migration' | 'prohibited' | 'recovery' | 'unmatched-exit'

const RECOVERY_OPERATIONS = [
	'open-oracle.push-or-credit',
	'open-oracle.settle',
	'open-oracle.weth.unwrap',
	'open-oracle.withdraw',
	'open-oracle.withdraw-to',
	'statoblast.auction.finalize-route',
	'statoblast.auction.refund',
	'statoblast.auction.settle-bids',
	'statoblast.auction.start',
	'statoblast.auction.withdraw-refund',
	'statoblast.complete-set.redeem',
	'statoblast.escalation.claim-forked',
	'statoblast.escalation.resume',
	'statoblast.escalation.sweep-residual',
	'statoblast.escalation.withdraw',
	'statoblast.escalation.withdraw-forked',
	'statoblast.oracle.recover-report',
	'statoblast.pool.checkpoint-collateral',
	'statoblast.pool.checkpoint-retention',
	'statoblast.shares.redeem-winning',
	'statoblast.staged.execute',
	'statoblast.staged.execute-liquidation-excluded',
	'statoblast.staged.expire',
	'statoblast.vault.redeem-fees',
	'statoblast.vault.redeem-rep',
	'trading.complete-set.redeem',
	'trading.liquidity.remove',
] as const

const CLAIM_LINKED_MIGRATIONS = new Set(['statoblast.fork.create-child', 'statoblast.fork.migrate-rep', 'statoblast.fork.migrate-vault', 'statoblast.fork.migrate-vault-unresolved', 'trading.shares.migrate'])

const PROHIBITED_OPERATIONS = [
	'open-oracle.approve-internal',
	'open-oracle.deposit',
	'open-oracle.dispute',
	'open-oracle.dust',
	'open-oracle.report',
	'open-oracle.weth.wrap',
	'statoblast.auction.bid',
	'statoblast.complete-set.create',
	'statoblast.escalation.deposit',
	'statoblast.escalation.deposit-wallet-rep',
	'statoblast.fork.initiate',
	'statoblast.fork.own-question',
	'statoblast.liquidation.queue',
	'statoblast.oracle.request-price',
	'statoblast.pool.deploy',
	'statoblast.staged.queue',
	'statoblast.vault.deposit-rep',
	'statoblast.vault.update-fees',
	'token.rep.approve',
	'token.shares.approve',
	'token.weth.approve',
	'trading.genesis-uniswap.create-pool',
	'trading.genesis-uniswap.deploy-seeder',
	'trading.genesis-uniswap.initialize-pool',
	'trading.genesis-uniswap.seed-pool',
	'trading.liquidity.add-eth',
	'trading.liquidity.add-shares',
	'trading.lp.approve',
	'trading.pair.create',
	'trading.pair.create-and-initialize',
	'trading.pair.initialize-eth',
	'trading.pair.initialize-shares',
	'trading.pair.sync',
	'trading.position.enter',
	'trading.root.deploy-factory',
	'trading.root.deploy-router',
	'trading.swap.exact-input',
	'trading.swap.exact-output',
	'trading.universe-uniswap.create-pool',
	'trading.universe-uniswap.initialize-pool',
	'trading.universe-uniswap.seed-pool',
	'zoltar.child.deploy',
	'zoltar.migration.add',
	'zoltar.migration.split',
	'zoltar.question.create-binary',
	'zoltar.question.create-categorical',
	'zoltar.question.create-scalar',
	'zoltar.rep.burn',
	'zoltar.universe.fork',
] as const

const dispositions = new Map<string, RetirementOperationDisposition>([
	...RECOVERY_OPERATIONS.map(id => [id, 'recovery'] as const),
	...[...CLAIM_LINKED_MIGRATIONS].map(id => [id, 'claim-linked-migration'] as const),
	...PROHIBITED_OPERATIONS.map(id => [id, 'prohibited'] as const),
	['trading.position.exit', 'unmatched-exit'],
])

function operationAllowedDuringRetirement(operationId: string, policies: Pick<DurableRetirementState['policies'], 'exitUnmatchedShares' | 'maximumExitLossBps' | 'migrateExistingClaims'>) {
	const disposition = dispositions.get(operationId)
	if (disposition === 'recovery') return true
	if (disposition === 'claim-linked-migration') return policies.migrateExistingClaims
	if (disposition === 'unmatched-exit') return policies.exitUnmatchedShares
	return false
}

const RETIREMENT_OPERATION_ORDER = [
	'open-oracle.withdraw',
	'open-oracle.withdraw-to',
	'open-oracle.push-or-credit',
	'open-oracle.settle',
	'statoblast.oracle.recover-report',
	'statoblast.escalation.resume',
	'statoblast.escalation.withdraw',
	'statoblast.escalation.withdraw-forked',
	'statoblast.escalation.claim-forked',
	'statoblast.auction.withdraw-refund',
	'statoblast.auction.refund',
	'statoblast.auction.settle-bids',
	'statoblast.vault.redeem-fees',
	'statoblast.vault.redeem-rep',
	'statoblast.complete-set.redeem',
	'statoblast.shares.redeem-winning',
	'trading.liquidity.remove',
	'trading.complete-set.redeem',
	'trading.position.exit',
	'statoblast.staged.execute',
	'statoblast.staged.expire',
	'statoblast.auction.start',
	'statoblast.auction.finalize-route',
	'statoblast.escalation.sweep-residual',
] as const

function migrationPlanRecoversWalletClaim(plan: OperationPlan, snapshot: EcosystemSnapshot) {
	if (!CLAIM_LINKED_MIGRATIONS.has(plan.definitionId)) return true
	if (plan.definitionId === 'trading.shares.migrate') {
		const shareToken = plan.metadata['shareToken']
		return typeof shareToken === 'string' && snapshot.wallet.shares.some(shares => shares.shareToken.toLowerCase() === shareToken.toLowerCase() && [shares.invalid, shares.yes, shares.no].some(balance => BigInt(balance) > 0n))
	}
	const poolAddress = plan.metadata['pool']
	if (typeof poolAddress !== 'string') return false
	const pool = snapshot.pools.find(candidate => candidate.address.toLowerCase() === poolAddress.toLowerCase())
	if (pool === undefined) return false
	const vault = pool.vaults.find(candidate => candidate.address.toLowerCase() === snapshot.wallet.address.toLowerCase())
	const hasVaultClaim = vault !== undefined && [vault.repBackingUnits, vault.repBackingAttoRep, vault.capacityOwnershipAttoRep, vault.claimableFeesAttoEth, vault.disputeStakedAttoRep].some(value => BigInt(value) > 0n)
	const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
	return hasVaultClaim || (shares !== undefined && [shares.invalid, shares.yes, shares.no].some(value => BigInt(value) > 0n)) || pool.unresolvedEscalationMigrationReadyOutcomes.length > 0
}

export function retirementPlanAllowed(plan: OperationPlan, snapshot: EcosystemSnapshot, policies: DurableRetirementState['policies']) {
	return operationAllowedDuringRetirement(plan.definitionId, policies) && migrationPlanRecoversWalletClaim(plan, snapshot)
}

function exitPlanWithinLossLimit(plan: OperationPlan, maximumExitLossBps: number) {
	if (plan.definitionId !== 'trading.position.exit') return true
	const maximumLong = plan.metadata['maximumLong']
	const minimumEth = plan.metadata['minimumEthAttoEth']
	if (typeof maximumLong !== 'string' || typeof minimumEth !== 'string') return false
	const input = BigInt(maximumLong)
	const output = BigInt(minimumEth)
	return input > 0n && output * 10_000n >= input * BigInt(10_000 - maximumExitLossBps)
}

export function retirementPlanFromEvaluations(evaluations: readonly EvaluatedOperation[], policies: DurableRetirementState['policies'], snapshot?: EcosystemSnapshot) {
	const eligible = evaluations.flatMap(evaluation => {
		if (!evaluation.eligibility.eligible || evaluation.plan === undefined) return []
		if (!operationAllowedDuringRetirement(evaluation.plan.definitionId, policies) || !exitPlanWithinLossLimit(evaluation.plan, policies.maximumExitLossBps)) return []
		if (snapshot !== undefined && !migrationPlanRecoversWalletClaim(evaluation.plan, snapshot)) return []
		return [evaluation.plan]
	})
	return eligible.sort((left, right) => {
		const leftRank = RETIREMENT_OPERATION_ORDER.indexOf(left.definitionId as (typeof RETIREMENT_OPERATION_ORDER)[number])
		const rightRank = RETIREMENT_OPERATION_ORDER.indexOf(right.definitionId as (typeof RETIREMENT_OPERATION_ORDER)[number])
		const rank = (value: number) => (value === -1 ? RETIREMENT_OPERATION_ORDER.length : value)
		return rank(leftRank) - rank(rightRank) || left.id.localeCompare(right.id)
	})[0]
}
