import type { Address } from '@zoltar/bot-shared/ethereum'
import type { CandidatePriority, StrategySettings } from '#config/settings'

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
	capacityOwnershipAttoRep: bigint
	claimableFeesAttoEth: bigint
	disputeStakedAttoRep: bigint
	openInterestAttoEth: bigint
	vaultAttoRepBacking: bigint
}

export type PoolRiskContext = {
	address: Address
	denominator: bigint
	feeEligibleCapacityOwnershipAttoRep: bigint
	manager: Address
	minimumSecurityBondDebtAttoEth: bigint
	minimumVaultRepDepositAttoRep: bigint
	minLiquidationPriceDistanceBps: bigint
	multiplierBps: bigint
	price: bigint
	settlementCollateralAttoEth: bigint
	totalAttoRep: bigint
}

export type LiquidationCandidate = {
	bonusValueAttoEth: bigint
	capacityOwnershipToMoveAttoRep: bigint
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
	return (numerator - 1n) / denominator + 1n
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

export function backingUnitsForRep(vaultAttoRepBacking: bigint, totalAttoRep: bigint, denominator: bigint, roundUp = false) {
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

export function liquidationPriceDistanceBps(targetVaultRepBackingAttoRep: bigint, openInterestAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	if (openInterestAttoEth === 0n || price === 0n) return 0n
	const valueScale = PRICE_PRECISION * BPS_DENOMINATOR
	const associatedThreshold = ((targetVaultRepBackingAttoRep + disputeStakedAttoRep) * valueScale) / (openInterestAttoEth * multiplierBps)
	const freeThreshold = (targetVaultRepBackingAttoRep * valueScale) / (openInterestAttoEth * migrationMultiplierBps(multiplierBps))
	const thresholdPrice = associatedThreshold < freeThreshold ? associatedThreshold : freeThreshold
	if (price <= thresholdPrice) return 0n
	return ((price - thresholdPrice) * BPS_DENOMINATOR) / price
}

export function isUnsafeVault(vaultAttoRepBacking: bigint, openInterestAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	const health = vaultHealthBps(vaultAttoRepBacking, openInterestAttoEth, multiplierBps, price, disputeStakedAttoRep)
	return health !== undefined && health < BPS_DENOMINATOR
}

export function calculateLiquidationTransfer(parameters: {
	currentPoolHeldAttoRepBalance: bigint
	currentTargetBackingUnits: bigint
	currentTotalRepBackingUnits: bigint
	minimumRemainingAttoRep: bigint
	price: bigint
	requestedDebtAttoEth: bigint
	snapshotTargetCapacityOwnershipAttoRep: bigint
	snapshotTargetOpenInterestAttoEth: bigint
}) {
	const zero = { backingUnitsToTransfer: 0n, capacityOwnershipToMoveAttoRep: 0n, debtToMoveAttoEth: 0n, vaultAttoRepBackingToTransfer: 0n }
	if (parameters.snapshotTargetCapacityOwnershipAttoRep === 0n || parameters.snapshotTargetOpenInterestAttoEth === 0n || parameters.requestedDebtAttoEth === 0n || parameters.price === 0n) return zero
	const reservedBackingUnits = backingUnitsForRep(parameters.minimumRemainingAttoRep, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits, true)
	if (reservedBackingUnits >= parameters.currentTargetBackingUnits) return zero
	const transferableBackingUnits = parameters.currentTargetBackingUnits - reservedBackingUnits
	const transferableAttoRep = parameters.currentTotalRepBackingUnits === 0n ? transferableBackingUnits / PRICE_PRECISION : repForBackingUnits(transferableBackingUnits, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits)
	const maximumFundedDebtAttoEth = (transferableAttoRep * PRICE_PRECISION * BPS_DENOMINATOR) / (parameters.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS))
	const boundedRequest = parameters.requestedDebtAttoEth < parameters.snapshotTargetOpenInterestAttoEth ? parameters.requestedDebtAttoEth : parameters.snapshotTargetOpenInterestAttoEth
	const debtToMoveAttoEth = boundedRequest < maximumFundedDebtAttoEth ? boundedRequest : maximumFundedDebtAttoEth
	if (debtToMoveAttoEth === 0n) return zero
	const capacityOwnershipToMoveAttoRep = debtToMoveAttoEth === parameters.snapshotTargetOpenInterestAttoEth ? parameters.snapshotTargetCapacityOwnershipAttoRep : (parameters.snapshotTargetCapacityOwnershipAttoRep * debtToMoveAttoEth) / parameters.snapshotTargetOpenInterestAttoEth
	if (capacityOwnershipToMoveAttoRep === 0n) return zero
	const grossRepAwardAttoRep = mulDivUp(debtToMoveAttoEth, parameters.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR)
	const backingUnitsToTransfer = backingUnitsForRep(grossRepAwardAttoRep, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits, true)
	if (backingUnitsToTransfer > transferableBackingUnits) throw new Error('Liquidation award exceeds funded backing')
	const vaultAttoRepBackingToTransfer = parameters.currentTotalRepBackingUnits === 0n ? backingUnitsToTransfer / PRICE_PRECISION : repForBackingUnits(backingUnitsToTransfer, parameters.currentPoolHeldAttoRepBalance, parameters.currentTotalRepBackingUnits)
	return { backingUnitsToTransfer, capacityOwnershipToMoveAttoRep, debtToMoveAttoEth, vaultAttoRepBackingToTransfer }
}

export function conservativeLiquidationRep(candidate: Pick<LiquidationCandidate, 'debtToMoveAttoEth' | 'target'>, price: bigint) {
	const nominalAttoRep = mulDivUp(candidate.debtToMoveAttoEth, price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR)
	return candidate.debtToMoveAttoEth === candidate.target.openInterestAttoEth && candidate.target.vaultAttoRepBacking > nominalAttoRep ? candidate.target.vaultAttoRepBacking : nominalAttoRep
}

export function evaluateCandidate(pool: PoolRiskContext, target: VaultPosition, caller: VaultPosition, strategy: StrategySettings): LiquidationCandidate | undefined {
	if (pool.price === 0n || !isUnsafeVault(target.vaultAttoRepBacking, target.openInterestAttoEth, pool.multiplierBps, pool.price, target.disputeStakedAttoRep)) return undefined
	const priceDistanceBps = liquidationPriceDistanceBps(target.vaultAttoRepBacking, target.openInterestAttoEth, pool.multiplierBps, pool.price, target.disputeStakedAttoRep)
	if (priceDistanceBps < pool.minLiquidationPriceDistanceBps) return undefined
	const requestedDebtAttoEth = strategy.maximumLiquidationDebtAttoEth < target.openInterestAttoEth ? strategy.maximumLiquidationDebtAttoEth : target.openInterestAttoEth
	const transfer = calculateLiquidationTransfer({
		currentPoolHeldAttoRepBalance: pool.totalAttoRep,
		currentTargetBackingUnits: target.backingUnits,
		currentTotalRepBackingUnits: pool.denominator,
		minimumRemainingAttoRep: requestedDebtAttoEth >= target.openInterestAttoEth ? 0n : pool.minimumVaultRepDepositAttoRep,
		price: pool.price,
		requestedDebtAttoEth,
		snapshotTargetCapacityOwnershipAttoRep: target.capacityOwnershipAttoRep,
		snapshotTargetOpenInterestAttoEth: target.openInterestAttoEth,
	})
	const resultingCapacityOwnershipAttoRep = caller.capacityOwnershipAttoRep + transfer.capacityOwnershipToMoveAttoRep
	const grossResultingOpenInterestAttoEth = resultingCapacityOwnershipAttoRep === 0n || pool.feeEligibleCapacityOwnershipAttoRep === 0n ? 0n : mulDivUp(pool.settlementCollateralAttoEth, resultingCapacityOwnershipAttoRep, pool.feeEligibleCapacityOwnershipAttoRep)
	const resultingOpenInterestAttoEth = grossResultingOpenInterestAttoEth > caller.badDebtAttoEth ? grossResultingOpenInterestAttoEth - caller.badDebtAttoEth : 0n
	if (resultingOpenInterestAttoEth < caller.openInterestAttoEth) return undefined
	const debtToMoveAttoEth = resultingOpenInterestAttoEth - caller.openInterestAttoEth
	if (debtToMoveAttoEth < strategy.minimumLiquidationDebtAttoEth || debtToMoveAttoEth > transfer.debtToMoveAttoEth) return undefined
	if (resultingOpenInterestAttoEth < pool.minimumSecurityBondDebtAttoEth) return undefined
	const grossRepAwardAttoRep = mulDivUp(debtToMoveAttoEth, pool.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR)
	const backingUnitsToTransfer = backingUnitsForRep(grossRepAwardAttoRep, pool.totalAttoRep, pool.denominator, true)
	if (backingUnitsToTransfer > transfer.backingUnitsToTransfer) return undefined
	const vaultAttoRepBackingToTransfer = pool.denominator === 0n ? backingUnitsToTransfer / PRICE_PRECISION : repForBackingUnits(backingUnitsToTransfer, pool.totalAttoRep, pool.denominator)
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
		capacityOwnershipToMoveAttoRep: transfer.capacityOwnershipToMoveAttoRep,
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

export function sortCandidates(candidates: readonly LiquidationCandidate[], priority: CandidatePriority) {
	return [...candidates].sort((left, right) => {
		const leftValue = priority === 'largest-debt' ? left.debtToMoveAttoEth : priority === 'lowest-top-up' ? -left.topUpAttoRep : left.bonusValueAttoEth
		const rightValue = priority === 'largest-debt' ? right.debtToMoveAttoEth : priority === 'lowest-top-up' ? -right.topUpAttoRep : right.bonusValueAttoEth
		if (leftValue === rightValue) return left.target.address.localeCompare(right.target.address)
		return leftValue > rightValue ? -1 : 1
	})
}

export function selectAllowedCandidate(candidates: readonly LiquidationCandidate[], priority: CandidatePriority, allowed: (candidate: LiquidationCandidate) => boolean) {
	return sortCandidates(candidates, priority).find(allowed)
}

export function surplusRepForWithdrawal(caller: VaultPosition, pool: Pick<PoolRiskContext, 'minimumVaultRepDepositAttoRep' | 'multiplierBps' | 'price'>, strategy: Pick<StrategySettings, 'minimumRepWithdrawalAttoRep' | 'vaultTargetHealthBps' | 'vaultWithdrawHealthBps'>) {
	if (caller.vaultAttoRepBacking === 0n) return 0n
	const healthRequiredAttoRep = requiredRepForOpenInterest(caller.openInterestAttoEth, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps, caller.disputeStakedAttoRep)
	const retainedAttoRep = caller.openInterestAttoEth > 0n && pool.minimumVaultRepDepositAttoRep > healthRequiredAttoRep ? pool.minimumVaultRepDepositAttoRep : healthRequiredAttoRep
	if (caller.openInterestAttoEth > 0n) {
		const health = vaultHealthBps(caller.vaultAttoRepBacking, caller.openInterestAttoEth, pool.multiplierBps, pool.price, caller.disputeStakedAttoRep)
		if (health === undefined || health < strategy.vaultWithdrawHealthBps) return 0n
	}
	const surplusAttoRep = caller.vaultAttoRepBacking > retainedAttoRep ? caller.vaultAttoRepBacking - retainedAttoRep : 0n
	return surplusAttoRep >= strategy.minimumRepWithdrawalAttoRep ? surplusAttoRep : 0n
}
