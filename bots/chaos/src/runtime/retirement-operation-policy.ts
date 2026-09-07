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
	'trading.liquidity.remove-shares',
] as const

export const CLAIM_LINKED_MIGRATIONS = new Set(['statoblast.fork.create-child', 'statoblast.fork.migrate-rep', 'statoblast.fork.migrate-vault', 'statoblast.fork.migrate-vault-unresolved', 'trading.shares.migrate'])

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

export function unclassifiedRetirementOperations(operationIds: readonly string[]) {
	return operationIds.filter(id => !dispositions.has(id)).sort()
}

export function operationAllowedDuringRetirement(operationId: string, policies: Pick<DurableRetirementState['policies'], 'exitUnmatchedShares' | 'maximumExitLossBps' | 'migrateExistingClaims'>) {
	const disposition = dispositions.get(operationId)
	if (disposition === 'recovery') return true
	if (disposition === 'claim-linked-migration') return policies.migrateExistingClaims
	if (disposition === 'unmatched-exit') return policies.exitUnmatchedShares
	return false
}
