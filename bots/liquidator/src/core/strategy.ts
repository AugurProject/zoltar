import type { Address } from '@zoltar/bot-shared/ethereum'
import type { CandidatePriority, StrategySettings } from '#config/settings'

export const PRICE_PRECISION = 10n ** 18n
export const BPS_DENOMINATOR = 10_000n
export const LIQUIDATION_REP_BONUS_BPS = 500n
export const MIN_REP_DEPOSIT_ATTO_REP = 10n * PRICE_PRECISION
export const MIN_COVERAGE_COMMITMENT_ATTO_ETH = PRICE_PRECISION

export function liquidationExecutionAllowed(coordinatorPrice: bigint, centralizedPriceAllowed: boolean) {
	return coordinatorPrice > 0n && centralizedPriceAllowed
}

export type VaultPosition = {
	address: Address
	coverageCommitmentAttoEth: bigint
	backingUnits: bigint
	vaultRepBackingAttoRep: bigint
	claimableFeesAttoEth: bigint
}

export type PoolRiskContext = {
	address: Address
	denominator: bigint
	manager: Address
	minLiquidationPriceDistanceBps: bigint
	multiplierBps: bigint
	price: bigint
	totalRepAttoRep: bigint
}

export type LiquidationCandidate = {
	bonusValueAttoEth: bigint
	coverageCommitmentToTransferAttoEth: bigint
	pool: PoolRiskContext
	priceDistanceBps: bigint
	vaultRepBackingToTransferAttoRep: bigint
	resultingHealthBps: bigint
	target: VaultPosition
	topUpAttoRep: bigint
}

function ceilDiv(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new Error('Division denominator must be positive')
	if (numerator === 0n) return 0n
	return (numerator - 1n) / denominator + 1n
}

export function repForBackingUnits(backingUnits: bigint, totalRepAttoRep: bigint, denominator: bigint) {
	if (backingUnits === 0n || denominator === 0n) return 0n
	return (backingUnits * totalRepAttoRep) / denominator
}

export function backingUnitsForRep(vaultRepBackingAttoRep: bigint, totalRepAttoRep: bigint, denominator: bigint) {
	if (denominator === 0n || totalRepAttoRep === 0n) return vaultRepBackingAttoRep * PRICE_PRECISION
	return (vaultRepBackingAttoRep * denominator) / totalRepAttoRep
}

export function requiredRepForCoverageCommitment(coverageCommitmentAttoEth: bigint, multiplierBps: bigint, price: bigint, healthBps = BPS_DENOMINATOR) {
	if (coverageCommitmentAttoEth === 0n) return 0n
	return ceilDiv(coverageCommitmentAttoEth * multiplierBps * price * healthBps, PRICE_PRECISION * BPS_DENOMINATOR * BPS_DENOMINATOR)
}

export function vaultHealthBps(vaultRepBackingAttoRep: bigint, coverageCommitmentAttoEth: bigint, multiplierBps: bigint, price: bigint) {
	if (coverageCommitmentAttoEth === 0n) return undefined
	const requiredNumerator = coverageCommitmentAttoEth * multiplierBps * price
	if (requiredNumerator === 0n) return undefined
	return (vaultRepBackingAttoRep * PRICE_PRECISION * BPS_DENOMINATOR * BPS_DENOMINATOR) / requiredNumerator
}

export function liquidationPriceDistanceBps(targetVaultRepBackingAttoRep: bigint, coverageCommitmentAttoEth: bigint, multiplierBps: bigint, price: bigint) {
	if (coverageCommitmentAttoEth === 0n || price === 0n) return 0n
	const thresholdPrice = (targetVaultRepBackingAttoRep * PRICE_PRECISION * BPS_DENOMINATOR) / (coverageCommitmentAttoEth * multiplierBps)
	if (price <= thresholdPrice) return 0n
	return ((price - thresholdPrice) * BPS_DENOMINATOR) / price
}

export function isUnsafeVault(vaultRepBackingAttoRep: bigint, coverageCommitmentAttoEth: bigint, multiplierBps: bigint, price: bigint) {
	return coverageCommitmentAttoEth > 0n && vaultRepBackingAttoRep * PRICE_PRECISION * BPS_DENOMINATOR < coverageCommitmentAttoEth * multiplierBps * price
}

export function calculateLiquidationTransfer(parameters: {
	currentTotalRepBackingUnits: bigint
	currentTargetBackingUnits: bigint
	currentPoolHeldRepBalanceAttoRep: bigint
	price: bigint
	requestedCommitmentTransferAttoEth: bigint
	snapshotTotalRepBackingUnits: bigint
	snapshotTargetCoverageCommitmentAttoEth: bigint
	snapshotTargetBackingUnits: bigint
	snapshotTotalPoolHeldRepAttoRep: bigint
}) {
	const snapshotTargetVaultRepBackingAttoRep = parameters.snapshotTotalRepBackingUnits === 0n ? parameters.snapshotTargetBackingUnits / PRICE_PRECISION : (parameters.snapshotTargetBackingUnits * parameters.snapshotTotalPoolHeldRepAttoRep) / parameters.snapshotTotalRepBackingUnits
	let maximumCoverageCommitmentTransferAttoEth = 0n
	if (snapshotTargetVaultRepBackingAttoRep > MIN_REP_DEPOSIT_ATTO_REP) {
		maximumCoverageCommitmentTransferAttoEth = ((snapshotTargetVaultRepBackingAttoRep - MIN_REP_DEPOSIT_ATTO_REP) * PRICE_PRECISION * BPS_DENOMINATOR) / (parameters.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS))
		if (maximumCoverageCommitmentTransferAttoEth > parameters.snapshotTargetCoverageCommitmentAttoEth) maximumCoverageCommitmentTransferAttoEth = parameters.snapshotTargetCoverageCommitmentAttoEth
	}
	if (maximumCoverageCommitmentTransferAttoEth < parameters.snapshotTargetCoverageCommitmentAttoEth && parameters.snapshotTargetCoverageCommitmentAttoEth - maximumCoverageCommitmentTransferAttoEth <= MIN_COVERAGE_COMMITMENT_ATTO_ETH) {
		maximumCoverageCommitmentTransferAttoEth = parameters.snapshotTargetCoverageCommitmentAttoEth > MIN_COVERAGE_COMMITMENT_ATTO_ETH ? parameters.snapshotTargetCoverageCommitmentAttoEth - MIN_COVERAGE_COMMITMENT_ATTO_ETH : parameters.snapshotTargetCoverageCommitmentAttoEth
	}
	const coverageCommitmentToTransferAttoEth = parameters.requestedCommitmentTransferAttoEth > maximumCoverageCommitmentTransferAttoEth ? maximumCoverageCommitmentTransferAttoEth : parameters.requestedCommitmentTransferAttoEth
	if (coverageCommitmentToTransferAttoEth === 0n) return { coverageCommitmentToTransferAttoEth: 0n, backingUnitsToTransfer: 0n, vaultRepBackingToTransferAttoRep: 0n }
	const vaultRepBackingToTransferNumerator = coverageCommitmentToTransferAttoEth * parameters.price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS)
	const vaultRepBackingToTransferDenominator = PRICE_PRECISION * BPS_DENOMINATOR
	let vaultRepBackingToTransferAttoRep = ceilDiv(vaultRepBackingToTransferNumerator, vaultRepBackingToTransferDenominator)
	let backingUnitsToTransfer = backingUnitsForRep(vaultRepBackingToTransferAttoRep, parameters.currentPoolHeldRepBalanceAttoRep, parameters.currentTotalRepBackingUnits)
	if (coverageCommitmentToTransferAttoEth === parameters.snapshotTargetCoverageCommitmentAttoEth) {
		const remainingRepAttoRep = parameters.currentTotalRepBackingUnits === 0n || backingUnitsToTransfer >= parameters.currentTargetBackingUnits ? 0n : repForBackingUnits(parameters.currentTargetBackingUnits - backingUnitsToTransfer, parameters.currentPoolHeldRepBalanceAttoRep, parameters.currentTotalRepBackingUnits)
		if (backingUnitsToTransfer >= parameters.currentTargetBackingUnits || remainingRepAttoRep < MIN_REP_DEPOSIT_ATTO_REP) {
			vaultRepBackingToTransferAttoRep = parameters.currentTotalRepBackingUnits === 0n ? 0n : repForBackingUnits(parameters.currentTargetBackingUnits, parameters.currentPoolHeldRepBalanceAttoRep, parameters.currentTotalRepBackingUnits)
			backingUnitsToTransfer = parameters.currentTargetBackingUnits
		}
	}
	return { coverageCommitmentToTransferAttoEth, backingUnitsToTransfer, vaultRepBackingToTransferAttoRep }
}

export function conservativeLiquidationRep(candidate: Pick<LiquidationCandidate, 'coverageCommitmentToTransferAttoEth' | 'target'>, price: bigint) {
	const nominalRepAttoRep = ceilDiv(candidate.coverageCommitmentToTransferAttoEth * price * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR)
	return candidate.coverageCommitmentToTransferAttoEth === candidate.target.coverageCommitmentAttoEth && candidate.target.vaultRepBackingAttoRep > nominalRepAttoRep ? candidate.target.vaultRepBackingAttoRep : nominalRepAttoRep
}

export function evaluateCandidate(pool: PoolRiskContext, target: VaultPosition, caller: VaultPosition, strategy: StrategySettings): LiquidationCandidate | undefined {
	if (pool.price === 0n || !isUnsafeVault(target.vaultRepBackingAttoRep, target.coverageCommitmentAttoEth, pool.multiplierBps, pool.price)) return undefined
	const priceDistanceBps = liquidationPriceDistanceBps(target.vaultRepBackingAttoRep, target.coverageCommitmentAttoEth, pool.multiplierBps, pool.price)
	if (priceDistanceBps < pool.minLiquidationPriceDistanceBps) return undefined
	const transfer = calculateLiquidationTransfer({
		currentTotalRepBackingUnits: pool.denominator,
		currentTargetBackingUnits: target.backingUnits,
		currentPoolHeldRepBalanceAttoRep: pool.totalRepAttoRep,
		price: pool.price,
		requestedCommitmentTransferAttoEth: strategy.maximumLiquidationCoverageCommitmentAttoEth,
		snapshotTotalRepBackingUnits: pool.denominator,
		snapshotTargetCoverageCommitmentAttoEth: target.coverageCommitmentAttoEth,
		snapshotTargetBackingUnits: target.backingUnits,
		snapshotTotalPoolHeldRepAttoRep: pool.totalRepAttoRep,
	})
	if (transfer.coverageCommitmentToTransferAttoEth < strategy.minimumLiquidationCoverageCommitmentAttoEth) return undefined
	if (!isUnsafeVault(transfer.vaultRepBackingToTransferAttoRep, transfer.coverageCommitmentToTransferAttoEth, pool.multiplierBps, pool.price)) {
		return undefined
	}
	const resultingCoverageCommitmentAttoEth = caller.coverageCommitmentAttoEth + transfer.coverageCommitmentToTransferAttoEth
	const healthRequiredRepAttoRep = requiredRepForCoverageCommitment(resultingCoverageCommitmentAttoEth, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps)
	const requiredResultingRepAttoRep = healthRequiredRepAttoRep > MIN_REP_DEPOSIT_ATTO_REP ? healthRequiredRepAttoRep : MIN_REP_DEPOSIT_ATTO_REP
	const resultingRepBeforeTopUpAttoRep = caller.vaultRepBackingAttoRep + transfer.vaultRepBackingToTransferAttoRep
	const topUpAttoRep = requiredResultingRepAttoRep > resultingRepBeforeTopUpAttoRep ? requiredResultingRepAttoRep - resultingRepBeforeTopUpAttoRep : 0n
	if (resultingRepBeforeTopUpAttoRep + topUpAttoRep > strategy.maximumRepPerPoolAttoRep) return undefined
	const repBackingAwardValueAttoEth = (transfer.vaultRepBackingToTransferAttoRep * PRICE_PRECISION) / pool.price
	const bonusValueAttoEth = repBackingAwardValueAttoEth > transfer.coverageCommitmentToTransferAttoEth ? repBackingAwardValueAttoEth - transfer.coverageCommitmentToTransferAttoEth : 0n
	if (bonusValueAttoEth < strategy.minimumRewardValueAttoEth) return undefined
	const resultingHealthBps = vaultHealthBps(resultingRepBeforeTopUpAttoRep + topUpAttoRep, resultingCoverageCommitmentAttoEth, pool.multiplierBps, pool.price) ?? strategy.vaultTargetHealthBps
	return {
		bonusValueAttoEth,
		coverageCommitmentToTransferAttoEth: transfer.coverageCommitmentToTransferAttoEth,
		pool,
		priceDistanceBps,
		vaultRepBackingToTransferAttoRep: transfer.vaultRepBackingToTransferAttoRep,
		resultingHealthBps,
		target,
		topUpAttoRep,
	}
}

export function sortCandidates(candidates: readonly LiquidationCandidate[], priority: CandidatePriority) {
	return [...candidates].sort((left, right) => {
		const leftValue = priority === 'largest-coverage-commitment' ? left.coverageCommitmentToTransferAttoEth : priority === 'lowest-top-up' ? -left.topUpAttoRep : left.bonusValueAttoEth
		const rightValue = priority === 'largest-coverage-commitment' ? right.coverageCommitmentToTransferAttoEth : priority === 'lowest-top-up' ? -right.topUpAttoRep : right.bonusValueAttoEth
		if (leftValue === rightValue) return left.target.address.localeCompare(right.target.address)
		return leftValue > rightValue ? -1 : 1
	})
}

export function selectAllowedCandidate(candidates: readonly LiquidationCandidate[], priority: CandidatePriority, allowed: (candidate: LiquidationCandidate) => boolean) {
	return sortCandidates(candidates, priority).find(allowed)
}

export function surplusRepForWithdrawal(caller: VaultPosition, pool: Pick<PoolRiskContext, 'multiplierBps' | 'price'>, strategy: Pick<StrategySettings, 'minimumRepWithdrawalAttoRep' | 'vaultTargetHealthBps' | 'vaultWithdrawHealthBps'>) {
	if (caller.vaultRepBackingAttoRep === 0n) return 0n
	const retainedRepAttoRep = requiredRepForCoverageCommitment(caller.coverageCommitmentAttoEth, pool.multiplierBps, pool.price, strategy.vaultTargetHealthBps)
	if (caller.coverageCommitmentAttoEth > 0n) {
		const health = vaultHealthBps(caller.vaultRepBackingAttoRep, caller.coverageCommitmentAttoEth, pool.multiplierBps, pool.price)
		if (health === undefined || health < strategy.vaultWithdrawHealthBps) return 0n
	}
	const surplusAttoRep = caller.vaultRepBackingAttoRep > retainedRepAttoRep ? caller.vaultRepBackingAttoRep - retainedRepAttoRep : 0n
	return surplusAttoRep >= strategy.minimumRepWithdrawalAttoRep ? surplusAttoRep : 0n
}
