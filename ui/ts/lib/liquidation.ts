import { LIQUIDATION_BPS_DENOMINATOR, LIQUIDATION_PRICE_PRECISION, LIQUIDATION_REP_BONUS_BPS, getLiquidationRepToMove } from '@zoltar/shared/liquidation'
import { getVaultCollateralizationPercent } from './trading.js'
import { UI_STRINGS } from './uiStrings.js'
import type { SecurityPoolVaultSummary } from '../types/contracts.js'

const MIN_SECURITY_BOND_DEBT = 1n * 10n ** 18n
const MIN_REP_DEPOSIT = 10n * 10n ** 18n

function isVaultLiquidatable(lastPrice: bigint | undefined, securityBondAllowance: bigint | undefined, repDepositShare: bigint | undefined, securityMultiplier: bigint | undefined) {
	if (lastPrice === undefined || securityBondAllowance === undefined || repDepositShare === undefined || securityMultiplier === undefined) return false
	return securityBondAllowance * lastPrice * securityMultiplier > repDepositShare * LIQUIDATION_PRICE_PRECISION
}

function improvesTargetHealth(debtToMove: bigint, repToMove: bigint, repPerEthPrice: bigint, securityMultiplier: bigint) {
	return debtToMove * securityMultiplier * repPerEthPrice > repToMove * LIQUIDATION_PRICE_PRECISION
}

function getRepToMoveForLiquidation(debtToMove: bigint, repPerEthPrice: bigint, targetAllowance: bigint, targetRepDeposit: bigint) {
	const computedRepToMove = getLiquidationRepToMove(debtToMove, repPerEthPrice)
	return debtToMove === targetAllowance && (computedRepToMove >= targetRepDeposit || (targetRepDeposit > computedRepToMove && targetRepDeposit - computedRepToMove < MIN_REP_DEPOSIT)) ? targetRepDeposit : computedRepToMove
}

export function getLiquidationExecutionFailureDetail(errorMessage: string | undefined) {
	switch (errorMessage) {
		case 'Target safe':
			return UI_STRINGS.liquidationModal.liquidationFailureTargetSafeDetail
		case 'No liq':
			return UI_STRINGS.liquidationModal.liquidationFailureNoExecutableDebtDetail
		case 'No gain':
			return UI_STRINGS.liquidationModal.liquidationFailureNoHealthGainDetail
		case 'Caller bad':
			return UI_STRINGS.liquidationModal.liquidationFailureUndercollateralizedCallerDetail
		case 'Target REP':
			return UI_STRINGS.liquidationModal.liquidationFailureTargetRepDetail
		case 'Target debt':
			return UI_STRINGS.liquidationModal.liquidationFailureTargetDebtDetail
		case 'Caller REP':
			return UI_STRINGS.liquidationModal.liquidationFailureCallerRepDetail
		case 'Caller debt':
			return UI_STRINGS.liquidationModal.liquidationFailureCallerDebtDetail
		default:
			return errorMessage
	}
}

export function getMaxLiquidationAmount({ repPerEthPrice, securityMultiplier, targetVaultSummary }: { repPerEthPrice: bigint | undefined; securityMultiplier: bigint | undefined; targetVaultSummary: SecurityPoolVaultSummary | undefined }) {
	if (repPerEthPrice === undefined || securityMultiplier === undefined || targetVaultSummary === undefined) return undefined
	if (repPerEthPrice <= 0n || securityMultiplier <= 0n) return 0n
	const targetRepDeposit = targetVaultSummary.repDepositShare
	const targetAllowance = targetVaultSummary.securityBondAllowance
	if (targetAllowance === 0n) return 0n
	if (!isVaultLiquidatable(repPerEthPrice, targetAllowance, targetRepDeposit, securityMultiplier)) return 0n
	let maxDebtToMove = 0n
	if (targetRepDeposit > MIN_REP_DEPOSIT) {
		maxDebtToMove = ((targetRepDeposit - MIN_REP_DEPOSIT) * LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR) / (repPerEthPrice * (LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS))
	}
	if (maxDebtToMove > targetAllowance) maxDebtToMove = targetAllowance
	const remainingAllowance = targetAllowance - maxDebtToMove
	if (remainingAllowance !== 0n && remainingAllowance <= MIN_SECURITY_BOND_DEBT) {
		return targetAllowance > MIN_SECURITY_BOND_DEBT ? targetAllowance - MIN_SECURITY_BOND_DEBT : targetAllowance
	}
	return maxDebtToMove
}

type LiquidationSimulation = {
	callerAfter: {
		collateralization: bigint | undefined
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
	callerBefore: {
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
	debtToMove: bigint
	repToMove: bigint
	targetAfter: {
		collateralization: bigint | undefined
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
	targetBefore: {
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
}

export function simulateLiquidation({
	callerVaultSummary,
	liquidationAmount,
	repPerEthPrice,
	securityMultiplier,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationAmount: bigint
	repPerEthPrice: bigint
	securityMultiplier: bigint
	targetVaultSummary: SecurityPoolVaultSummary
}): LiquidationSimulation {
	const callerRepDeposit = callerVaultSummary?.repDepositShare ?? 0n
	const callerAllowance = callerVaultSummary?.securityBondAllowance ?? 0n
	const targetRepDeposit = targetVaultSummary.repDepositShare
	const targetAllowance = targetVaultSummary.securityBondAllowance
	const maxDebtToMove =
		getMaxLiquidationAmount({
			repPerEthPrice,
			securityMultiplier,
			targetVaultSummary,
		}) ?? targetAllowance
	const debtToMove = liquidationAmount < maxDebtToMove ? liquidationAmount : maxDebtToMove
	const repToMove = getRepToMoveForLiquidation(debtToMove, repPerEthPrice, targetAllowance, targetRepDeposit)
	const targetAfterRepDeposit = targetRepDeposit - repToMove
	const targetAfterAllowance = targetAllowance - debtToMove
	const callerAfterRepDeposit = callerRepDeposit + repToMove
	const callerAfterAllowance = callerAllowance + debtToMove

	return {
		callerAfter: {
			collateralization: getVaultCollateralizationPercent(callerAfterRepDeposit, callerAfterAllowance, repPerEthPrice),
			repDepositShare: callerAfterRepDeposit,
			securityBondAllowance: callerAfterAllowance,
		},
		callerBefore: {
			repDepositShare: callerRepDeposit,
			securityBondAllowance: callerAllowance,
		},
		debtToMove,
		repToMove,
		targetAfter: {
			collateralization: getVaultCollateralizationPercent(targetAfterRepDeposit, targetAfterAllowance, repPerEthPrice),
			repDepositShare: targetAfterRepDeposit,
			securityBondAllowance: targetAfterAllowance,
		},
		targetBefore: {
			repDepositShare: targetRepDeposit,
			securityBondAllowance: targetAllowance,
		},
	}
}

export function getDeterministicLiquidationFailureReason({
	callerVaultSummary,
	liquidationAmount,
	maxDebtToMove,
	repPerEthPrice,
	securityMultiplier,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationAmount: bigint | undefined
	maxDebtToMove?: bigint | undefined
	repPerEthPrice?: bigint | undefined
	securityMultiplier?: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (liquidationAmount === undefined) return 'Enter a valid liquidation amount.'
	if (liquidationAmount <= 0n) return 'Enter a liquidation amount greater than zero.'
	if (targetVaultSummary === undefined) return 'Reload the target vault before executing liquidation.'
	if (targetVaultSummary.securityBondAllowance === 0n) return 'This vault has no active security bond allowance to liquidate.'
	if (repPerEthPrice !== undefined && securityMultiplier !== undefined && !isVaultLiquidatable(repPerEthPrice, targetVaultSummary.securityBondAllowance, targetVaultSummary.repDepositShare, securityMultiplier)) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const targetMaxDebtToMove = maxDebtToMove === undefined || maxDebtToMove > targetVaultSummary.securityBondAllowance ? targetVaultSummary.securityBondAllowance : maxDebtToMove
	const debtToMove = liquidationAmount < targetMaxDebtToMove ? liquidationAmount : targetMaxDebtToMove
	if (debtToMove <= 0n) return UI_STRINGS.liquidationModal.liquidationFailureNoExecutableDebtDetail
	const repToMove = repPerEthPrice === undefined ? undefined : getRepToMoveForLiquidation(debtToMove, repPerEthPrice, targetVaultSummary.securityBondAllowance, targetVaultSummary.repDepositShare)
	const targetAfterAllowance = targetVaultSummary.securityBondAllowance - debtToMove
	const targetAfterRepDeposit = repToMove === undefined ? undefined : targetVaultSummary.repDepositShare - repToMove
	const callerAfterRepDeposit = (callerVaultSummary?.repDepositShare ?? 0n) + (repToMove ?? 0n)
	const callerAfterAllowance = (callerVaultSummary?.securityBondAllowance ?? 0n) + debtToMove
	if (targetAfterRepDeposit !== undefined && targetAfterRepDeposit !== 0n && targetAfterRepDeposit < MIN_REP_DEPOSIT) return 'The target vault would fall below the minimum REP collateral after liquidation.'
	if (targetAfterAllowance !== 0n && targetAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'The target vault would fall below the minimum security bond allowance after liquidation.'
	if (callerAfterRepDeposit < MIN_REP_DEPOSIT) return 'The caller vault would remain below the minimum REP collateral after liquidation.'
	if (callerAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'The caller vault would remain below the minimum security bond allowance after liquidation.'
	if (repToMove !== undefined && repPerEthPrice !== undefined && securityMultiplier !== undefined && !improvesTargetHealth(debtToMove, repToMove, repPerEthPrice, securityMultiplier)) {
		return 'This liquidation amount is too small to improve the target vault health after rounding.'
	}
	return undefined
}

export function getLiquidationFailureReason({
	callerVaultSummary,
	liquidationAmount,
	repPerEthPrice,
	securityMultiplier,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationAmount: bigint | undefined
	repPerEthPrice: bigint | undefined
	securityMultiplier: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (repPerEthPrice !== undefined && securityMultiplier !== undefined && targetVaultSummary !== undefined && !isVaultLiquidatable(repPerEthPrice, targetVaultSummary.securityBondAllowance, targetVaultSummary.repDepositShare, securityMultiplier)) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const deterministicFailureReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		liquidationAmount,
		maxDebtToMove: (() => {
			const computedMaxDebtToMove = getMaxLiquidationAmount({
				repPerEthPrice,
				securityMultiplier,
				targetVaultSummary,
			})
			return computedMaxDebtToMove
		})(),
		repPerEthPrice,
		securityMultiplier,
		targetVaultSummary,
	})
	if (deterministicFailureReason !== undefined) return deterministicFailureReason
	if (liquidationAmount === undefined) return 'Enter a valid liquidation amount.'
	if (repPerEthPrice === undefined || securityMultiplier === undefined) return 'Refresh the Open Oracle before executing liquidation.'
	if (targetVaultSummary === undefined) return 'Reload the target vault before executing liquidation.'

	const simulation = simulateLiquidation({
		callerVaultSummary,
		liquidationAmount,
		repPerEthPrice,
		securityMultiplier,
		targetVaultSummary,
	})
	if (isVaultLiquidatable(repPerEthPrice, simulation.callerAfter.securityBondAllowance, simulation.callerAfter.repDepositShare, securityMultiplier)) {
		if (isVaultLiquidatable(repPerEthPrice, simulation.callerBefore.securityBondAllowance, simulation.callerBefore.repDepositShare, securityMultiplier)) return 'The caller vault would remain liquidatable after this liquidation.'
		return 'The caller vault would become liquidatable after this liquidation.'
	}
	return undefined
}
