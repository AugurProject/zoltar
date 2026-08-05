import * as liquidationCopy from '../../../copy/liquidation.js'
import { LIQUIDATION_BPS_DENOMINATOR, LIQUIDATION_PRICE_PRECISION, LIQUIDATION_REP_BONUS_BPS, getLiquidationVaultRepBackingToTransfer, getMaximumFundedCoverageCommitmentAttoEth } from '@zoltar/shared/liquidation'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'

const MIN_COVERAGE_COMMITMENT_ATTO_ETH = 1n * 10n ** 18n
const MIN_REP_DEPOSIT_ATTO_REP = 10n * 10n ** 18n

function isVaultLiquidatable(lastPrice: bigint | undefined, coverageCommitmentAttoEth: bigint | undefined, vaultRepBackingAttoRep: bigint | undefined, disputeStakedRepAttoRep: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (lastPrice === undefined || coverageCommitmentAttoEth === undefined || vaultRepBackingAttoRep === undefined || statoblastSecurityMultiplierBps === undefined) return false
	const effectiveDisputeStakedRepAttoRep = disputeStakedRepAttoRep ?? 0n
	const valueScale = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR
	const poolHealthy = (vaultRepBackingAttoRep + effectiveDisputeStakedRepAttoRep) * valueScale >= coverageCommitmentAttoEth * lastPrice * statoblastSecurityMultiplierBps
	const configuredMigrationMultiplier = LIQUIDATION_BPS_DENOMINATOR + (statoblastSecurityMultiplierBps - LIQUIDATION_BPS_DENOMINATOR) / 2n
	const liquidationReserveMultiplier = LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS
	const migrationMultiplier = configuredMigrationMultiplier < liquidationReserveMultiplier ? liquidationReserveMultiplier : configuredMigrationMultiplier
	const migrationHealthy = coverageCommitmentAttoEth === 0n || vaultRepBackingAttoRep * valueScale > coverageCommitmentAttoEth * lastPrice * migrationMultiplier
	return !poolHealthy || !migrationHealthy
}

function getPartialLiquidationTransfer(coverageCommitmentToTransferAttoEth: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint) {
	const quotedRep = getLiquidationVaultRepBackingToTransfer(coverageCommitmentToTransferAttoEth, repPerEthPrice)
	const { repBackingUnits, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep } = targetVaultSummary
	if (repBackingUnits === undefined || totalRepBackingUnits === undefined || totalPoolHeldRepBalanceAttoRep === undefined) {
		if (quotedRep >= targetVaultSummary.vaultRepBackingAttoRep) return { remainingRepAttoRep: 0n, vaultRepBackingToTransferAttoRep: targetVaultSummary.vaultRepBackingAttoRep }
		return { remainingRepAttoRep: targetVaultSummary.vaultRepBackingAttoRep - quotedRep, vaultRepBackingToTransferAttoRep: quotedRep }
	}
	const backingUnitsToTransfer = totalRepBackingUnits === 0n || totalPoolHeldRepBalanceAttoRep === 0n ? quotedRep * LIQUIDATION_PRICE_PRECISION : (quotedRep * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
	if (backingUnitsToTransfer >= repBackingUnits) return { remainingRepAttoRep: 0n, vaultRepBackingToTransferAttoRep: targetVaultSummary.vaultRepBackingAttoRep }
	const remainingBackingUnits = repBackingUnits - backingUnitsToTransfer
	return {
		remainingRepAttoRep: totalRepBackingUnits === 0n ? remainingBackingUnits / LIQUIDATION_PRICE_PRECISION : (remainingBackingUnits * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits,
		vaultRepBackingToTransferAttoRep: totalRepBackingUnits === 0n ? backingUnitsToTransfer / LIQUIDATION_PRICE_PRECISION : (backingUnitsToTransfer * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits,
	}
}

function getAwardableLiquidationRep(targetVaultSummary: SecurityPoolVaultSummary, reserveMinimumRep: boolean) {
	const { repBackingUnits, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep } = targetVaultSummary
	if (repBackingUnits === undefined || totalRepBackingUnits === undefined || totalPoolHeldRepBalanceAttoRep === undefined) {
		if (!reserveMinimumRep) return targetVaultSummary.vaultRepBackingAttoRep
		return targetVaultSummary.vaultRepBackingAttoRep > MIN_REP_DEPOSIT_ATTO_REP ? targetVaultSummary.vaultRepBackingAttoRep - MIN_REP_DEPOSIT_ATTO_REP : 0n
	}
	let reserveBackingUnits = 0n
	if (reserveMinimumRep) {
		reserveBackingUnits = totalRepBackingUnits === 0n || totalPoolHeldRepBalanceAttoRep === 0n ? MIN_REP_DEPOSIT_ATTO_REP * LIQUIDATION_PRICE_PRECISION : (MIN_REP_DEPOSIT_ATTO_REP * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
	}
	if (reserveBackingUnits >= repBackingUnits) return 0n
	const awardableBackingUnits = repBackingUnits - reserveBackingUnits
	return totalRepBackingUnits === 0n ? awardableBackingUnits / LIQUIDATION_PRICE_PRECISION : (awardableBackingUnits * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits
}

function getFundedLiquidationAmounts(requestedCommitmentTransferAttoEth: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint, callerCoverageCommitmentAttoEth = 0n) {
	const targetCoverageCommitmentAttoEth = targetVaultSummary.coverageCommitmentAttoEth
	const resolveResidualAsBadDebt = requestedCommitmentTransferAttoEth >= targetCoverageCommitmentAttoEth
	if (!resolveResidualAsBadDebt && targetCoverageCommitmentAttoEth <= MIN_COVERAGE_COMMITMENT_ATTO_ETH) return { badDebtAttoEth: 0n, coverageCommitmentToTransferAttoEth: 0n }
	const awardableRepAttoRep = getAwardableLiquidationRep(targetVaultSummary, !resolveResidualAsBadDebt)
	const maximumFundedCoverageCommitmentAttoEth = getMaximumFundedCoverageCommitmentAttoEth(awardableRepAttoRep, repPerEthPrice)
	let requestedCoverageCommitmentTransferAttoEth = requestedCommitmentTransferAttoEth < targetCoverageCommitmentAttoEth ? requestedCommitmentTransferAttoEth : targetCoverageCommitmentAttoEth
	const remainingRequestedCoverageCommitmentAttoEth = targetCoverageCommitmentAttoEth - requestedCoverageCommitmentTransferAttoEth
	if (!resolveResidualAsBadDebt && remainingRequestedCoverageCommitmentAttoEth > 0n && remainingRequestedCoverageCommitmentAttoEth < MIN_COVERAGE_COMMITMENT_ATTO_ETH) requestedCoverageCommitmentTransferAttoEth = targetCoverageCommitmentAttoEth - MIN_COVERAGE_COMMITMENT_ATTO_ETH
	let coverageCommitmentToTransferAttoEth = requestedCoverageCommitmentTransferAttoEth < maximumFundedCoverageCommitmentAttoEth ? requestedCoverageCommitmentTransferAttoEth : maximumFundedCoverageCommitmentAttoEth
	if (coverageCommitmentToTransferAttoEth !== 0n && callerCoverageCommitmentAttoEth + coverageCommitmentToTransferAttoEth < MIN_COVERAGE_COMMITMENT_ATTO_ETH && resolveResidualAsBadDebt) coverageCommitmentToTransferAttoEth = 0n
	const badDebtAttoEth = resolveResidualAsBadDebt ? targetCoverageCommitmentAttoEth - coverageCommitmentToTransferAttoEth : 0n
	return { badDebtAttoEth, coverageCommitmentToTransferAttoEth }
}

export function getLiquidationExecutionFailureDetail(errorMessage: string | undefined) {
	switch (errorMessage) {
		case 'Target safe':
			return liquidationCopy.targetNotLiquidatableError
		case 'No liq':
			return liquidationCopy.executableCoverageCommitmentUnavailable
		case 'No gain':
			return liquidationCopy.liquidationTooSmallError
		case 'Caller bad':
			return liquidationCopy.callerVaultHealthOrIdentityError
		case 'Target REP':
			return liquidationCopy.targetMinimumCollateralError
		case 'Target commitment':
			return liquidationCopy.targetMinimumCoverageCommitmentError
		case 'Caller REP':
			return liquidationCopy.callerMinimumCollateralError
		case 'Caller commitment':
		case 'Commitment request low':
			return liquidationCopy.callerMinimumCoverageCommitmentError
		default:
			return errorMessage
	}
}

export function getMaxLiquidationAmount({ repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary }: { repPerEthPrice: bigint | undefined; statoblastSecurityMultiplierBps: bigint | undefined; targetVaultSummary: SecurityPoolVaultSummary | undefined }) {
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined || targetVaultSummary === undefined) return undefined
	if (repPerEthPrice <= 0n || statoblastSecurityMultiplierBps <= 0n) return 0n
	const targetRepDeposit = targetVaultSummary.vaultRepBackingAttoRep
	const targetCoverageCommitmentAttoEth = targetVaultSummary.coverageCommitmentAttoEth
	if (targetCoverageCommitmentAttoEth === 0n) return 0n
	if (!isVaultLiquidatable(repPerEthPrice, targetCoverageCommitmentAttoEth, targetRepDeposit, targetVaultSummary.disputeStakedRepAttoRep, statoblastSecurityMultiplierBps)) return 0n
	return targetCoverageCommitmentAttoEth
}

type LiquidationSimulation = {
	callerAfter: {
		disputeStakedRepAttoRep: bigint
		vaultRepBackingAttoRep: bigint
		coverageCommitmentAttoEth: bigint
	}
	callerBefore: {
		disputeStakedRepAttoRep: bigint
		vaultRepBackingAttoRep: bigint
		coverageCommitmentAttoEth: bigint
	}
	coverageCommitmentToTransferAttoEth: bigint
	badDebtAttoEth: bigint
	grossRepAwardAttoRep: bigint
	vaultRepBackingToTransferAttoRep: bigint
	targetAccruedFeesRetained: bigint
	targetAfter: {
		disputeStakedRepAttoRep: bigint
		vaultRepBackingAttoRep: bigint
		coverageCommitmentAttoEth: bigint
	}
	targetBefore: {
		disputeStakedRepAttoRep: bigint
		vaultRepBackingAttoRep: bigint
		coverageCommitmentAttoEth: bigint
	}
}

export function simulateLiquidation({
	callerVaultSummary,
	coverageCommitmentTransferAttoEth,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	coverageCommitmentTransferAttoEth: bigint
	repPerEthPrice: bigint
	statoblastSecurityMultiplierBps: bigint
	targetVaultSummary: SecurityPoolVaultSummary
}): LiquidationSimulation {
	const callerRepDeposit = callerVaultSummary?.vaultRepBackingAttoRep ?? 0n
	const callerDisputeStakedRepAttoRep = callerVaultSummary?.disputeStakedRepAttoRep ?? 0n
	const callerCoverageCommitmentAttoEth = callerVaultSummary?.coverageCommitmentAttoEth ?? 0n
	const targetRepDeposit = targetVaultSummary.vaultRepBackingAttoRep
	const targetDisputeStakedRepAttoRep = targetVaultSummary.disputeStakedRepAttoRep
	const targetCoverageCommitmentAttoEth = targetVaultSummary.coverageCommitmentAttoEth
	const maxCoverageCommitmentToTransferAttoEth =
		getMaxLiquidationAmount({
			repPerEthPrice,
			statoblastSecurityMultiplierBps,
			targetVaultSummary,
		}) ?? targetCoverageCommitmentAttoEth
	const { badDebtAttoEth, coverageCommitmentToTransferAttoEth } = getFundedLiquidationAmounts(coverageCommitmentTransferAttoEth < maxCoverageCommitmentToTransferAttoEth ? coverageCommitmentTransferAttoEth : maxCoverageCommitmentToTransferAttoEth, targetVaultSummary, repPerEthPrice, callerCoverageCommitmentAttoEth)
	const grossRepAwardAttoRep = getLiquidationVaultRepBackingToTransfer(coverageCommitmentToTransferAttoEth, repPerEthPrice)
	const vaultRepBackingToTransferAttoRep = getPartialLiquidationTransfer(coverageCommitmentToTransferAttoEth, targetVaultSummary, repPerEthPrice).vaultRepBackingToTransferAttoRep
	const targetAfterRepDeposit = targetRepDeposit - vaultRepBackingToTransferAttoRep
	const remainingTargetCoverageCommitmentAttoEth = targetCoverageCommitmentAttoEth - coverageCommitmentToTransferAttoEth - badDebtAttoEth
	const callerAfterRepDeposit = callerRepDeposit + vaultRepBackingToTransferAttoRep
	const resultingCallerCoverageCommitmentAttoEth = callerCoverageCommitmentAttoEth + coverageCommitmentToTransferAttoEth
	return {
		callerAfter: {
			disputeStakedRepAttoRep: callerDisputeStakedRepAttoRep,
			vaultRepBackingAttoRep: callerAfterRepDeposit,
			coverageCommitmentAttoEth: resultingCallerCoverageCommitmentAttoEth,
		},
		callerBefore: {
			disputeStakedRepAttoRep: callerDisputeStakedRepAttoRep,
			vaultRepBackingAttoRep: callerRepDeposit,
			coverageCommitmentAttoEth: callerCoverageCommitmentAttoEth,
		},
		badDebtAttoEth,
		coverageCommitmentToTransferAttoEth,
		grossRepAwardAttoRep,
		vaultRepBackingToTransferAttoRep,
		targetAccruedFeesRetained: targetVaultSummary.claimableFeesAttoEth,
		targetAfter: {
			disputeStakedRepAttoRep: targetDisputeStakedRepAttoRep,
			vaultRepBackingAttoRep: targetAfterRepDeposit,
			coverageCommitmentAttoEth: remainingTargetCoverageCommitmentAttoEth,
		},
		targetBefore: {
			disputeStakedRepAttoRep: targetDisputeStakedRepAttoRep,
			vaultRepBackingAttoRep: targetRepDeposit,
			coverageCommitmentAttoEth: targetCoverageCommitmentAttoEth,
		},
	}
}

export function getDeterministicLiquidationFailureReason({
	callerVaultSummary,
	coverageCommitmentTransferAttoEth,
	maxCoverageCommitmentToTransferAttoEth,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	coverageCommitmentTransferAttoEth: bigint | undefined
	maxCoverageCommitmentToTransferAttoEth?: bigint | undefined
	repPerEthPrice?: bigint | undefined
	statoblastSecurityMultiplierBps?: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (coverageCommitmentTransferAttoEth === undefined) return 'Enter a valid liquidation amount.'
	if (coverageCommitmentTransferAttoEth <= 0n) return 'Enter a liquidation amount greater than zero.'
	if (targetVaultSummary === undefined) return 'Target vault details are still loading.'
	if (targetVaultSummary.coverageCommitmentAttoEth === 0n) return 'This vault has no active coverage commitment to liquidate.'
	if (repPerEthPrice !== undefined && statoblastSecurityMultiplierBps !== undefined && !isVaultLiquidatable(repPerEthPrice, targetVaultSummary.coverageCommitmentAttoEth, targetVaultSummary.vaultRepBackingAttoRep, targetVaultSummary.disputeStakedRepAttoRep, statoblastSecurityMultiplierBps)) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const targetMaxCoverageCommitmentToTransferAttoEth = maxCoverageCommitmentToTransferAttoEth === undefined || maxCoverageCommitmentToTransferAttoEth > targetVaultSummary.coverageCommitmentAttoEth ? targetVaultSummary.coverageCommitmentAttoEth : maxCoverageCommitmentToTransferAttoEth
	const requestedCommitmentTransferAttoEth = coverageCommitmentTransferAttoEth < targetMaxCoverageCommitmentToTransferAttoEth ? coverageCommitmentTransferAttoEth : targetMaxCoverageCommitmentToTransferAttoEth
	const { badDebtAttoEth, coverageCommitmentToTransferAttoEth } =
		repPerEthPrice === undefined ? { badDebtAttoEth: 0n, coverageCommitmentToTransferAttoEth: requestedCommitmentTransferAttoEth } : getFundedLiquidationAmounts(requestedCommitmentTransferAttoEth, targetVaultSummary, repPerEthPrice, callerVaultSummary?.coverageCommitmentAttoEth ?? 0n)
	if (coverageCommitmentToTransferAttoEth <= 0n && badDebtAttoEth <= 0n) return liquidationCopy.executableCoverageCommitmentUnavailable
	const vaultRepBackingToTransferAttoRep = repPerEthPrice === undefined ? undefined : getPartialLiquidationTransfer(coverageCommitmentToTransferAttoEth, targetVaultSummary, repPerEthPrice).vaultRepBackingToTransferAttoRep
	const remainingTargetCoverageCommitmentAttoEth = targetVaultSummary.coverageCommitmentAttoEth - coverageCommitmentToTransferAttoEth - badDebtAttoEth
	const targetAfterRepDeposit = vaultRepBackingToTransferAttoRep === undefined ? undefined : targetVaultSummary.vaultRepBackingAttoRep - vaultRepBackingToTransferAttoRep
	const callerAfterRepDeposit = (callerVaultSummary?.vaultRepBackingAttoRep ?? 0n) + (vaultRepBackingToTransferAttoRep ?? 0n)
	const resultingCallerCoverageCommitmentAttoEth = (callerVaultSummary?.coverageCommitmentAttoEth ?? 0n) + coverageCommitmentToTransferAttoEth
	if (remainingTargetCoverageCommitmentAttoEth !== 0n && targetAfterRepDeposit !== undefined && targetAfterRepDeposit < MIN_REP_DEPOSIT_ATTO_REP) return 'The target vault would fall below the minimum REP backing after liquidation.'
	if (remainingTargetCoverageCommitmentAttoEth !== 0n && remainingTargetCoverageCommitmentAttoEth < MIN_COVERAGE_COMMITMENT_ATTO_ETH) return 'The target vault would fall below the minimum coverage commitment after liquidation.'
	if (coverageCommitmentToTransferAttoEth !== 0n && callerAfterRepDeposit < MIN_REP_DEPOSIT_ATTO_REP) return 'Your vault would remain below the minimum REP backing after liquidation.'
	if (coverageCommitmentToTransferAttoEth !== 0n && resultingCallerCoverageCommitmentAttoEth < MIN_COVERAGE_COMMITMENT_ATTO_ETH) return 'Your vault would remain below the minimum coverage commitment after liquidation.'
	return undefined
}

export function getLiquidationFailureReason({
	callerVaultSummary,
	coverageCommitmentTransferAttoEth,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	coverageCommitmentTransferAttoEth: bigint | undefined
	repPerEthPrice: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (
		repPerEthPrice !== undefined &&
		statoblastSecurityMultiplierBps !== undefined &&
		targetVaultSummary !== undefined &&
		!isVaultLiquidatable(repPerEthPrice, targetVaultSummary.coverageCommitmentAttoEth, targetVaultSummary.vaultRepBackingAttoRep, targetVaultSummary.disputeStakedRepAttoRep, statoblastSecurityMultiplierBps)
	) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const deterministicFailureReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		coverageCommitmentTransferAttoEth,
		maxCoverageCommitmentToTransferAttoEth: (() => {
			const computedMaxCoverageCommitmentToTransferAttoEth = getMaxLiquidationAmount({
				repPerEthPrice,
				statoblastSecurityMultiplierBps,
				targetVaultSummary,
			})
			return computedMaxCoverageCommitmentToTransferAttoEth
		})(),
		repPerEthPrice,
		statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	if (deterministicFailureReason !== undefined) return deterministicFailureReason
	if (coverageCommitmentTransferAttoEth === undefined) return 'Enter a valid liquidation amount.'
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined) return 'Refresh the Open Oracle before executing liquidation.'
	if (targetVaultSummary === undefined) return 'Target vault details are still loading.'

	const simulation = simulateLiquidation({
		callerVaultSummary,
		coverageCommitmentTransferAttoEth,
		repPerEthPrice,
		statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	if (isVaultLiquidatable(repPerEthPrice, simulation.callerAfter.coverageCommitmentAttoEth, simulation.callerAfter.vaultRepBackingAttoRep, simulation.callerAfter.disputeStakedRepAttoRep, statoblastSecurityMultiplierBps)) {
		if (isVaultLiquidatable(repPerEthPrice, simulation.callerBefore.coverageCommitmentAttoEth, simulation.callerBefore.vaultRepBackingAttoRep, callerVaultSummary?.disputeStakedRepAttoRep, statoblastSecurityMultiplierBps)) return 'Your vault would remain liquidatable after this liquidation.'
		return 'Your vault would become liquidatable after this liquidation.'
	}
	return undefined
}
