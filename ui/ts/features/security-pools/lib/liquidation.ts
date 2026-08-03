import * as liquidationCopy from '../../../copy/liquidation.js'
import { LIQUIDATION_BPS_DENOMINATOR, LIQUIDATION_PRICE_PRECISION, LIQUIDATION_REP_BONUS_BPS, getLiquidationRepToMove, getMaxFundedLiquidationDebt } from '@zoltar/shared/liquidation'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'

const MIN_SECURITY_BOND_DEBT = 1n * 10n ** 18n
const MIN_REP_DEPOSIT = 10n * 10n ** 18n

function isVaultLiquidatable(lastPrice: bigint | undefined, securityBondAllowance: bigint | undefined, repDepositShare: bigint | undefined, escalationEscrowedRep: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (lastPrice === undefined || securityBondAllowance === undefined || repDepositShare === undefined || statoblastSecurityMultiplierBps === undefined) return false
	const escalationRep = escalationEscrowedRep ?? 0n
	const valueScale = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR
	const poolHealthy = (repDepositShare + escalationRep) * valueScale >= securityBondAllowance * lastPrice * statoblastSecurityMultiplierBps
	const configuredMigrationMultiplier = LIQUIDATION_BPS_DENOMINATOR + (statoblastSecurityMultiplierBps - LIQUIDATION_BPS_DENOMINATOR) / 2n
	const liquidationReserveMultiplier = LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS
	const migrationMultiplier = configuredMigrationMultiplier < liquidationReserveMultiplier ? liquidationReserveMultiplier : configuredMigrationMultiplier
	const migrationHealthy = securityBondAllowance === 0n || repDepositShare * valueScale > securityBondAllowance * lastPrice * migrationMultiplier
	return !poolHealthy || !migrationHealthy
}

function getPartialLiquidationTransfer(debtToMove: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint) {
	const quotedRep = getLiquidationRepToMove(debtToMove, repPerEthPrice)
	const { poolOwnership, poolOwnershipDenominator, totalRepBalance } = targetVaultSummary
	if (poolOwnership === undefined || poolOwnershipDenominator === undefined || totalRepBalance === undefined) {
		if (quotedRep >= targetVaultSummary.repDepositShare) return { remainingRep: 0n, repToMove: targetVaultSummary.repDepositShare }
		return { remainingRep: targetVaultSummary.repDepositShare - quotedRep, repToMove: quotedRep }
	}
	const ownershipToMove = poolOwnershipDenominator === 0n || totalRepBalance === 0n ? quotedRep * LIQUIDATION_PRICE_PRECISION : (quotedRep * poolOwnershipDenominator + totalRepBalance - 1n) / totalRepBalance
	if (ownershipToMove >= poolOwnership) return { remainingRep: 0n, repToMove: targetVaultSummary.repDepositShare }
	const remainingOwnership = poolOwnership - ownershipToMove
	return {
		remainingRep: poolOwnershipDenominator === 0n ? remainingOwnership / LIQUIDATION_PRICE_PRECISION : (remainingOwnership * totalRepBalance) / poolOwnershipDenominator,
		repToMove: poolOwnershipDenominator === 0n ? ownershipToMove / LIQUIDATION_PRICE_PRECISION : (ownershipToMove * totalRepBalance) / poolOwnershipDenominator,
	}
}

function getAwardableLiquidationRep(targetVaultSummary: SecurityPoolVaultSummary, reserveMinimumRep: boolean) {
	const { poolOwnership, poolOwnershipDenominator, totalRepBalance } = targetVaultSummary
	if (poolOwnership === undefined || poolOwnershipDenominator === undefined || totalRepBalance === undefined) {
		if (!reserveMinimumRep) return targetVaultSummary.repDepositShare
		return targetVaultSummary.repDepositShare > MIN_REP_DEPOSIT ? targetVaultSummary.repDepositShare - MIN_REP_DEPOSIT : 0n
	}
	let reserveOwnership = 0n
	if (reserveMinimumRep) {
		reserveOwnership = poolOwnershipDenominator === 0n || totalRepBalance === 0n ? MIN_REP_DEPOSIT * LIQUIDATION_PRICE_PRECISION : (MIN_REP_DEPOSIT * poolOwnershipDenominator + totalRepBalance - 1n) / totalRepBalance
	}
	if (reserveOwnership >= poolOwnership) return 0n
	const awardableOwnership = poolOwnership - reserveOwnership
	return poolOwnershipDenominator === 0n ? awardableOwnership / LIQUIDATION_PRICE_PRECISION : (awardableOwnership * totalRepBalance) / poolOwnershipDenominator
}

function getFundedLiquidationAmounts(requestedDebt: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint, callerAllowance = 0n) {
	const targetAllowance = targetVaultSummary.securityBondAllowance
	const resolveResidualAsBadDebt = requestedDebt >= targetAllowance
	if (!resolveResidualAsBadDebt && targetAllowance <= MIN_SECURITY_BOND_DEBT) return { badDebtRecorded: 0n, debtToMove: 0n }
	const awardableRep = getAwardableLiquidationRep(targetVaultSummary, !resolveResidualAsBadDebt)
	const maxFundedDebt = getMaxFundedLiquidationDebt(awardableRep, repPerEthPrice)
	let requestedDebtToMove = requestedDebt < targetAllowance ? requestedDebt : targetAllowance
	const requestedDebtRemaining = targetAllowance - requestedDebtToMove
	if (!resolveResidualAsBadDebt && requestedDebtRemaining > 0n && requestedDebtRemaining < MIN_SECURITY_BOND_DEBT) requestedDebtToMove = targetAllowance - MIN_SECURITY_BOND_DEBT
	let debtToMove = requestedDebtToMove < maxFundedDebt ? requestedDebtToMove : maxFundedDebt
	if (debtToMove !== 0n && callerAllowance + debtToMove < MIN_SECURITY_BOND_DEBT && resolveResidualAsBadDebt) debtToMove = 0n
	const badDebtRecorded = resolveResidualAsBadDebt ? targetAllowance - debtToMove : 0n
	return { badDebtRecorded, debtToMove }
}

export function getLiquidationExecutionFailureDetail(errorMessage: string | undefined) {
	switch (errorMessage) {
		case 'Target safe':
			return liquidationCopy.targetNotLiquidatableError
		case 'No liq':
			return liquidationCopy.executableDebtUnavailable
		case 'No gain':
			return liquidationCopy.liquidationTooSmallError
		case 'Caller bad':
			return liquidationCopy.callerVaultHealthOrIdentityError
		case 'Target REP':
			return liquidationCopy.targetMinimumCollateralError
		case 'Target debt':
			return liquidationCopy.targetMinimumBondError
		case 'Caller REP':
			return liquidationCopy.callerMinimumCollateralError
		case 'Caller debt':
			return liquidationCopy.callerMinimumBondError
		default:
			return errorMessage
	}
}

export function getMaxLiquidationAmount({ repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary }: { repPerEthPrice: bigint | undefined; statoblastSecurityMultiplierBps: bigint | undefined; targetVaultSummary: SecurityPoolVaultSummary | undefined }) {
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined || targetVaultSummary === undefined) return undefined
	if (repPerEthPrice <= 0n || statoblastSecurityMultiplierBps <= 0n) return 0n
	const targetRepDeposit = targetVaultSummary.repDepositShare
	const targetAllowance = targetVaultSummary.securityBondAllowance
	if (targetAllowance === 0n) return 0n
	if (!isVaultLiquidatable(repPerEthPrice, targetAllowance, targetRepDeposit, targetVaultSummary.escalationEscrowedRep, statoblastSecurityMultiplierBps)) return 0n
	return targetAllowance
}

type LiquidationSimulation = {
	callerAfter: {
		escalationEscrowedRep: bigint
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
	callerBefore: {
		escalationEscrowedRep: bigint
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
	debtToMove: bigint
	badDebtRecorded: bigint
	grossRepAward: bigint
	repToMove: bigint
	targetAccruedFeesRetained: bigint
	targetAfter: {
		escalationEscrowedRep: bigint
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
	targetBefore: {
		escalationEscrowedRep: bigint
		repDepositShare: bigint
		securityBondAllowance: bigint
	}
}

export function simulateLiquidation({
	callerVaultSummary,
	liquidationAmount,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationAmount: bigint
	repPerEthPrice: bigint
	statoblastSecurityMultiplierBps: bigint
	targetVaultSummary: SecurityPoolVaultSummary
}): LiquidationSimulation {
	const callerRepDeposit = callerVaultSummary?.repDepositShare ?? 0n
	const callerEscalationRep = callerVaultSummary?.escalationEscrowedRep ?? 0n
	const callerAllowance = callerVaultSummary?.securityBondAllowance ?? 0n
	const targetRepDeposit = targetVaultSummary.repDepositShare
	const targetEscalationRep = targetVaultSummary.escalationEscrowedRep
	const targetAllowance = targetVaultSummary.securityBondAllowance
	const maxDebtToMove =
		getMaxLiquidationAmount({
			repPerEthPrice,
			statoblastSecurityMultiplierBps,
			targetVaultSummary,
		}) ?? targetAllowance
	const { badDebtRecorded, debtToMove } = getFundedLiquidationAmounts(liquidationAmount < maxDebtToMove ? liquidationAmount : maxDebtToMove, targetVaultSummary, repPerEthPrice, callerAllowance)
	const grossRepAward = getLiquidationRepToMove(debtToMove, repPerEthPrice)
	const repToMove = getPartialLiquidationTransfer(debtToMove, targetVaultSummary, repPerEthPrice).repToMove
	const targetAfterRepDeposit = targetRepDeposit - repToMove
	const targetAfterAllowance = targetAllowance - debtToMove - badDebtRecorded
	const callerAfterRepDeposit = callerRepDeposit + repToMove
	const callerAfterAllowance = callerAllowance + debtToMove
	return {
		callerAfter: {
			escalationEscrowedRep: callerEscalationRep,
			repDepositShare: callerAfterRepDeposit,
			securityBondAllowance: callerAfterAllowance,
		},
		callerBefore: {
			escalationEscrowedRep: callerEscalationRep,
			repDepositShare: callerRepDeposit,
			securityBondAllowance: callerAllowance,
		},
		badDebtRecorded,
		debtToMove,
		grossRepAward,
		repToMove,
		targetAccruedFeesRetained: targetVaultSummary.unpaidEthFees,
		targetAfter: {
			escalationEscrowedRep: targetEscalationRep,
			repDepositShare: targetAfterRepDeposit,
			securityBondAllowance: targetAfterAllowance,
		},
		targetBefore: {
			escalationEscrowedRep: targetEscalationRep,
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
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationAmount: bigint | undefined
	maxDebtToMove?: bigint | undefined
	repPerEthPrice?: bigint | undefined
	statoblastSecurityMultiplierBps?: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (liquidationAmount === undefined) return 'Enter a valid liquidation amount.'
	if (liquidationAmount <= 0n) return 'Enter a liquidation amount greater than zero.'
	if (targetVaultSummary === undefined) return 'Target vault details are still loading.'
	if (targetVaultSummary.securityBondAllowance === 0n) return 'This vault has no active security bond allowance to liquidate.'
	if (repPerEthPrice !== undefined && statoblastSecurityMultiplierBps !== undefined && !isVaultLiquidatable(repPerEthPrice, targetVaultSummary.securityBondAllowance, targetVaultSummary.repDepositShare, targetVaultSummary.escalationEscrowedRep, statoblastSecurityMultiplierBps)) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const targetMaxDebtToMove = maxDebtToMove === undefined || maxDebtToMove > targetVaultSummary.securityBondAllowance ? targetVaultSummary.securityBondAllowance : maxDebtToMove
	const requestedDebt = liquidationAmount < targetMaxDebtToMove ? liquidationAmount : targetMaxDebtToMove
	const { badDebtRecorded, debtToMove } = repPerEthPrice === undefined ? { badDebtRecorded: 0n, debtToMove: requestedDebt } : getFundedLiquidationAmounts(requestedDebt, targetVaultSummary, repPerEthPrice, callerVaultSummary?.securityBondAllowance ?? 0n)
	if (debtToMove <= 0n && badDebtRecorded <= 0n) return liquidationCopy.executableDebtUnavailable
	const repToMove = repPerEthPrice === undefined ? undefined : getPartialLiquidationTransfer(debtToMove, targetVaultSummary, repPerEthPrice).repToMove
	const targetAfterAllowance = targetVaultSummary.securityBondAllowance - debtToMove - badDebtRecorded
	const targetAfterRepDeposit = repToMove === undefined ? undefined : targetVaultSummary.repDepositShare - repToMove
	const callerAfterRepDeposit = (callerVaultSummary?.repDepositShare ?? 0n) + (repToMove ?? 0n)
	const callerAfterAllowance = (callerVaultSummary?.securityBondAllowance ?? 0n) + debtToMove
	if (targetAfterAllowance !== 0n && targetAfterRepDeposit !== undefined && targetAfterRepDeposit < MIN_REP_DEPOSIT) return 'The target vault would fall below the minimum REP collateral after liquidation.'
	if (targetAfterAllowance !== 0n && targetAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'The target vault would fall below the minimum security bond allowance after liquidation.'
	if (debtToMove !== 0n && callerAfterRepDeposit < MIN_REP_DEPOSIT) return 'Your vault would remain below the minimum REP collateral after liquidation.'
	if (debtToMove !== 0n && callerAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'Your vault would remain below the minimum security bond allowance after liquidation.'
	return undefined
}

export function getLiquidationFailureReason({
	callerVaultSummary,
	liquidationAmount,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationAmount: bigint | undefined
	repPerEthPrice: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (repPerEthPrice !== undefined && statoblastSecurityMultiplierBps !== undefined && targetVaultSummary !== undefined && !isVaultLiquidatable(repPerEthPrice, targetVaultSummary.securityBondAllowance, targetVaultSummary.repDepositShare, targetVaultSummary.escalationEscrowedRep, statoblastSecurityMultiplierBps)) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const deterministicFailureReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		liquidationAmount,
		maxDebtToMove: (() => {
			const computedMaxDebtToMove = getMaxLiquidationAmount({
				repPerEthPrice,
				statoblastSecurityMultiplierBps,
				targetVaultSummary,
			})
			return computedMaxDebtToMove
		})(),
		repPerEthPrice,
		statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	if (deterministicFailureReason !== undefined) return deterministicFailureReason
	if (liquidationAmount === undefined) return 'Enter a valid liquidation amount.'
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined) return 'Refresh the Open Oracle before executing liquidation.'
	if (targetVaultSummary === undefined) return 'Target vault details are still loading.'

	const simulation = simulateLiquidation({
		callerVaultSummary,
		liquidationAmount,
		repPerEthPrice,
		statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	if (isVaultLiquidatable(repPerEthPrice, simulation.callerAfter.securityBondAllowance, simulation.callerAfter.repDepositShare, simulation.callerAfter.escalationEscrowedRep, statoblastSecurityMultiplierBps)) {
		if (isVaultLiquidatable(repPerEthPrice, simulation.callerBefore.securityBondAllowance, simulation.callerBefore.repDepositShare, callerVaultSummary?.escalationEscrowedRep, statoblastSecurityMultiplierBps)) return 'Your vault would remain liquidatable after this liquidation.'
		return 'Your vault would become liquidatable after this liquidation.'
	}
	return undefined
}
