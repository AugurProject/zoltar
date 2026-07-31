import type { Address } from '@zoltar/bot-shared/ethereum'
import type { CandidatePriority, StrategySettings } from '#config/settings'

export const PRICE_PRECISION = 10n ** 18n
export const BPS_DENOMINATOR = 10_000n
export const LIQUIDATION_REP_BONUS_BPS = 500n
export const MIN_REP_DEPOSIT = 10n * PRICE_PRECISION
export const MIN_SECURITY_BOND_DEBT = PRICE_PRECISION

export type VaultPosition = {
	address: Address
	allowance: bigint
	ownership: bigint
	rep: bigint
	unpaidEthFees: bigint
}

export type PoolRiskContext = {
	address: Address
	denominator: bigint
	manager: Address
	minLiquidationPriceDistanceBps: bigint
	multiplierBps: bigint
	price: bigint
	totalRep: bigint
}

export type LiquidationCandidate = {
	bonusValueEth: bigint
	debtToMove: bigint
	pool: PoolRiskContext
	priceDistanceBps: bigint
	repToMove: bigint
	resultingHealthBps: bigint
	target: VaultPosition
	topUpRep: bigint
}

function ceilDiv(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new Error('Division denominator must be positive')
	if (numerator === 0n) return 0n
	return (numerator - 1n) / denominator + 1n
}

export function repForOwnership(ownership: bigint, totalRep: bigint, denominator: bigint) {
	if (ownership === 0n || denominator === 0n) return 0n
	return (ownership * totalRep) / denominator
}

export function ownershipForRep(rep: bigint, totalRep: bigint, denominator: bigint) {
	if (denominator === 0n || totalRep === 0n) return rep * PRICE_PRECISION
	return (rep * denominator) / totalRep
}

export function requiredRepForAllowance(allowance: bigint, multiplierBps: bigint, price: bigint, healthBps = BPS_DENOMINATOR) {
	if (allowance === 0n) return 0n
	return ceilDiv(allowance * multiplierBps * price * healthBps, PRICE_PRECISION * BPS_DENOMINATOR * BPS_DENOMINATOR)
}

export function vaultHealthBps(rep: bigint, allowance: bigint, multiplierBps: bigint, price: bigint) {
	if (allowance === 0n) return undefined
	const requiredNumerator = allowance * multiplierBps * price
	if (requiredNumerator === 0n) return undefined
	return (rep * PRICE_PRECISION * BPS_DENOMINATOR * BPS_DENOMINATOR) / requiredNumerator
}

export function liquidationPriceDistanceBps(targetRep: bigint, allowance: bigint, multiplierBps: bigint, price: bigint) {
	if (allowance === 0n || price === 0n) return 0n
	const thresholdPrice = (targetRep * PRICE_PRECISION * BPS_DENOMINATOR) / (allowance * multiplierBps)
	if (price <= thresholdPrice) return 0n
	return ((price - thresholdPrice) * BPS_DENOMINATOR) / price
}

export function isUnsafeVault(rep: bigint, allowance: bigint, multiplierBps: bigint, price: bigint) {
	return allowance > 0n && rep * PRICE_PRECISION * BPS_DENOMINATOR < allowance * multiplierBps * price
}

export function calculateLiquidationTransfer(parameters: { currentDenominator: bigint; currentTargetOwnership: bigint; currentTotalRep: bigint; price: bigint; requestedDebt: bigint; snapshotDenominator: bigint; snapshotTargetAllowance: bigint; snapshotTargetOwnership: bigint; snapshotTotalRep: bigint }) {
	const snapshotTargetRep = parameters.snapshotDenominator === 0n ? parameters.snapshotTargetOwnership / PRICE_PRECISION : (parameters.snapshotTargetOwnership * parameters.snapshotTotalRep) / parameters.snapshotDenominator
	let maximumDebtToMove = 0n
	if (snapshotTargetRep > MIN_REP_DEPOSIT) {
		maximumDebtToMove = ((snapshotTargetRep - MIN_REP_DEPOSIT) * PRICE_PRECISION * BPS_DENOMINATOR) / (parameters.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS))
		if (maximumDebtToMove > parameters.snapshotTargetAllowance) maximumDebtToMove = parameters.snapshotTargetAllowance
	}
	if (maximumDebtToMove < parameters.snapshotTargetAllowance && parameters.snapshotTargetAllowance - maximumDebtToMove <= MIN_SECURITY_BOND_DEBT) {
		maximumDebtToMove = parameters.snapshotTargetAllowance > MIN_SECURITY_BOND_DEBT ? parameters.snapshotTargetAllowance - MIN_SECURITY_BOND_DEBT : parameters.snapshotTargetAllowance
	}
	const debtToMove = parameters.requestedDebt > maximumDebtToMove ? maximumDebtToMove : parameters.requestedDebt
	if (debtToMove === 0n) return { debtToMove: 0n, ownershipToMove: 0n, repToMove: 0n }
	const repToMoveNumerator = debtToMove * parameters.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS)
	const repToMoveDenominator = PRICE_PRECISION * BPS_DENOMINATOR
	let repToMove = ceilDiv(repToMoveNumerator, repToMoveDenominator)
	let ownershipToMove = ownershipForRep(repToMove, parameters.currentTotalRep, parameters.currentDenominator)
	if (debtToMove === parameters.snapshotTargetAllowance) {
		const remainingRep = parameters.currentDenominator === 0n || ownershipToMove >= parameters.currentTargetOwnership ? 0n : repForOwnership(parameters.currentTargetOwnership - ownershipToMove, parameters.currentTotalRep, parameters.currentDenominator)
		if (ownershipToMove >= parameters.currentTargetOwnership || remainingRep < MIN_REP_DEPOSIT) {
			repToMove = parameters.currentDenominator === 0n ? 0n : repForOwnership(parameters.currentTargetOwnership, parameters.currentTotalRep, parameters.currentDenominator)
			ownershipToMove = parameters.currentTargetOwnership
		}
	}
	return { debtToMove, ownershipToMove, repToMove }
}

export function conservativeLiquidationRep(candidate: Pick<LiquidationCandidate, 'debtToMove' | 'target'>, price: bigint) {
	const nominalRep = ceilDiv(candidate.debtToMove * price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR)
	return candidate.debtToMove === candidate.target.allowance && candidate.target.rep > nominalRep ? candidate.target.rep : nominalRep
}

export function evaluateCandidate(pool: PoolRiskContext, target: VaultPosition, caller: VaultPosition, strategy: StrategySettings): LiquidationCandidate | undefined {
	if (pool.price === 0n || !isUnsafeVault(target.rep, target.allowance, pool.multiplierBps, pool.price)) return undefined
	const priceDistanceBps = liquidationPriceDistanceBps(target.rep, target.allowance, pool.multiplierBps, pool.price)
	if (priceDistanceBps < pool.minLiquidationPriceDistanceBps) return undefined
	const transfer = calculateLiquidationTransfer({
		currentDenominator: pool.denominator,
		currentTargetOwnership: target.ownership,
		currentTotalRep: pool.totalRep,
		price: pool.price,
		requestedDebt: strategy.maximumLiquidationDebtEth,
		snapshotDenominator: pool.denominator,
		snapshotTargetAllowance: target.allowance,
		snapshotTargetOwnership: target.ownership,
		snapshotTotalRep: pool.totalRep,
	})
	if (transfer.debtToMove < strategy.minimumLiquidationDebtEth) return undefined
	if (!isUnsafeVault(transfer.repToMove, transfer.debtToMove, pool.multiplierBps, pool.price)) {
		return undefined
	}
	const resultingAllowance = caller.allowance + transfer.debtToMove
	const healthRequiredRep = requiredRepForAllowance(resultingAllowance, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps)
	const requiredResultingRep = healthRequiredRep > MIN_REP_DEPOSIT ? healthRequiredRep : MIN_REP_DEPOSIT
	const resultingRepBeforeTopUp = caller.rep + transfer.repToMove
	const topUpRep = requiredResultingRep > resultingRepBeforeTopUp ? requiredResultingRep - resultingRepBeforeTopUp : 0n
	if (resultingRepBeforeTopUp + topUpRep > strategy.maximumRepPerPool) return undefined
	const seizedValueEth = (transfer.repToMove * PRICE_PRECISION) / pool.price
	const bonusValueEth = seizedValueEth > transfer.debtToMove ? seizedValueEth - transfer.debtToMove : 0n
	if (bonusValueEth < strategy.minimumRewardValueEth) return undefined
	const resultingHealthBps = vaultHealthBps(resultingRepBeforeTopUp + topUpRep, resultingAllowance, pool.multiplierBps, pool.price) ?? strategy.vaultTargetHealthBps
	return {
		bonusValueEth,
		debtToMove: transfer.debtToMove,
		pool,
		priceDistanceBps,
		repToMove: transfer.repToMove,
		resultingHealthBps,
		target,
		topUpRep,
	}
}

export function sortCandidates(candidates: readonly LiquidationCandidate[], priority: CandidatePriority) {
	return [...candidates].sort((left, right) => {
		const leftValue = priority === 'largest-debt' ? left.debtToMove : priority === 'lowest-top-up' ? -left.topUpRep : left.bonusValueEth
		const rightValue = priority === 'largest-debt' ? right.debtToMove : priority === 'lowest-top-up' ? -right.topUpRep : right.bonusValueEth
		if (leftValue === rightValue) return left.target.address.localeCompare(right.target.address)
		return leftValue > rightValue ? -1 : 1
	})
}

export function surplusRepForWithdrawal(caller: VaultPosition, pool: Pick<PoolRiskContext, 'multiplierBps' | 'price'>, strategy: Pick<StrategySettings, 'minimumRepWithdrawal' | 'vaultTargetHealthBps' | 'vaultWithdrawHealthBps'>) {
	if (caller.rep === 0n) return 0n
	const retainedRep = requiredRepForAllowance(caller.allowance, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps)
	if (caller.allowance > 0n) {
		const health = vaultHealthBps(caller.rep, caller.allowance, pool.multiplierBps, pool.price)
		if (health === undefined || health < strategy.vaultWithdrawHealthBps) return 0n
	}
	const surplus = caller.rep > retainedRep ? caller.rep - retainedRep : 0n
	return surplus >= strategy.minimumRepWithdrawal ? surplus : 0n
}
