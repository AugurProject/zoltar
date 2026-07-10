import { getVaultCollateralizationPercent } from './trading.js'
import type { SecurityPoolVaultSummary } from '../types/contracts.js'

const PRICE_PRECISION = 10n ** 18n
const MIN_SECURITY_BOND_DEBT = 1n * 10n ** 18n
const MIN_REP_DEPOSIT = 10n * 10n ** 18n

function ceilDiv(numerator: bigint, denominator: bigint) {
	return (numerator + denominator - 1n) / denominator
}

function isVaultLiquidatable(lastPrice: bigint | undefined, securityBondAllowance: bigint | undefined, repDepositShare: bigint | undefined, securityMultiplier: bigint | undefined) {
	if (lastPrice === undefined || securityBondAllowance === undefined || repDepositShare === undefined || securityMultiplier === undefined) return false
	return securityBondAllowance * lastPrice * securityMultiplier > repDepositShare * PRICE_PRECISION
}

export function getMaxLiquidationAmount({ repPerEthPrice, securityMultiplier, targetVaultSummary }: { repPerEthPrice: bigint | undefined; securityMultiplier: bigint | undefined; targetVaultSummary: SecurityPoolVaultSummary | undefined }) {
	if (repPerEthPrice === undefined || securityMultiplier === undefined || targetVaultSummary === undefined) return undefined
	if (repPerEthPrice <= 0n || securityMultiplier <= 0n) return 0n
	const targetRepDeposit = targetVaultSummary.repDepositShare
	const targetAllowance = targetVaultSummary.securityBondAllowance
	if (targetAllowance === 0n) return 0n
	const shortfallNumerator = targetAllowance * repPerEthPrice * securityMultiplier - targetRepDeposit * PRICE_PRECISION
	if (shortfallNumerator <= 0n) return 0n
	let maxDebtToMove = ceilDiv(shortfallNumerator, repPerEthPrice * securityMultiplier)
	if (maxDebtToMove > targetAllowance) maxDebtToMove = targetAllowance
	const remainingAllowance = targetAllowance - maxDebtToMove
	if (remainingAllowance !== 0n && remainingAllowance < MIN_SECURITY_BOND_DEBT) return targetAllowance
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
	const repToMove = 0n
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
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationAmount: bigint | undefined
	maxDebtToMove?: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (liquidationAmount === undefined) return 'Enter a valid liquidation amount.'
	if (liquidationAmount <= 0n) return 'Enter a liquidation amount greater than zero.'
	if (targetVaultSummary === undefined) return 'Reload the target vault before executing liquidation.'
	if (targetVaultSummary.securityBondAllowance === 0n) return 'This vault has no active security bond allowance to liquidate.'
	const targetMaxDebtToMove = maxDebtToMove === undefined || maxDebtToMove > targetVaultSummary.securityBondAllowance ? targetVaultSummary.securityBondAllowance : maxDebtToMove
	const debtToMove = liquidationAmount < targetMaxDebtToMove ? liquidationAmount : targetMaxDebtToMove
	if (debtToMove <= 0n) return 'This vault has no debt available to move.'
	const targetAfterAllowance = targetVaultSummary.securityBondAllowance - debtToMove
	const callerAfterRepDeposit = callerVaultSummary?.repDepositShare ?? 0n
	const callerAfterAllowance = (callerVaultSummary?.securityBondAllowance ?? 0n) + debtToMove
	if (targetVaultSummary.repDepositShare === 0n && targetAfterAllowance !== 0n) return 'The target vault would fall below the minimum REP collateral after liquidation.'
	if (targetVaultSummary.repDepositShare !== 0n && targetVaultSummary.repDepositShare < MIN_REP_DEPOSIT) return 'The target vault would fall below the minimum REP collateral after liquidation.'
	if (targetAfterAllowance !== 0n && targetAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'The target vault would fall below the minimum security bond allowance after liquidation.'
	if (callerAfterRepDeposit < MIN_REP_DEPOSIT) return 'The caller vault would remain below the minimum REP collateral after liquidation.'
	if (callerAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'The caller vault would remain below the minimum security bond allowance after liquidation.'
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
	const deterministicFailureReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		liquidationAmount,
		maxDebtToMove: (() => {
			const computedMaxDebtToMove = getMaxLiquidationAmount({
				repPerEthPrice,
				securityMultiplier,
				targetVaultSummary,
			})
			return computedMaxDebtToMove === undefined || computedMaxDebtToMove <= 0n ? undefined : computedMaxDebtToMove
		})(),
		targetVaultSummary,
	})
	if (deterministicFailureReason !== undefined) return deterministicFailureReason
	if (liquidationAmount === undefined) return 'Enter a valid liquidation amount.'
	if (repPerEthPrice === undefined || securityMultiplier === undefined) return 'Refresh the Open Oracle before executing liquidation.'
	if (targetVaultSummary === undefined) return 'Reload the target vault before executing liquidation.'
	if (!isVaultLiquidatable(repPerEthPrice, targetVaultSummary.securityBondAllowance, targetVaultSummary.repDepositShare, securityMultiplier)) return 'This vault is not undercollateralized at the current Open Oracle price.'

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
