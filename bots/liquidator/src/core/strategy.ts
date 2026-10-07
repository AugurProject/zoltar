import type { CandidatePriority, StrategySettings } from '#config/settings'
import type { Address } from '@zoltar/bot-shared/ethereum'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { getLiquidationMigrationSecurityMultiplierBps, getLiquidationVaultRepBackingToTransfer } from '@zoltar/statoblast-shared/statoblast/liquidation'

export const PRICE_PRECISION = 10n ** 18n
export const BPS_DENOMINATOR = 10_000n

export function liquidationExecutionAllowed(coordinatorPrice: bigint, centralizedPriceAllowed: boolean) {
	return coordinatorPrice > 0n && centralizedPriceAllowed
}

export type VaultPosition = {
	address: Address
	backingUnits: bigint
	badDebtAttoEth: bigint
	underwritingLimitAttoEth: bigint
	claimableFeesAttoEth: bigint
	disputeStakedAttoRep: bigint
	openInterestAttoEth: bigint
	vaultAttoRepBacking: bigint
}

export type PoolRiskContext = {
	address: Address
	denominator: bigint
	feeEligibleUnderwritingLimitAttoEth: bigint
	manager: Address
	minimumSecurityBondDebtAttoEth: bigint
	minimumVaultRepDepositAttoRep: bigint
	minLiquidationPriceDistanceBps: bigint
	multiplierBps: bigint
	price: bigint
	settlementCollateralAttoEth: bigint
	totalAttoRep: bigint
	totalUnderwritingLimitAttoEth: bigint
}

export type LiquidationCandidate = {
	bonusValueAttoEth: bigint
	underwritingLimitToMoveAttoEth: bigint
	debtToMoveAttoEth: bigint
	pool: PoolRiskContext
	priceDistanceBps: bigint
	requestedDebtAttoEth: bigint
	resultingHealthBps: bigint
	target: VaultPosition
	topUpAttoRep: bigint
	vaultAttoRepBackingToTransfer: bigint
}

function mulDivUp(left: bigint, right: bigint, denominator: bigint) {
	return ceilDiv(left * right, denominator)
}

export function repForBackingUnits(backingUnits: bigint, totalAttoRep: bigint, denominator: bigint) {
	if (backingUnits === 0n || denominator === 0n) return 0n
	return (backingUnits * totalAttoRep) / denominator
}

/** Mirrors `SecurityPoolUtils.calculateLiquidationBackingUnitsAward`: an unpriced pool mints REP at the initial unit scale. */
function liquidationBackingUnitsAward(grossRepAwardAttoRep: bigint, totalAttoRep: bigint, denominator: bigint) {
	if (denominator === 0n || totalAttoRep === 0n) return grossRepAwardAttoRep * PRICE_PRECISION
	return mulDivUp(grossRepAwardAttoRep, denominator, totalAttoRep)
}

export function requiredRepForUnderwritingLimit(underwritingLimitAttoEth: bigint, multiplierBps: bigint, price: bigint, healthBps = BPS_DENOMINATOR, disputeStakedAttoRep = 0n) {
	if (underwritingLimitAttoEth === 0n) return 0n
	const baseRequiredAttoRep = mulDivUp(underwritingLimitAttoEth, price, PRICE_PRECISION)
	const totalAssociatedRequiredAttoRep = mulDivUp(mulDivUp(baseRequiredAttoRep, multiplierBps, BPS_DENOMINATOR), healthBps, BPS_DENOMINATOR)
	const associatedRequiredAttoRep = totalAssociatedRequiredAttoRep > disputeStakedAttoRep ? totalAssociatedRequiredAttoRep - disputeStakedAttoRep : 0n
	const freeRequiredAttoRep = mulDivUp(mulDivUp(baseRequiredAttoRep, getLiquidationMigrationSecurityMultiplierBps(multiplierBps), BPS_DENOMINATOR), healthBps, BPS_DENOMINATOR)
	return associatedRequiredAttoRep > freeRequiredAttoRep ? associatedRequiredAttoRep : freeRequiredAttoRep
}

export function vaultHealthBps(vaultAttoRepBacking: bigint, underwritingLimitAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	if (underwritingLimitAttoEth === 0n || price === 0n) return undefined
	const baseRequiredAttoRep = mulDivUp(underwritingLimitAttoEth, price, PRICE_PRECISION)
	const associatedAtProtocolMinimum = mulDivUp(baseRequiredAttoRep, multiplierBps, BPS_DENOMINATOR)
	const freeAtProtocolMinimum = mulDivUp(baseRequiredAttoRep, getLiquidationMigrationSecurityMultiplierBps(multiplierBps), BPS_DENOMINATOR)
	const associatedHealth = associatedAtProtocolMinimum === 0n ? BPS_DENOMINATOR : ((vaultAttoRepBacking + disputeStakedAttoRep) * BPS_DENOMINATOR) / associatedAtProtocolMinimum
	const freeHealth = freeAtProtocolMinimum === 0n ? BPS_DENOMINATOR : (vaultAttoRepBacking * BPS_DENOMINATOR) / freeAtProtocolMinimum
	return associatedHealth < freeHealth ? associatedHealth : freeHealth
}

function liquidationPriceDistanceBps(targetVaultRepBackingAttoRep: bigint, underwritingLimitAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	if (underwritingLimitAttoEth === 0n || price === 0n) return 0n
	const valueScale = PRICE_PRECISION * BPS_DENOMINATOR
	const associatedThreshold = ((targetVaultRepBackingAttoRep + disputeStakedAttoRep) * valueScale) / (underwritingLimitAttoEth * multiplierBps)
	const freeThreshold = (targetVaultRepBackingAttoRep * valueScale) / (underwritingLimitAttoEth * getLiquidationMigrationSecurityMultiplierBps(multiplierBps))
	const thresholdPrice = associatedThreshold < freeThreshold ? associatedThreshold : freeThreshold
	if (price <= thresholdPrice) return 0n
	return ((price - thresholdPrice) * BPS_DENOMINATOR) / price
}

function isUnsafeVault(vaultAttoRepBacking: bigint, underwritingLimitAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	const health = vaultHealthBps(vaultAttoRepBacking, underwritingLimitAttoEth, multiplierBps, price, disputeStakedAttoRep)
	return health !== undefined && health < BPS_DENOMINATOR
}

function calculateLiquidationTransfer(parameters: { currentPoolHeldAttoRepBalance: bigint; currentTargetBackingUnits: bigint; currentTotalRepBackingUnits: bigint; minimumRemainingAttoRep: bigint; price: bigint; requestedDebtAttoEth: bigint; snapshotTargetUnderwritingLimitAttoEth: bigint }) {
	const zero = { backingUnitsToTransfer: 0n, underwritingLimitToMoveAttoEth: 0n, debtToMoveAttoEth: 0n, vaultAttoRepBackingToTransfer: 0n }
	if (parameters.snapshotTargetUnderwritingLimitAttoEth === 0n || parameters.requestedDebtAttoEth === 0n || parameters.price === 0n) return zero
	const debtToMoveAttoEth = parameters.requestedDebtAttoEth < parameters.snapshotTargetUnderwritingLimitAttoEth ? parameters.requestedDebtAttoEth : parameters.snapshotTargetUnderwritingLimitAttoEth
	if (debtToMoveAttoEth === 0n) return zero
	// Mirrors `SecurityPoolUtils.calculateBundledLiquidationTransfer`: without a conversion rate the whole target position stays reserved.
	let reservedBackingUnits = 0n
	if (parameters.minimumRemainingAttoRep !== 0n && debtToMoveAttoEth < parameters.snapshotTargetUnderwritingLimitAttoEth) {
		const noConversion = parameters.currentPoolHeldAttoRepBalance === 0n || parameters.currentTotalRepBackingUnits === 0n
		reservedBackingUnits = noConversion ? parameters.currentTargetBackingUnits : mulDivUp(parameters.minimumRemainingAttoRep, parameters.currentTotalRepBackingUnits, parameters.currentPoolHeldAttoRepBalance)
	}
	const transferableBackingUnits = parameters.currentTargetBackingUnits > reservedBackingUnits ? parameters.currentTargetBackingUnits - reservedBackingUnits : 0n
	const underwritingLimitToMoveAttoEth = debtToMoveAttoEth
	const grossRepAwardAttoRep = getLiquidationVaultRepBackingToTransfer(debtToMoveAttoEth, parameters.price)
	const nominalBackingUnits = liquidationBackingUnitsAward(grossRepAwardAttoRep, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits)
	const backingUnitsToTransfer = nominalBackingUnits < transferableBackingUnits ? nominalBackingUnits : transferableBackingUnits
	const vaultAttoRepBackingToTransfer = repForBackingUnits(backingUnitsToTransfer, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits)
	return { backingUnitsToTransfer, underwritingLimitToMoveAttoEth, debtToMoveAttoEth, vaultAttoRepBackingToTransfer }
}

export function maximumLiquidationRep(candidate: { pool: Pick<PoolRiskContext, 'denominator' | 'totalAttoRep'>; target: Pick<VaultPosition, 'backingUnits'> }) {
	// The execution price can change before inclusion or while the operation awaits an oracle report.
	// Combining backing units can increase the receiver's rounded balance by more than the target's rounded balance.
	if (candidate.pool.denominator === 0n) return 0n
	return mulDivUp(candidate.target.backingUnits, candidate.pool.totalAttoRep, candidate.pool.denominator)
}

export function evaluateCandidate(pool: PoolRiskContext, target: VaultPosition, caller: VaultPosition, strategy: StrategySettings): LiquidationCandidate | undefined {
	if (target.badDebtAttoEth !== 0n || caller.badDebtAttoEth !== 0n) return undefined
	if (pool.price === 0n || !isUnsafeVault(target.vaultAttoRepBacking, target.underwritingLimitAttoEth, pool.multiplierBps, pool.price, target.disputeStakedAttoRep)) return undefined
	const priceDistanceBps = liquidationPriceDistanceBps(target.vaultAttoRepBacking, target.underwritingLimitAttoEth, pool.multiplierBps, pool.price, target.disputeStakedAttoRep)
	if (priceDistanceBps < pool.minLiquidationPriceDistanceBps) return undefined
	let requestedDebtAttoEth = strategy.maximumLiquidationDebtAttoEth < target.underwritingLimitAttoEth ? strategy.maximumLiquidationDebtAttoEth : target.underwritingLimitAttoEth
	const remainingLimitAttoEth = target.underwritingLimitAttoEth - requestedDebtAttoEth
	// A partial liquidation must leave the target's minimum commitment without exceeding the operator's maximum.
	if (remainingLimitAttoEth > 0n && remainingLimitAttoEth < pool.minimumSecurityBondDebtAttoEth) requestedDebtAttoEth = target.underwritingLimitAttoEth - pool.minimumSecurityBondDebtAttoEth
	if (requestedDebtAttoEth <= 0n || requestedDebtAttoEth < strategy.minimumLiquidationDebtAttoEth) return undefined
	const transfer = calculateLiquidationTransfer({
		currentPoolHeldAttoRepBalance: pool.totalAttoRep,
		currentTargetBackingUnits: target.backingUnits,
		currentTotalRepBackingUnits: pool.denominator,
		minimumRemainingAttoRep: requestedDebtAttoEth >= target.underwritingLimitAttoEth ? 0n : pool.minimumVaultRepDepositAttoRep,
		price: pool.price,
		requestedDebtAttoEth,
		snapshotTargetUnderwritingLimitAttoEth: target.underwritingLimitAttoEth,
	})
	const resultingUnderwritingLimitAttoEth = caller.underwritingLimitAttoEth + transfer.underwritingLimitToMoveAttoEth
	const debtToMoveAttoEth = transfer.debtToMoveAttoEth
	if (debtToMoveAttoEth < strategy.minimumLiquidationDebtAttoEth) return undefined
	if (resultingUnderwritingLimitAttoEth < pool.minimumSecurityBondDebtAttoEth) return undefined
	const vaultAttoRepBackingToTransfer = transfer.vaultAttoRepBackingToTransfer
	const healthRequiredAttoRep = requiredRepForUnderwritingLimit(resultingUnderwritingLimitAttoEth, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps, caller.disputeStakedAttoRep)
	const requiredResultingAttoRep = healthRequiredAttoRep > pool.minimumVaultRepDepositAttoRep ? healthRequiredAttoRep : pool.minimumVaultRepDepositAttoRep
	const resultingRepBeforeTopUpAttoRep = caller.vaultAttoRepBacking + vaultAttoRepBackingToTransfer
	const finalHealthTopUpAttoRep = requiredResultingAttoRep > resultingRepBeforeTopUpAttoRep ? requiredResultingAttoRep - resultingRepBeforeTopUpAttoRep : 0n
	const standaloneMinimumTopUpAttoRep = pool.minimumVaultRepDepositAttoRep > caller.vaultAttoRepBacking ? pool.minimumVaultRepDepositAttoRep - caller.vaultAttoRepBacking : 0n
	const topUpAttoRep = standaloneMinimumTopUpAttoRep > finalHealthTopUpAttoRep ? standaloneMinimumTopUpAttoRep : finalHealthTopUpAttoRep
	if (resultingRepBeforeTopUpAttoRep + topUpAttoRep > strategy.maximumAttoRepPerPool) return undefined
	const repBackingAwardValueAttoEth = (vaultAttoRepBackingToTransfer * PRICE_PRECISION) / pool.price
	const bonusValueAttoEth = repBackingAwardValueAttoEth > debtToMoveAttoEth ? repBackingAwardValueAttoEth - debtToMoveAttoEth : 0n
	if (bonusValueAttoEth < strategy.minimumRewardValueAttoEth) return undefined
	return {
		bonusValueAttoEth,
		underwritingLimitToMoveAttoEth: transfer.underwritingLimitToMoveAttoEth,
		debtToMoveAttoEth,
		pool,
		priceDistanceBps,
		requestedDebtAttoEth,
		resultingHealthBps: vaultHealthBps(resultingRepBeforeTopUpAttoRep + topUpAttoRep, resultingUnderwritingLimitAttoEth, pool.multiplierBps, pool.price, caller.disputeStakedAttoRep) ?? strategy.vaultTargetHealthBps,
		target,
		topUpAttoRep,
		vaultAttoRepBackingToTransfer,
	}
}

/** Operator-facing label for the coordinator call that executes or queues a liquidation. */
export function liquidationSubmissionLabel(priceValid: boolean, usesExistingPendingReport: boolean) {
	if (priceValid) return 'Execute security-pool liquidation'
	return usesExistingPendingReport ? 'Queue liquidation behind the existing price report' : 'Queue liquidation and request a fresh REP price'
}

export function sortCandidates(candidates: readonly LiquidationCandidate[], priority: CandidatePriority) {
	const priorityValue = (candidate: LiquidationCandidate) => {
		if (priority === 'largest-debt') return candidate.debtToMoveAttoEth
		return priority === 'lowest-top-up' ? -candidate.topUpAttoRep : candidate.bonusValueAttoEth
	}
	return [...candidates].sort((left, right) => {
		const leftValue = priorityValue(left)
		const rightValue = priorityValue(right)
		if (leftValue === rightValue) return left.target.address.localeCompare(right.target.address)
		return leftValue > rightValue ? -1 : 1
	})
}

export function selectAllowedCandidate(candidates: readonly LiquidationCandidate[], priority: CandidatePriority, allowed: (candidate: LiquidationCandidate) => boolean) {
	return sortCandidates(candidates, priority).find(allowed)
}

export function surplusRepForWithdrawal(caller: VaultPosition, pool: Pick<PoolRiskContext, 'minimumVaultRepDepositAttoRep' | 'multiplierBps' | 'price'>, strategy: Pick<StrategySettings, 'minimumRepWithdrawalAttoRep' | 'vaultTargetHealthBps' | 'vaultWithdrawHealthBps'>) {
	if (caller.vaultAttoRepBacking === 0n) return 0n
	const healthRequiredAttoRep = requiredRepForUnderwritingLimit(caller.underwritingLimitAttoEth, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps, caller.disputeStakedAttoRep)
	const retainedAttoRep = caller.underwritingLimitAttoEth > 0n && pool.minimumVaultRepDepositAttoRep > healthRequiredAttoRep ? pool.minimumVaultRepDepositAttoRep : healthRequiredAttoRep
	if (caller.underwritingLimitAttoEth > 0n) {
		const health = vaultHealthBps(caller.vaultAttoRepBacking, caller.underwritingLimitAttoEth, pool.multiplierBps, pool.price, caller.disputeStakedAttoRep)
		if (health === undefined || health < strategy.vaultWithdrawHealthBps) return 0n
	}
	const surplusAttoRep = caller.vaultAttoRepBacking > retainedAttoRep ? caller.vaultAttoRepBacking - retainedAttoRep : 0n
	return surplusAttoRep >= strategy.minimumRepWithdrawalAttoRep ? surplusAttoRep : 0n
}
