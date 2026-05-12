import { getVaultCollateralizationPercent } from './trading.js'
import type { SecurityPoolVaultSummary } from '../types/contracts.js'

const PRICE_PRECISION = 10n ** 18n
const MIN_SECURITY_BOND_DEBT = 1n * 10n ** 18n
const MIN_REP_DEPOSIT = 10n * 10n ** 18n

function isVaultLiquidatable(lastPrice: bigint | undefined, securityBondAllowance: bigint | undefined, repDepositShare: bigint | undefined, securityMultiplier: bigint | undefined) {
	if (lastPrice === undefined || securityBondAllowance === undefined || repDepositShare === undefined || securityMultiplier === undefined) return false
	return securityBondAllowance * lastPrice * securityMultiplier > repDepositShare * PRICE_PRECISION
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

export function simulateLiquidation({ callerVaultSummary, liquidationAmount, repPerEthPrice, targetVaultSummary }: { callerVaultSummary: SecurityPoolVaultSummary | undefined; liquidationAmount: bigint; repPerEthPrice: bigint; targetVaultSummary: SecurityPoolVaultSummary }): LiquidationSimulation {
	const callerRepDeposit = callerVaultSummary?.repDepositShare ?? 0n
	const callerAllowance = callerVaultSummary?.securityBondAllowance ?? 0n
	const targetRepDeposit = targetVaultSummary.repDepositShare
	const targetAllowance = targetVaultSummary.securityBondAllowance
	const debtToMove = liquidationAmount < targetAllowance ? liquidationAmount : targetAllowance
	const repToMove = targetAllowance === 0n ? 0n : (debtToMove * targetRepDeposit) / targetAllowance
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
	if (liquidationAmount === undefined) return 'Enter a valid liquidation amount.'
	if (liquidationAmount <= 0n) return 'Enter a liquidation amount greater than zero.'
	if (targetVaultSummary === undefined) return 'Reload the target vault before executing liquidation.'
	if (repPerEthPrice === undefined || securityMultiplier === undefined) return 'Refresh the Open Oracle before executing liquidation.'
	if (targetVaultSummary.securityBondAllowance === 0n) return 'This vault has no active security bond allowance to liquidate.'
	if (!isVaultLiquidatable(repPerEthPrice, targetVaultSummary.securityBondAllowance, targetVaultSummary.repDepositShare, securityMultiplier)) return 'This vault is not undercollateralized at the current Open Oracle price.'

	const simulation = simulateLiquidation({
		callerVaultSummary,
		liquidationAmount,
		repPerEthPrice,
		targetVaultSummary,
	})
	if (simulation.debtToMove <= 0n) return 'This vault has no debt available to move.'
	if (isVaultLiquidatable(repPerEthPrice, simulation.callerAfter.securityBondAllowance, simulation.callerAfter.repDepositShare, securityMultiplier)) return 'The caller vault would become liquidatable after this liquidation.'
	if (simulation.targetAfter.repDepositShare !== 0n && simulation.targetAfter.repDepositShare < MIN_REP_DEPOSIT) return 'The target vault would fall below the minimum REP deposit after liquidation.'
	if (simulation.targetAfter.securityBondAllowance !== 0n && simulation.targetAfter.securityBondAllowance < MIN_SECURITY_BOND_DEBT) return 'The target vault would fall below the minimum security bond allowance after liquidation.'
	if (simulation.callerAfter.repDepositShare < MIN_REP_DEPOSIT) return 'The caller vault would remain below the minimum REP deposit after liquidation.'
	if (simulation.callerAfter.securityBondAllowance < MIN_SECURITY_BOND_DEBT) return 'The caller vault would remain below the minimum security bond allowance after liquidation.'
	return undefined
}
