import type { CandidatePriority, StrategySettings } from '#config/settings'
import type { Address } from '@zoltar/bot-shared/ethereum'
import { ceilDiv as divideUp } from '@zoltar/core-shared/math/bigint'

export const PRICE_PRECISION = 10n ** 18n
export const BPS_DENOMINATOR = 10_000n
export const LIQUIDATION_REP_BONUS_BPS = 500n

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

function ceilDiv(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new Error('Division denominator must be positive')
	if (numerator === 0n) return 0n
	return divideUp(numerator, denominator)
}

function mulDivUp(left: bigint, right: bigint, denominator: bigint) {
	return ceilDiv(left * right, denominator)
}

function migrationMultiplierBps(multiplierBps: bigint) {
	const migrationMultiplier = BPS_DENOMINATOR + (multiplierBps - BPS_DENOMINATOR) / 2n
	return migrationMultiplier > BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS ? migrationMultiplier : BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS
}

export function repForBackingUnits(backingUnits: bigint, totalAttoRep: bigint, denominator: bigint) {
	if (backingUnits === 0n || denominator === 0n) return 0n
	return (backingUnits * totalAttoRep) / denominator
}

function backingUnitsForRep(vaultAttoRepBacking: bigint, totalAttoRep: bigint, denominator: bigint, roundUp = false) {
	if (denominator === 0n || totalAttoRep === 0n) return vaultAttoRepBacking * PRICE_PRECISION
	return roundUp ? mulDivUp(vaultAttoRepBacking, denominator, totalAttoRep) : (vaultAttoRepBacking * denominator) / totalAttoRep
}

export function requiredRepForOpenInterest(openInterestAttoEth: bigint, multiplierBps: bigint, price: bigint, healthBps = BPS_DENOMINATOR, disputeStakedAttoRep = 0n) {
	if (openInterestAttoEth === 0n) return 0n
	const baseRequiredAttoRep = mulDivUp(openInterestAttoEth, price, PRICE_PRECISION)
	const totalAssociatedRequiredAttoRep = mulDivUp(mulDivUp(baseRequiredAttoRep, multiplierBps, BPS_DENOMINATOR), healthBps, BPS_DENOMINATOR)
	const associatedRequiredAttoRep = totalAssociatedRequiredAttoRep > disputeStakedAttoRep ? totalAssociatedRequiredAttoRep - disputeStakedAttoRep : 0n
	const freeRequiredAttoRep = mulDivUp(mulDivUp(baseRequiredAttoRep, migrationMultiplierBps(multiplierBps), BPS_DENOMINATOR), healthBps, BPS_DENOMINATOR)
	return associatedRequiredAttoRep > freeRequiredAttoRep ? associatedRequiredAttoRep : freeRequiredAttoRep
}

export function vaultHealthBps(vaultAttoRepBacking: bigint, openInterestAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	if (openInterestAttoEth === 0n || price === 0n) return undefined
	const baseRequiredAttoRep = mulDivUp(openInterestAttoEth, price, PRICE_PRECISION)
	const associatedAtProtocolMinimum = mulDivUp(baseRequiredAttoRep, multiplierBps, BPS_DENOMINATOR)
	const freeAtProtocolMinimum = mulDivUp(baseRequiredAttoRep, migrationMultiplierBps(multiplierBps), BPS_DENOMINATOR)
	const associatedHealth = associatedAtProtocolMinimum === 0n ? BPS_DENOMINATOR : ((vaultAttoRepBacking + disputeStakedAttoRep) * BPS_DENOMINATOR) / associatedAtProtocolMinimum
	const freeHealth = freeAtProtocolMinimum === 0n ? BPS_DENOMINATOR : (vaultAttoRepBacking * BPS_DENOMINATOR) / freeAtProtocolMinimum
	return associatedHealth < freeHealth ? associatedHealth : freeHealth
}

function liquidationPriceDistanceBps(targetVaultRepBackingAttoRep: bigint, openInterestAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	if (openInterestAttoEth === 0n || price === 0n) return 0n
	const valueScale = PRICE_PRECISION * BPS_DENOMINATOR
	const associatedThreshold = ((targetVaultRepBackingAttoRep + disputeStakedAttoRep) * valueScale) / (openInterestAttoEth * multiplierBps)
	const freeThreshold = (targetVaultRepBackingAttoRep * valueScale) / (openInterestAttoEth * migrationMultiplierBps(multiplierBps))
	const thresholdPrice = associatedThreshold < freeThreshold ? associatedThreshold : freeThreshold
	if (price <= thresholdPrice) return 0n
	return ((price - thresholdPrice) * BPS_DENOMINATOR) / price
}

function isUnsafeVault(vaultAttoRepBacking: bigint, openInterestAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	const health = vaultHealthBps(vaultAttoRepBacking, openInterestAttoEth, multiplierBps, price, disputeStakedAttoRep)
	return health !== undefined && health < BPS_DENOMINATOR
}

function calculateLiquidationTransfer(parameters: { currentPoolHeldAttoRepBalance: bigint; currentTargetBackingUnits: bigint; currentTotalRepBackingUnits: bigint; minimumRemainingAttoRep: bigint; price: bigint; requestedDebtAttoEth: bigint; snapshotTargetUnderwritingLimitAttoEth: bigint }) {
	const zero = { backingUnitsToTransfer: 0n, underwritingLimitToMoveAttoEth: 0n, debtToMoveAttoEth: 0n, vaultAttoRepBackingToTransfer: 0n }
	if (parameters.snapshotTargetUnderwritingLimitAttoEth === 0n || parameters.requestedDebtAttoEth === 0n || parameters.price === 0n) return zero
	const reservedBackingUnits = backingUnitsForRep(parameters.minimumRemainingAttoRep, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits, true)
	const transferableBackingUnits = parameters.currentTargetBackingUnits > reservedBackingUnits ? parameters.currentTargetBackingUnits - reservedBackingUnits : 0n
	const debtToMoveAttoEth = parameters.requestedDebtAttoEth < parameters.snapshotTargetUnderwritingLimitAttoEth ? parameters.requestedDebtAttoEth : parameters.snapshotTargetUnderwritingLimitAttoEth
	if (debtToMoveAttoEth === 0n) return zero
	const underwritingLimitToMoveAttoEth = debtToMoveAttoEth
	const grossRepAwardAttoRep = mulDivUp(debtToMoveAttoEth, parameters.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR)
	const nominalBackingUnits = backingUnitsForRep(grossRepAwardAttoRep, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits, true)
	const backingUnitsToTransfer = nominalBackingUnits < transferableBackingUnits ? nominalBackingUnits : transferableBackingUnits
	const vaultAttoRepBackingToTransfer = parameters.currentTotalRepBackingUnits === 0n ? backingUnitsToTransfer / PRICE_PRECISION : repForBackingUnits(backingUnitsToTransfer, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits)
	return { backingUnitsToTransfer, underwritingLimitToMoveAttoEth, debtToMoveAttoEth, vaultAttoRepBackingToTransfer }
}

export function conservativeLiquidationRep(candidate: Pick<LiquidationCandidate, 'debtToMoveAttoEth' | 'target'>, price: bigint) {
	const nominalAttoRep = mulDivUp(candidate.debtToMoveAttoEth, price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR)
	return candidate.target.vaultAttoRepBacking < nominalAttoRep ? candidate.target.vaultAttoRepBacking : nominalAttoRep
}

export function evaluateCandidate(pool: PoolRiskContext, target: VaultPosition, caller: VaultPosition, strategy: StrategySettings): LiquidationCandidate | undefined {
	if (target.badDebtAttoEth !== 0n || caller.badDebtAttoEth !== 0n) return undefined
	if (pool.price === 0n || !isUnsafeVault(target.vaultAttoRepBacking, target.underwritingLimitAttoEth, pool.multiplierBps, pool.price, target.disputeStakedAttoRep)) return undefined
	const priceDistanceBps = liquidationPriceDistanceBps(target.vaultAttoRepBacking, target.underwritingLimitAttoEth, pool.multiplierBps, pool.price, target.disputeStakedAttoRep)
	if (priceDistanceBps < pool.minLiquidationPriceDistanceBps) return undefined
	const requestedDebtAttoEth = strategy.maximumLiquidationDebtAttoEth < target.underwritingLimitAttoEth ? strategy.maximumLiquidationDebtAttoEth : target.underwritingLimitAttoEth
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
	const resultingOpenInterestAttoEth = resultingUnderwritingLimitAttoEth
	const debtToMoveAttoEth = transfer.debtToMoveAttoEth
	if (debtToMoveAttoEth < strategy.minimumLiquidationDebtAttoEth) return undefined
	if (resultingOpenInterestAttoEth < pool.minimumSecurityBondDebtAttoEth) return undefined
	const vaultAttoRepBackingToTransfer = transfer.vaultAttoRepBackingToTransfer
	const healthRequiredAttoRep = requiredRepForOpenInterest(resultingOpenInterestAttoEth, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps, caller.disputeStakedAttoRep)
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
		resultingHealthBps: vaultHealthBps(resultingRepBeforeTopUpAttoRep + topUpAttoRep, resultingOpenInterestAttoEth, pool.multiplierBps, pool.price, caller.disputeStakedAttoRep) ?? strategy.vaultTargetHealthBps,
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
	const healthRequiredAttoRep = requiredRepForOpenInterest(caller.underwritingLimitAttoEth, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps, caller.disputeStakedAttoRep)
	const retainedAttoRep = caller.underwritingLimitAttoEth > 0n && pool.minimumVaultRepDepositAttoRep > healthRequiredAttoRep ? pool.minimumVaultRepDepositAttoRep : healthRequiredAttoRep
	if (caller.underwritingLimitAttoEth > 0n) {
		const health = vaultHealthBps(caller.vaultAttoRepBacking, caller.underwritingLimitAttoEth, pool.multiplierBps, pool.price, caller.disputeStakedAttoRep)
		if (health === undefined || health < strategy.vaultWithdrawHealthBps) return 0n
	}
	const surplusAttoRep = caller.vaultAttoRepBacking > retainedAttoRep ? caller.vaultAttoRepBacking - retainedAttoRep : 0n
	return surplusAttoRep >= strategy.minimumRepWithdrawalAttoRep ? surplusAttoRep : 0n
}
