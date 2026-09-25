import { coverageObligation } from '@zoltar/statoblast-shared/statoblast/coverage'
import * as liquidationCopy from '../../../copy/liquidation.js'
import { LIQUIDATION_BPS_DENOMINATOR, LIQUIDATION_PRICE_PRECISION, LIQUIDATION_REP_BONUS_BPS, getLiquidationVaultRepBackingToTransfer, getMaximumFundedDebtAttoEth } from '@zoltar/statoblast-shared/statoblast/liquidation'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import type { SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js'

const DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH = DEFAULT_PROTOCOL_CONFIG.minimumSecurityBondDebtAttoEth
const DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP = 10n * 10n ** 18n

function getVaultOpenInterestAttoEth(vault: SecurityPoolVaultSummary) {
	return vault.openInterestAttoEth
}

function requireVaultOpenInterestAttoEth(vault: SecurityPoolVaultSummary) {
	const openInterestAttoEth = getVaultOpenInterestAttoEth(vault)
	if (openInterestAttoEth === undefined) throw new Error('Vault live open interest is still loading')
	return openInterestAttoEth
}

function requireVaultObligationUnits(vault: SecurityPoolVaultSummary) {
	if (vault.obligationUnits === undefined) throw new Error('Vault obligation units are still loading')
	return vault.obligationUnits
}

function calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth: bigint, obligationUnits: bigint, totalObligationUnits: bigint) {
	return coverageObligation(settlementCollateralAttoEth, obligationUnits, totalObligationUnits)
}

function calculateLiveVaultOpenInterestAfterOwnershipChange({ capacityOwnershipAfterAttoRep, totalObligationUnits, settlementCollateralAttoEth }: { capacityOwnershipAfterAttoRep: bigint; totalObligationUnits: bigint; settlementCollateralAttoEth: bigint }) {
	const grossOpenInterestAfterAttoEth = calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth, capacityOwnershipAfterAttoRep, totalObligationUnits)
	return grossOpenInterestAfterAttoEth
}

function mulDivCeil(value: bigint, multiplier: bigint, denominator: bigint) {
	const product = value * multiplier
	return product === 0n ? 0n : (product - 1n) / denominator + 1n
}

export function isVaultHealthyAtFactor({
	disputeStakedAttoRep = 0n,
	healthFactorBps,
	openInterestAttoEth,
	poolHeldVaultRepBackingAttoRep,
	poolSecurityMultiplierBps,
	repPerEthPrice,
}: {
	disputeStakedAttoRep?: bigint | undefined
	healthFactorBps: bigint
	openInterestAttoEth: bigint
	poolHeldVaultRepBackingAttoRep: bigint
	poolSecurityMultiplierBps: bigint
	repPerEthPrice: bigint
}) {
	if (healthFactorBps < LIQUIDATION_BPS_DENOMINATOR) return false
	if (openInterestAttoEth === 0n) return true
	const baseRequiredRepAttoRep = mulDivCeil(openInterestAttoEth, repPerEthPrice, LIQUIDATION_PRICE_PRECISION)
	const associatedRequiredAttoRep = mulDivCeil(mulDivCeil(baseRequiredRepAttoRep, poolSecurityMultiplierBps, LIQUIDATION_BPS_DENOMINATOR), healthFactorBps, LIQUIDATION_BPS_DENOMINATOR)
	if (poolHeldVaultRepBackingAttoRep + disputeStakedAttoRep < associatedRequiredAttoRep) return false
	const configuredMigrationMultiplierBps = LIQUIDATION_BPS_DENOMINATOR + (poolSecurityMultiplierBps - LIQUIDATION_BPS_DENOMINATOR) / 2n
	const liquidationReserveMultiplierBps = LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS
	const migrationMultiplierBps = configuredMigrationMultiplierBps < liquidationReserveMultiplierBps ? liquidationReserveMultiplierBps : configuredMigrationMultiplierBps
	const freeRequiredAttoRep = mulDivCeil(mulDivCeil(baseRequiredRepAttoRep, migrationMultiplierBps, LIQUIDATION_BPS_DENOMINATOR), healthFactorBps, LIQUIDATION_BPS_DENOMINATOR)
	return poolHeldVaultRepBackingAttoRep >= freeRequiredAttoRep
}

function isVaultLiquidatable(lastPrice: bigint | undefined, openInterestAttoEth: bigint | undefined, vaultAttoRepBacking: bigint | undefined, disputeStakedAttoRep: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (lastPrice === undefined || openInterestAttoEth === undefined || vaultAttoRepBacking === undefined || statoblastSecurityMultiplierBps === undefined) return false
	return !isVaultHealthyAtFactor({ disputeStakedAttoRep, healthFactorBps: LIQUIDATION_BPS_DENOMINATOR, openInterestAttoEth, poolHeldVaultRepBackingAttoRep: vaultAttoRepBacking, poolSecurityMultiplierBps: statoblastSecurityMultiplierBps, repPerEthPrice: lastPrice })
}

function getPartialLiquidationTransfer(debtMovedAttoEth: bigint, targetVaultSummary: SecurityPoolVaultSummary, repPerEthPrice: bigint) {
	const quotedRep = getLiquidationVaultRepBackingToTransfer(debtMovedAttoEth, repPerEthPrice)
	const { repBackingUnits, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep } = targetVaultSummary
	if (repBackingUnits === undefined || totalRepBackingUnits === undefined || totalPoolHeldRepBalanceAttoRep === undefined) {
		if (quotedRep >= targetVaultSummary.vaultAttoRepBacking) return { remainingAttoRep: 0n, vaultAttoRepBackingToTransfer: targetVaultSummary.vaultAttoRepBacking }
		return { remainingAttoRep: targetVaultSummary.vaultAttoRepBacking - quotedRep, vaultAttoRepBackingToTransfer: quotedRep }
	}
	const backingUnitsToTransfer = totalRepBackingUnits === 0n || totalPoolHeldRepBalanceAttoRep === 0n ? quotedRep * LIQUIDATION_PRICE_PRECISION : (quotedRep * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
	if (backingUnitsToTransfer >= repBackingUnits) return { remainingAttoRep: 0n, vaultAttoRepBackingToTransfer: targetVaultSummary.vaultAttoRepBacking }
	const remainingBackingUnits = repBackingUnits - backingUnitsToTransfer
	return {
		remainingAttoRep: totalRepBackingUnits === 0n ? remainingBackingUnits / LIQUIDATION_PRICE_PRECISION : (remainingBackingUnits * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits,
		vaultAttoRepBackingToTransfer: totalRepBackingUnits === 0n ? backingUnitsToTransfer / LIQUIDATION_PRICE_PRECISION : (backingUnitsToTransfer * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits,
	}
}

function getAwardableLiquidationRep(targetVaultSummary: SecurityPoolVaultSummary, reserveMinimumRep: boolean, minimumVaultRepDepositAttoRep: bigint) {
	const { repBackingUnits, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep } = targetVaultSummary
	if (repBackingUnits === undefined || totalRepBackingUnits === undefined || totalPoolHeldRepBalanceAttoRep === undefined) {
		if (!reserveMinimumRep) return targetVaultSummary.vaultAttoRepBacking
		return targetVaultSummary.vaultAttoRepBacking > minimumVaultRepDepositAttoRep ? targetVaultSummary.vaultAttoRepBacking - minimumVaultRepDepositAttoRep : 0n
	}
	let reserveBackingUnits = 0n
	if (reserveMinimumRep) {
		reserveBackingUnits = totalRepBackingUnits === 0n || totalPoolHeldRepBalanceAttoRep === 0n ? minimumVaultRepDepositAttoRep * LIQUIDATION_PRICE_PRECISION : (minimumVaultRepDepositAttoRep * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
	}
	if (reserveBackingUnits >= repBackingUnits) return 0n
	const awardableBackingUnits = repBackingUnits - reserveBackingUnits
	return totalRepBackingUnits === 0n ? awardableBackingUnits / LIQUIDATION_PRICE_PRECISION : (awardableBackingUnits * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits
}

function getFundedLiquidationAmounts(requestedDebtAttoEth: bigint, targetVaultSummary: SecurityPoolVaultSummary, receiverVaultSummary: SecurityPoolVaultSummary | undefined, repPerEthPrice: bigint, minimumVaultRepDepositAttoRep: bigint, settlementCollateralAttoEth: bigint, totalObligationUnits: bigint) {
	const targetObligationUnits = requireVaultObligationUnits(targetVaultSummary)
	const targetOpenInterestAttoEth = requireVaultOpenInterestAttoEth(targetVaultSummary)
	const resolveResidualAsBadDebt = requestedDebtAttoEth >= targetOpenInterestAttoEth
	if (targetOpenInterestAttoEth === 0n) return { badDebtAttoEth: 0n, obligationUnitsMoved: 0n, debtMovedAttoEth: 0n }
	const awardableAttoRep = getAwardableLiquidationRep(targetVaultSummary, !resolveResidualAsBadDebt, minimumVaultRepDepositAttoRep)
	const maximumFundedDebtAttoEth = getMaximumFundedDebtAttoEth(awardableAttoRep, repPerEthPrice)
	const boundedRequestedDebtAttoEth = requestedDebtAttoEth < targetOpenInterestAttoEth ? requestedDebtAttoEth : targetOpenInterestAttoEth
	const nominalDebtToMoveAttoEth = boundedRequestedDebtAttoEth < maximumFundedDebtAttoEth ? boundedRequestedDebtAttoEth : maximumFundedDebtAttoEth
	const obligationUnitsMoved = nominalDebtToMoveAttoEth === targetOpenInterestAttoEth ? targetObligationUnits : (targetObligationUnits * nominalDebtToMoveAttoEth) / targetOpenInterestAttoEth
	if (obligationUnitsMoved === 0n) return { badDebtAttoEth: resolveResidualAsBadDebt && nominalDebtToMoveAttoEth === 0n ? targetOpenInterestAttoEth : 0n, obligationUnitsMoved: 0n, debtMovedAttoEth: 0n }
	const receiverCapacityOwnershipBeforeAttoRep = receiverVaultSummary === undefined ? 0n : requireVaultObligationUnits(receiverVaultSummary)
	const receiverOpenInterestBeforeAttoEth = receiverVaultSummary === undefined ? 0n : requireVaultOpenInterestAttoEth(receiverVaultSummary)
	const receiverOpenInterestAfterAttoEth = calculateLiveVaultOpenInterestAfterOwnershipChange({
		capacityOwnershipAfterAttoRep: receiverCapacityOwnershipBeforeAttoRep + obligationUnitsMoved,
		totalObligationUnits,
		settlementCollateralAttoEth,
	})
	const debtMovedAttoEth = receiverOpenInterestAfterAttoEth >= receiverOpenInterestBeforeAttoEth ? receiverOpenInterestAfterAttoEth - receiverOpenInterestBeforeAttoEth : 0n
	if (debtMovedAttoEth === 0n || debtMovedAttoEth > nominalDebtToMoveAttoEth) return { badDebtAttoEth: 0n, obligationUnitsMoved: 0n, debtMovedAttoEth: 0n }
	const badDebtAttoEth = resolveResidualAsBadDebt ? calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth, targetObligationUnits - obligationUnitsMoved, totalObligationUnits) : 0n
	return { badDebtAttoEth, obligationUnitsMoved, debtMovedAttoEth }
}

export function getLiquidationExecutionFailureDetail(errorMessage: string | undefined) {
	switch (errorMessage) {
		case 'Target safe':
			return liquidationCopy.targetNotLiquidatableError
		case 'No liq':
			return liquidationCopy.executableCapacityOwnershipUnavailable
		case 'Receiver bad':
			return liquidationCopy.callerVaultHealthOrIdentityError
		case 'Target REP':
			return liquidationCopy.targetMinimumCollateralError
		case 'Target debt':
			return liquidationCopy.targetMinimumDebtError
		case 'Receiver REP':
			return liquidationCopy.callerMinimumCollateralError
		case 'Receiver debt below minimum':
			return liquidationCopy.callerMinimumCapacityOwnershipError
		default:
			return errorMessage
	}
}

export function getMaxLiquidationAmount({ repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary }: { repPerEthPrice: bigint | undefined; statoblastSecurityMultiplierBps: bigint | undefined; targetVaultSummary: SecurityPoolVaultSummary | undefined }) {
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined || targetVaultSummary === undefined) return undefined
	if (repPerEthPrice <= 0n || statoblastSecurityMultiplierBps <= 0n) return 0n
	const targetRepDeposit = targetVaultSummary.vaultAttoRepBacking
	const targetOpenInterestAttoEth = getVaultOpenInterestAttoEth(targetVaultSummary)
	if (targetOpenInterestAttoEth === undefined) return undefined
	if (targetOpenInterestAttoEth === 0n) return 0n
	if (!isVaultLiquidatable(repPerEthPrice, targetOpenInterestAttoEth, targetRepDeposit, targetVaultSummary.disputeStakedAttoRep, statoblastSecurityMultiplierBps)) return 0n
	return targetOpenInterestAttoEth
}

type LiquidationSimulation = {
	callerAfter: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		obligationUnits: bigint
	}
	callerBefore: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		obligationUnits: bigint
	}
	debtMovedAttoEth: bigint
	obligationUnitsMoved: bigint
	badDebtAttoEth: bigint
	grossRepAwardAttoRep: bigint
	vaultAttoRepBackingToTransfer: bigint
	targetAccruedFeesRetained: bigint
	targetAfter: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		obligationUnits: bigint
	}
	targetBefore: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		obligationUnits: bigint
	}
}

export function simulateLiquidation({
	callerVaultSummary,
	requestedDebtAttoEth,
	totalObligationUnits,
	minimumVaultRepDepositAttoRep = DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP,
	repPerEthPrice,
	settlementCollateralAttoEth,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	requestedDebtAttoEth: bigint
	totalObligationUnits: bigint
	minimumVaultRepDepositAttoRep?: bigint | undefined
	repPerEthPrice: bigint
	settlementCollateralAttoEth: bigint
	statoblastSecurityMultiplierBps: bigint
	targetVaultSummary: SecurityPoolVaultSummary
}): LiquidationSimulation {
	const callerRepDeposit = callerVaultSummary?.vaultAttoRepBacking ?? 0n
	const callerDisputeStakedAttoRep = callerVaultSummary?.disputeStakedAttoRep ?? 0n
	const callerCapacityOwnershipAttoRep = callerVaultSummary === undefined ? 0n : requireVaultObligationUnits(callerVaultSummary)
	const targetRepDeposit = targetVaultSummary.vaultAttoRepBacking
	const targetDisputeStakedAttoRep = targetVaultSummary.disputeStakedAttoRep
	const targetObligationUnits = requireVaultObligationUnits(targetVaultSummary)
	const targetOpenInterestAttoEth = requireVaultOpenInterestAttoEth(targetVaultSummary)
	const maxLiquidationDebtAttoEth =
		getMaxLiquidationAmount({
			repPerEthPrice,
			statoblastSecurityMultiplierBps,
			targetVaultSummary,
		}) ?? targetOpenInterestAttoEth
	const { badDebtAttoEth, obligationUnitsMoved, debtMovedAttoEth } = getFundedLiquidationAmounts(
		requestedDebtAttoEth < maxLiquidationDebtAttoEth ? requestedDebtAttoEth : maxLiquidationDebtAttoEth,
		targetVaultSummary,
		callerVaultSummary,
		repPerEthPrice,
		minimumVaultRepDepositAttoRep,
		settlementCollateralAttoEth,
		totalObligationUnits,
	)
	const grossRepAwardAttoRep = getLiquidationVaultRepBackingToTransfer(debtMovedAttoEth, repPerEthPrice)
	const vaultAttoRepBackingToTransfer = getPartialLiquidationTransfer(debtMovedAttoEth, targetVaultSummary, repPerEthPrice).vaultAttoRepBackingToTransfer
	const targetAfterRepDeposit = targetRepDeposit - vaultAttoRepBackingToTransfer
	const remainingTargetCapacityOwnershipAttoRep = badDebtAttoEth > 0n ? 0n : targetObligationUnits - obligationUnitsMoved
	const callerAfterRepDeposit = callerRepDeposit + vaultAttoRepBackingToTransfer
	const resultingCallerCapacityOwnershipAttoRep = callerCapacityOwnershipAttoRep + obligationUnitsMoved
	return {
		callerAfter: {
			disputeStakedAttoRep: callerDisputeStakedAttoRep,
			vaultAttoRepBacking: callerAfterRepDeposit,
			obligationUnits: resultingCallerCapacityOwnershipAttoRep,
		},
		callerBefore: {
			disputeStakedAttoRep: callerDisputeStakedAttoRep,
			vaultAttoRepBacking: callerRepDeposit,
			obligationUnits: callerCapacityOwnershipAttoRep,
		},
		badDebtAttoEth,
		obligationUnitsMoved,
		debtMovedAttoEth,
		grossRepAwardAttoRep,
		vaultAttoRepBackingToTransfer,
		targetAccruedFeesRetained: targetVaultSummary.claimableFeesAttoEth,
		targetAfter: {
			disputeStakedAttoRep: targetDisputeStakedAttoRep,
			vaultAttoRepBacking: targetAfterRepDeposit,
			obligationUnits: remainingTargetCapacityOwnershipAttoRep,
		},
		targetBefore: {
			disputeStakedAttoRep: targetDisputeStakedAttoRep,
			vaultAttoRepBacking: targetRepDeposit,
			obligationUnits: targetObligationUnits,
		},
	}
}

export function getDeterministicLiquidationFailureReason({
	callerVaultSummary,
	requestedDebtAttoEth,
	totalObligationUnits,
	maxLiquidationDebtAttoEth,
	minimumSecurityBondDebtAttoEth = DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH,
	minimumVaultRepDepositAttoRep = DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP,
	repPerEthPrice,
	settlementCollateralAttoEth,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	requestedDebtAttoEth: bigint | undefined
	totalObligationUnits?: bigint | undefined
	maxLiquidationDebtAttoEth?: bigint | undefined
	minimumSecurityBondDebtAttoEth?: bigint | undefined
	minimumVaultRepDepositAttoRep?: bigint | undefined
	repPerEthPrice?: bigint | undefined
	settlementCollateralAttoEth?: bigint | undefined
	statoblastSecurityMultiplierBps?: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (requestedDebtAttoEth === undefined) return 'Enter a valid liquidation amount.'
	if (requestedDebtAttoEth <= 0n) return 'Enter a liquidation amount greater than zero.'
	if (targetVaultSummary === undefined) return 'Target vault details are still loading.'
	const targetOpenInterestAttoEth = getVaultOpenInterestAttoEth(targetVaultSummary)
	if (targetOpenInterestAttoEth === undefined) return 'Target vault live open interest is still loading.'
	if (targetOpenInterestAttoEth === 0n) return 'This vault has no open interest to liquidate.'
	if (targetVaultSummary.obligationUnits === undefined || totalObligationUnits === undefined || (callerVaultSummary !== undefined && callerVaultSummary.obligationUnits === undefined)) return 'Assigned coverage is still loading.'
	if (repPerEthPrice !== undefined && statoblastSecurityMultiplierBps !== undefined && !isVaultLiquidatable(repPerEthPrice, targetOpenInterestAttoEth, targetVaultSummary.vaultAttoRepBacking, targetVaultSummary.disputeStakedAttoRep, statoblastSecurityMultiplierBps)) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const targetMaxLiquidationDebtAttoEth = maxLiquidationDebtAttoEth === undefined || maxLiquidationDebtAttoEth > targetOpenInterestAttoEth ? targetOpenInterestAttoEth : maxLiquidationDebtAttoEth
	const boundedRequestedDebtAttoEth = requestedDebtAttoEth < targetMaxLiquidationDebtAttoEth ? requestedDebtAttoEth : targetMaxLiquidationDebtAttoEth
	if (repPerEthPrice === undefined || settlementCollateralAttoEth === undefined || totalObligationUnits === undefined) return undefined
	const { badDebtAttoEth, obligationUnitsMoved, debtMovedAttoEth } = getFundedLiquidationAmounts(boundedRequestedDebtAttoEth, targetVaultSummary, callerVaultSummary, repPerEthPrice, minimumVaultRepDepositAttoRep, settlementCollateralAttoEth, totalObligationUnits)
	if ((debtMovedAttoEth <= 0n || obligationUnitsMoved === 0n) && badDebtAttoEth <= 0n) return liquidationCopy.executableCapacityOwnershipUnavailable
	const vaultAttoRepBackingToTransfer = getPartialLiquidationTransfer(debtMovedAttoEth, targetVaultSummary, repPerEthPrice).vaultAttoRepBackingToTransfer
	const remainingTargetCapacityOwnershipAttoRep = badDebtAttoEth > 0n ? 0n : requireVaultObligationUnits(targetVaultSummary) - obligationUnitsMoved
	const remainingTargetDebtAttoEth = calculateLiveVaultOpenInterestAfterOwnershipChange({
		capacityOwnershipAfterAttoRep: remainingTargetCapacityOwnershipAttoRep,
		totalObligationUnits,
		settlementCollateralAttoEth,
	})
	const targetAfterRepDeposit = vaultAttoRepBackingToTransfer === undefined ? undefined : targetVaultSummary.vaultAttoRepBacking - vaultAttoRepBackingToTransfer
	const callerAfterRepDeposit = (callerVaultSummary?.vaultAttoRepBacking ?? 0n) + (vaultAttoRepBackingToTransfer ?? 0n)
	const resultingCallerCapacityOwnershipAttoRep = (callerVaultSummary === undefined ? 0n : requireVaultObligationUnits(callerVaultSummary)) + obligationUnitsMoved
	const callerOpenInterestAttoEth = callerVaultSummary === undefined ? 0n : getVaultOpenInterestAttoEth(callerVaultSummary)
	if (callerOpenInterestAttoEth === undefined) return 'Receiver vault live open interest is still loading.'
	const resultingReceiverDebtAttoEth = callerOpenInterestAttoEth + debtMovedAttoEth
	if (remainingTargetDebtAttoEth !== 0n && targetAfterRepDeposit !== undefined && targetAfterRepDeposit < minimumVaultRepDepositAttoRep) return 'The target vault would fall below the minimum REP backing after liquidation.'
	if (remainingTargetDebtAttoEth !== 0n && remainingTargetDebtAttoEth < minimumSecurityBondDebtAttoEth) return 'The target vault would fall below the minimum security-bond debt after liquidation.'
	if (debtMovedAttoEth !== 0n && callerAfterRepDeposit < minimumVaultRepDepositAttoRep) return 'The receiver vault would remain below the minimum REP backing after liquidation.'
	if (debtMovedAttoEth !== 0n && resultingReceiverDebtAttoEth < minimumSecurityBondDebtAttoEth) return 'The selected receiver would remain below the minimum security-bond debt after liquidation.'
	if (debtMovedAttoEth !== 0n && resultingCallerCapacityOwnershipAttoRep === 0n) return 'No capacity ownership would move with the liquidation debt.'
	return undefined
}

export function getLiquidationFailureReason({
	callerVaultSummary,
	requestedDebtAttoEth,
	totalObligationUnits,
	minimumReceiverHealthFactorBps = LIQUIDATION_BPS_DENOMINATOR,
	minimumSecurityBondDebtAttoEth = DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH,
	minimumVaultRepDepositAttoRep = DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP,
	repPerEthPrice,
	settlementCollateralAttoEth,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	requestedDebtAttoEth: bigint | undefined
	totalObligationUnits: bigint
	minimumReceiverHealthFactorBps?: bigint | undefined
	minimumSecurityBondDebtAttoEth?: bigint | undefined
	minimumVaultRepDepositAttoRep?: bigint | undefined
	repPerEthPrice: bigint | undefined
	settlementCollateralAttoEth: bigint
	statoblastSecurityMultiplierBps: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	const targetOpenInterestAttoEth = targetVaultSummary === undefined ? undefined : getVaultOpenInterestAttoEth(targetVaultSummary)
	if (
		repPerEthPrice !== undefined &&
		statoblastSecurityMultiplierBps !== undefined &&
		targetVaultSummary !== undefined &&
		targetOpenInterestAttoEth !== undefined &&
		!isVaultLiquidatable(repPerEthPrice, targetOpenInterestAttoEth, targetVaultSummary.vaultAttoRepBacking, targetVaultSummary.disputeStakedAttoRep, statoblastSecurityMultiplierBps)
	) {
		return 'This vault is not undercollateralized at the current Open Oracle price.'
	}
	const deterministicFailureReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		requestedDebtAttoEth,
		totalObligationUnits,
		maxLiquidationDebtAttoEth: (() => {
			const computedMaxLiquidationDebtAttoEth = getMaxLiquidationAmount({
				repPerEthPrice,
				statoblastSecurityMultiplierBps,
				targetVaultSummary,
			})
			return computedMaxLiquidationDebtAttoEth
		})(),
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		repPerEthPrice,
		settlementCollateralAttoEth,
		statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	if (deterministicFailureReason !== undefined) return deterministicFailureReason
	if (requestedDebtAttoEth === undefined) return 'Enter a valid liquidation amount.'
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined) return 'Refresh the Open Oracle before executing liquidation.'
	if (targetVaultSummary === undefined) return 'Target vault details are still loading.'

	const simulation = simulateLiquidation({
		callerVaultSummary,
		requestedDebtAttoEth,
		totalObligationUnits,
		minimumVaultRepDepositAttoRep,
		repPerEthPrice,
		settlementCollateralAttoEth,
		statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const callerOpenInterestBeforeAttoEth = callerVaultSummary === undefined ? 0n : requireVaultOpenInterestAttoEth(callerVaultSummary)
	const callerOpenInterestAfterAttoEth = callerOpenInterestBeforeAttoEth + simulation.debtMovedAttoEth
	const receiverHealthyAtRequiredFactor = isVaultHealthyAtFactor({
		disputeStakedAttoRep: simulation.callerAfter.disputeStakedAttoRep,
		healthFactorBps: minimumReceiverHealthFactorBps,
		openInterestAttoEth: callerOpenInterestAfterAttoEth,
		poolHeldVaultRepBackingAttoRep: simulation.callerAfter.vaultAttoRepBacking,
		poolSecurityMultiplierBps: statoblastSecurityMultiplierBps,
		repPerEthPrice,
	})
	if (!receiverHealthyAtRequiredFactor) {
		if (minimumReceiverHealthFactorBps > LIQUIDATION_BPS_DENOMINATOR) return liquidationCopy.receiverBelowApprovedHealthFactor
		if (isVaultLiquidatable(repPerEthPrice, callerOpenInterestBeforeAttoEth, simulation.callerBefore.vaultAttoRepBacking, callerVaultSummary?.disputeStakedAttoRep, statoblastSecurityMultiplierBps)) return 'The receiver vault would remain liquidatable after this liquidation.'
		return 'The receiver vault would become liquidatable after this liquidation.'
	}
	return undefined
}
