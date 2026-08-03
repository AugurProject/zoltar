import * as liquidationCopy from '../../../copy/liquidation.js'
import { LIQUIDATION_BPS_DENOMINATOR, LIQUIDATION_PRICE_PRECISION, getLiquidationRepToMove } from '@zoltar/shared/liquidation'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'

const MIN_SECURITY_BOND_DEBT = 1n * 10n ** 18n
const MIN_REP_DEPOSIT = 10n * 10n ** 18n

function getLiquidationClaimRepToMove(debtToMove: bigint, targetVaultSummary: SecurityPoolVaultSummary) {
	const targetAllowance = targetVaultSummary.securityBondAllowance
	if (targetAllowance === 0n) return 0n
	const claimBundles = targetVaultSummary.liquidationClaimBundles
	if (claimBundles === undefined) {
		const liquidationClaimRep = targetVaultSummary.liquidationClaimRep ?? targetVaultSummary.escalationEscrowedRep
		return debtToMove === targetAllowance ? liquidationClaimRep : (liquidationClaimRep * debtToMove) / targetAllowance
	}
	return claimBundles.reduce((total, bundle) => {
		const sharesToMove = debtToMove === targetAllowance ? bundle.ownerShares : (bundle.ownerShares * debtToMove) / targetAllowance
		return total + (bundle.bundleRep * sharesToMove) / bundle.totalShares
	}, 0n)
}

function isVaultLiquidatable(lastPrice: bigint | undefined, securityBondAllowance: bigint | undefined, repDepositShare: bigint | undefined, escalationEscrowedRep: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (lastPrice === undefined || securityBondAllowance === undefined || repDepositShare === undefined || statoblastSecurityMultiplierBps === undefined) return false
	const escalationRep = escalationEscrowedRep ?? 0n
	const valueScale = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR
	const poolHealthy = (repDepositShare + escalationRep) * valueScale >= securityBondAllowance * lastPrice * statoblastSecurityMultiplierBps
	const migrationMultiplier = LIQUIDATION_BPS_DENOMINATOR + (statoblastSecurityMultiplierBps - LIQUIDATION_BPS_DENOMINATOR) / 2n
	const migrationHealthy = securityBondAllowance === 0n || repDepositShare * valueScale > securityBondAllowance * lastPrice * migrationMultiplier
	return !poolHealthy || !migrationHealthy
}

function getPartialLiquidationTransfer(debtToMove: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint) {
	const claimRepToMove = getLiquidationClaimRepToMove(debtToMove, targetVaultSummary)
	const quotedRep = getLiquidationRepToMove(debtToMove, repPerEthPrice, claimRepToMove)
	const { poolOwnership, poolOwnershipDenominator, totalRepBalance } = targetVaultSummary
	if (poolOwnership === undefined || poolOwnershipDenominator === undefined || totalRepBalance === undefined) {
		if (quotedRep >= targetVaultSummary.repDepositShare) return { remainingRep: 0n, repToMove: targetVaultSummary.repDepositShare }
		return { remainingRep: targetVaultSummary.repDepositShare - quotedRep, repToMove: quotedRep }
	}
	const ownershipToMove = poolOwnershipDenominator === 0n || totalRepBalance === 0n ? quotedRep * LIQUIDATION_PRICE_PRECISION : (quotedRep * poolOwnershipDenominator) / totalRepBalance
	if (ownershipToMove >= poolOwnership) return { remainingRep: 0n, repToMove: targetVaultSummary.repDepositShare }
	const remainingOwnership = poolOwnership - ownershipToMove
	return {
		remainingRep: poolOwnershipDenominator === 0n ? remainingOwnership / LIQUIDATION_PRICE_PRECISION : (remainingOwnership * totalRepBalance) / poolOwnershipDenominator,
		repToMove: poolOwnershipDenominator === 0n ? ownershipToMove / LIQUIDATION_PRICE_PRECISION : (ownershipToMove * totalRepBalance) / poolOwnershipDenominator,
	}
}

function getRepToMoveForLiquidation(debtToMove: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint) {
	const transfer = getPartialLiquidationTransfer(debtToMove, targetVaultSummary, repPerEthPrice)
	return debtToMove === targetVaultSummary.securityBondAllowance && transfer.remainingRep < MIN_REP_DEPOSIT ? targetVaultSummary.repDepositShare : transfer.repToMove
}

function getPromotedDebtToMove(requestedDebt: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint) {
	const targetAllowance = targetVaultSummary.securityBondAllowance
	const debtToMove = requestedDebt < targetAllowance ? requestedDebt : targetAllowance
	const debtRemaining = targetAllowance - debtToMove
	if (debtRemaining > 0n && debtRemaining < MIN_SECURITY_BOND_DEBT) return targetAllowance
	if (debtToMove < targetAllowance && getPartialLiquidationTransfer(debtToMove, targetVaultSummary, repPerEthPrice).remainingRep < MIN_REP_DEPOSIT) return targetAllowance
	return debtToMove
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
	claimRepToMove: bigint
	debtToMove: bigint
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
	const debtToMove = getPromotedDebtToMove(liquidationAmount < maxDebtToMove ? liquidationAmount : maxDebtToMove, targetVaultSummary, repPerEthPrice)
	const claimRepToMove = getLiquidationClaimRepToMove(debtToMove, targetVaultSummary)
	const grossRepAward = getLiquidationRepToMove(debtToMove, repPerEthPrice)
	const repToMove = getRepToMoveForLiquidation(debtToMove, targetVaultSummary, repPerEthPrice)
	const targetAfterRepDeposit = targetRepDeposit - repToMove
	const targetAfterAllowance = targetAllowance - debtToMove
	const callerAfterRepDeposit = callerRepDeposit + repToMove
	const callerAfterAllowance = callerAllowance + debtToMove
	const escalationRepToMove = targetAllowance === 0n ? 0n : (targetEscalationRep * debtToMove) / targetAllowance

	return {
		callerAfter: {
			escalationEscrowedRep: callerEscalationRep + escalationRepToMove,
			repDepositShare: callerAfterRepDeposit,
			securityBondAllowance: callerAfterAllowance,
		},
		callerBefore: {
			escalationEscrowedRep: callerEscalationRep,
			repDepositShare: callerRepDeposit,
			securityBondAllowance: callerAllowance,
		},
		claimRepToMove,
		debtToMove,
		grossRepAward,
		repToMove,
		targetAccruedFeesRetained: targetVaultSummary.unpaidEthFees,
		targetAfter: {
			escalationEscrowedRep: targetEscalationRep - escalationRepToMove,
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
	const debtToMove = getPromotedDebtToMove(liquidationAmount < targetMaxDebtToMove ? liquidationAmount : targetMaxDebtToMove, targetVaultSummary, repPerEthPrice ?? 0n)
	if (debtToMove <= 0n) return liquidationCopy.executableDebtUnavailable
	const repToMove = repPerEthPrice === undefined ? undefined : getRepToMoveForLiquidation(debtToMove, targetVaultSummary, repPerEthPrice)
	const targetAfterAllowance = targetVaultSummary.securityBondAllowance - debtToMove
	const targetAfterRepDeposit = repToMove === undefined ? undefined : targetVaultSummary.repDepositShare - repToMove
	const callerAfterRepDeposit = (callerVaultSummary?.repDepositShare ?? 0n) + (repToMove ?? 0n)
	const callerAfterAllowance = (callerVaultSummary?.securityBondAllowance ?? 0n) + debtToMove
	if (targetAfterRepDeposit !== undefined && targetAfterRepDeposit !== 0n && targetAfterRepDeposit < MIN_REP_DEPOSIT) return 'The target vault would fall below the minimum REP collateral after liquidation.'
	if (targetAfterAllowance !== 0n && targetAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'The target vault would fall below the minimum security bond allowance after liquidation.'
	if (callerAfterRepDeposit < MIN_REP_DEPOSIT) return 'Your vault would remain below the minimum REP collateral after liquidation.'
	if (callerAfterAllowance < MIN_SECURITY_BOND_DEBT) return 'Your vault would remain below the minimum security bond allowance after liquidation.'
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
	const callerEscalationAfter = (callerVaultSummary?.escalationEscrowedRep ?? 0n) + (targetVaultSummary.escalationEscrowedRep * simulation.debtToMove) / targetVaultSummary.securityBondAllowance
	if (isVaultLiquidatable(repPerEthPrice, simulation.callerAfter.securityBondAllowance, simulation.callerAfter.repDepositShare, callerEscalationAfter, statoblastSecurityMultiplierBps)) {
		if (isVaultLiquidatable(repPerEthPrice, simulation.callerBefore.securityBondAllowance, simulation.callerBefore.repDepositShare, callerVaultSummary?.escalationEscrowedRep, statoblastSecurityMultiplierBps)) return 'Your vault would remain liquidatable after this liquidation.'
		return 'Your vault would become liquidatable after this liquidation.'
	}
	return undefined
}
