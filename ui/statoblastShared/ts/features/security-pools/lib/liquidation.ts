import * as liquidationCopy from '../../../copy/liquidation.js'
import { LIQUIDATION_BPS_DENOMINATOR, LIQUIDATION_PRICE_PRECISION, getLiquidationMigrationSecurityMultiplierBps, getLiquidationVaultRepBackingToTransfer } from '@zoltar/statoblast-shared/statoblast/liquidation'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { formatScaledPercentage } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'

const DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH = DEFAULT_PROTOCOL_CONFIG.minimumSecurityBondDebtAttoEth
const DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP = 10n * 10n ** 18n

function getVaultOpenInterestAttoEth(vault: SecurityPoolVaultSummary) {
	return vault.underwritingLimitAttoEth
}

function requireVaultOpenInterestAttoEth(vault: SecurityPoolVaultSummary) {
	const openInterestAttoEth = getVaultOpenInterestAttoEth(vault)
	if (openInterestAttoEth === undefined) throw new Error('Vault live open interest is still loading')
	return openInterestAttoEth
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
	const migrationMultiplierBps = getLiquidationMigrationSecurityMultiplierBps(poolSecurityMultiplierBps)
	const freeRequiredAttoRep = mulDivCeil(mulDivCeil(baseRequiredRepAttoRep, migrationMultiplierBps, LIQUIDATION_BPS_DENOMINATOR), healthFactorBps, LIQUIDATION_BPS_DENOMINATOR)
	return poolHeldVaultRepBackingAttoRep >= freeRequiredAttoRep
}

/**
 * Mirrors `SecurityPoolUtils._isLiquidationBeyondMinPriceDistance`, including its integer rounding.
 * @internal Exported for regression tests of the contract port.
 */
export function isLiquidationBeyondMinPriceDistance({
	currentPrice,
	disputeStakedAttoRep,
	minPriceDistanceBps,
	openInterestAttoEth,
	poolHeldVaultRepBackingAttoRep,
	poolSecurityMultiplierBps,
}: {
	currentPrice: bigint
	disputeStakedAttoRep: bigint
	minPriceDistanceBps: bigint
	openInterestAttoEth: bigint
	poolHeldVaultRepBackingAttoRep: bigint
	poolSecurityMultiplierBps: bigint
}) {
	if (minPriceDistanceBps === 0n) return true
	if (openInterestAttoEth === 0n || currentPrice === 0n) return false
	// The contract reverts on these inputs, so the liquidation cannot pass the check.
	if (poolSecurityMultiplierBps < LIQUIDATION_BPS_DENOMINATOR) return false
	const valueScale = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR
	const associatedRepThreshold = ((poolHeldVaultRepBackingAttoRep + disputeStakedAttoRep) * valueScale) / (openInterestAttoEth * poolSecurityMultiplierBps)
	const migrationSecurityMultiplierBps = getLiquidationMigrationSecurityMultiplierBps(poolSecurityMultiplierBps)
	const migrationThreshold = (poolHeldVaultRepBackingAttoRep * valueScale) / (openInterestAttoEth * migrationSecurityMultiplierBps)
	const thresholdPrice = associatedRepThreshold < migrationThreshold ? associatedRepThreshold : migrationThreshold
	if (currentPrice <= thresholdPrice) return false
	return ((currentPrice - thresholdPrice) * LIQUIDATION_BPS_DENOMINATOR) / currentPrice >= minPriceDistanceBps
}

function isVaultLiquidatable(lastPrice: bigint | undefined, openInterestAttoEth: bigint | undefined, vaultAttoRepBacking: bigint | undefined, disputeStakedAttoRep: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (lastPrice === undefined || openInterestAttoEth === undefined || vaultAttoRepBacking === undefined || statoblastSecurityMultiplierBps === undefined) return false
	return !isVaultHealthyAtFactor({ disputeStakedAttoRep, healthFactorBps: LIQUIDATION_BPS_DENOMINATOR, openInterestAttoEth, poolHeldVaultRepBackingAttoRep: vaultAttoRepBacking, poolSecurityMultiplierBps: statoblastSecurityMultiplierBps, repPerEthPrice: lastPrice })
}

/**
 * Explains why the protocol would reject liquidating the target at this price before any amount is considered,
 * following the contract's target-safe and minimum price distance checks. An undefined
 * `minLiquidationPriceDistanceBps` means the coordinator value has not loaded, so only the health check applies.
 */
function getTargetLiquidatabilityReason({
	minLiquidationPriceDistanceBps,
	openInterestAttoEth,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	minLiquidationPriceDistanceBps: bigint | undefined
	openInterestAttoEth: bigint
	repPerEthPrice: bigint
	statoblastSecurityMultiplierBps: bigint
	targetVaultSummary: SecurityPoolVaultSummary
}) {
	if (!isVaultLiquidatable(repPerEthPrice, openInterestAttoEth, targetVaultSummary.vaultAttoRepBacking, targetVaultSummary.disputeStakedAttoRep, statoblastSecurityMultiplierBps)) return 'This vault is not undercollateralized at the current Open Oracle price.'
	if (
		minLiquidationPriceDistanceBps !== undefined &&
		!isLiquidationBeyondMinPriceDistance({
			currentPrice: repPerEthPrice,
			disputeStakedAttoRep: targetVaultSummary.disputeStakedAttoRep,
			minPriceDistanceBps: minLiquidationPriceDistanceBps,
			openInterestAttoEth,
			poolHeldVaultRepBackingAttoRep: targetVaultSummary.vaultAttoRepBacking,
			poolSecurityMultiplierBps: statoblastSecurityMultiplierBps,
		})
	) {
		return liquidationCopy.formatLiquidationDistanceTooLowReason(formatScaledPercentage(minLiquidationPriceDistanceBps, 2))
	}
	return undefined
}

function getBadDebtReason(targetVaultSummary: SecurityPoolVaultSummary, receiverVaultSummary: SecurityPoolVaultSummary | undefined) {
	if (targetVaultSummary.badDebtAttoEth !== undefined && targetVaultSummary.badDebtAttoEth > 0n) return liquidationCopy.targetBadDebtReason
	if (receiverVaultSummary?.badDebtAttoEth !== undefined && receiverVaultSummary.badDebtAttoEth > 0n) return liquidationCopy.receiverBadDebtReason
	return undefined
}

function getPartialLiquidationTransfer(commitmentAttoEth: bigint, target: SecurityPoolVaultSummary, repPerEthPrice: bigint, minimumVaultRepDepositAttoRep: bigint) {
	const nominalRep = getLiquidationVaultRepBackingToTransfer(commitmentAttoEth, repPerEthPrice)
	const partial = commitmentAttoEth < target.underwritingLimitAttoEth
	const { repBackingUnits, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep } = target
	if (repBackingUnits === undefined || totalRepBackingUnits === undefined || totalPoolHeldRepBalanceAttoRep === undefined) {
		const reserve = partial ? minimumVaultRepDepositAttoRep : 0n
		const available = target.vaultAttoRepBacking > reserve ? target.vaultAttoRepBacking - reserve : 0n
		const award = nominalRep < available ? nominalRep : available
		return { remainingAttoRep: target.vaultAttoRepBacking - award, vaultAttoRepBackingToTransfer: award, backingUnitsToTransfer: undefined }
	}
	const noConversion = totalRepBackingUnits === 0n || totalPoolHeldRepBalanceAttoRep === 0n
	let reserveUnits = 0n
	if (partial && minimumVaultRepDepositAttoRep > 0n) reserveUnits = noConversion ? repBackingUnits : mulDivCeil(minimumVaultRepDepositAttoRep, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep)
	const availableUnits = repBackingUnits > reserveUnits ? repBackingUnits - reserveUnits : 0n
	const nominalUnits = noConversion ? nominalRep * LIQUIDATION_PRICE_PRECISION : mulDivCeil(nominalRep, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep)
	const backingUnitsToTransfer = nominalUnits < availableUnits ? nominalUnits : availableUnits
	return {
		backingUnitsToTransfer,
		remainingAttoRep: totalRepBackingUnits === 0n ? 0n : ((repBackingUnits - backingUnitsToTransfer) * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits,
		vaultAttoRepBackingToTransfer: totalRepBackingUnits === 0n ? 0n : (backingUnitsToTransfer * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits,
	}
}

function receiverBackingAfterTransfer(receiver: SecurityPoolVaultSummary | undefined, target: SecurityPoolVaultSummary, transfer: ReturnType<typeof getPartialLiquidationTransfer>) {
	const receiverUnits = receiver === undefined ? 0n : receiver.repBackingUnits
	if (receiverUnits !== undefined && transfer.backingUnitsToTransfer !== undefined && target.totalRepBackingUnits !== undefined && target.totalPoolHeldRepBalanceAttoRep !== undefined) {
		return target.totalRepBackingUnits === 0n ? 0n : ((receiverUnits + transfer.backingUnitsToTransfer) * target.totalPoolHeldRepBalanceAttoRep) / target.totalRepBackingUnits
	}
	return (receiver?.vaultAttoRepBacking ?? 0n) + transfer.vaultAttoRepBackingToTransfer
}

function getFundedLiquidationAmounts(requestedDebtAttoEth: bigint, targetVaultSummary: SecurityPoolVaultSummary, _receiverVaultSummary: SecurityPoolVaultSummary | undefined, _repPerEthPrice: bigint, _minimumVaultRepDepositAttoRep: bigint, _settlementCollateralAttoEth: bigint, _totalUnderwritingLimitAttoEth: bigint) {
	const debtMovedAttoEth = requestedDebtAttoEth < targetVaultSummary.underwritingLimitAttoEth ? requestedDebtAttoEth : targetVaultSummary.underwritingLimitAttoEth
	return { badDebtAttoEth: 0n, underwritingLimitMovedAttoEth: debtMovedAttoEth, debtMovedAttoEth }
}

export function getLiquidationExecutionFailureDetail(errorMessage: string | undefined) {
	switch (errorMessage) {
		case 'Target safe':
			return liquidationCopy.targetNotLiquidatableError
		case 'No liq':
			return liquidationCopy.executableCapacityOwnershipUnavailable
		case 'Receiver bad':
			return liquidationCopy.callerVaultHealthOrIdentityError
		case 'Liquidation distance too low':
			return liquidationCopy.liquidationDistanceTooLowError
		case 'Target bad debt':
			return liquidationCopy.targetBadDebtReason
		case 'Receiver bad debt':
			return liquidationCopy.receiverBadDebtReason
		case 'Target backingUnits changed':
		case 'Target commitment changed':
			return liquidationCopy.targetSnapshotChangedError
		case 'Stale liquidation':
			return liquidationCopy.stagedLiquidationStaleError
		case 'Staged operation expired':
			return liquidationCopy.stagedLiquidationExpiredError
		case 'Target commitment':
			return liquidationCopy.targetMinimumDebtError
		case 'Receiver REP':
			return liquidationCopy.callerMinimumCollateralError
		case 'Receiver commitment below minimum':
			return liquidationCopy.callerMinimumCapacityOwnershipError
		default:
			return errorMessage
	}
}

/** Why the target cannot be liquidated at the given protocol price; undefined when it can, or when no price is known and a queued liquidation decides at execution. */
export function getVaultNotLiquidatableReason({
	minLiquidationPriceDistanceBps,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	minLiquidationPriceDistanceBps?: bigint | undefined
	repPerEthPrice: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary
}) {
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined || repPerEthPrice <= 0n || statoblastSecurityMultiplierBps <= 0n) return undefined
	const openInterestAttoEth = getVaultOpenInterestAttoEth(targetVaultSummary)
	if (openInterestAttoEth === undefined) return undefined
	if (openInterestAttoEth === 0n) return liquidationCopy.targetHasNoCommitmentReason
	return getBadDebtReason(targetVaultSummary, undefined) ?? getTargetLiquidatabilityReason({ minLiquidationPriceDistanceBps, openInterestAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary })
}

export function getMaxLiquidationAmount({
	minLiquidationPriceDistanceBps,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	minLiquidationPriceDistanceBps?: bigint | undefined
	repPerEthPrice: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	if (repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined || targetVaultSummary === undefined) return undefined
	if (repPerEthPrice <= 0n || statoblastSecurityMultiplierBps <= 0n) return 0n
	const targetOpenInterestAttoEth = getVaultOpenInterestAttoEth(targetVaultSummary)
	if (targetOpenInterestAttoEth === undefined) return undefined
	if (targetOpenInterestAttoEth === 0n) return 0n
	if (getTargetLiquidatabilityReason({ minLiquidationPriceDistanceBps, openInterestAttoEth: targetOpenInterestAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary }) !== undefined) return 0n
	return targetOpenInterestAttoEth
}

type LiquidationSimulation = {
	callerAfter: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		underwritingLimitAttoEth: bigint
	}
	callerBefore: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		underwritingLimitAttoEth: bigint
	}
	debtMovedAttoEth: bigint
	underwritingLimitMovedAttoEth: bigint
	badDebtAttoEth: bigint
	grossRepAwardAttoRep: bigint
	vaultAttoRepBackingToTransfer: bigint
	targetAccruedFeesRetained: bigint
	targetAfter: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		underwritingLimitAttoEth: bigint
	}
	targetBefore: {
		disputeStakedAttoRep: bigint
		vaultAttoRepBacking: bigint
		underwritingLimitAttoEth: bigint
	}
}

/** @internal Exported for regression tests of liquidation submission guards. */
export function simulateLiquidation({
	callerVaultSummary,
	requestedDebtAttoEth,
	totalUnderwritingLimitAttoEth,
	minimumVaultRepDepositAttoRep = DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP,
	repPerEthPrice,
	settlementCollateralAttoEth,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	requestedDebtAttoEth: bigint
	totalUnderwritingLimitAttoEth: bigint
	minimumVaultRepDepositAttoRep?: bigint | undefined
	repPerEthPrice: bigint
	settlementCollateralAttoEth: bigint
	statoblastSecurityMultiplierBps: bigint
	targetVaultSummary: SecurityPoolVaultSummary
}): LiquidationSimulation {
	const callerRepDeposit = callerVaultSummary?.vaultAttoRepBacking ?? 0n
	const callerDisputeStakedAttoRep = callerVaultSummary?.disputeStakedAttoRep ?? 0n
	const callerUnderwritingLimitAttoEth = callerVaultSummary?.underwritingLimitAttoEth ?? 0n
	const targetRepDeposit = targetVaultSummary.vaultAttoRepBacking
	const targetDisputeStakedAttoRep = targetVaultSummary.disputeStakedAttoRep
	const targetUnderwritingLimitAttoEth = targetVaultSummary.underwritingLimitAttoEth
	const targetOpenInterestAttoEth = requireVaultOpenInterestAttoEth(targetVaultSummary)
	const maxLiquidationDebtAttoEth =
		getMaxLiquidationAmount({
			repPerEthPrice,
			statoblastSecurityMultiplierBps,
			targetVaultSummary,
		}) ?? targetOpenInterestAttoEth
	const { badDebtAttoEth, underwritingLimitMovedAttoEth, debtMovedAttoEth } = getFundedLiquidationAmounts(
		requestedDebtAttoEth < maxLiquidationDebtAttoEth ? requestedDebtAttoEth : maxLiquidationDebtAttoEth,
		targetVaultSummary,
		callerVaultSummary,
		repPerEthPrice,
		minimumVaultRepDepositAttoRep,
		settlementCollateralAttoEth,
		totalUnderwritingLimitAttoEth,
	)
	const grossRepAwardAttoRep = getLiquidationVaultRepBackingToTransfer(debtMovedAttoEth, repPerEthPrice)
	const transfer = getPartialLiquidationTransfer(debtMovedAttoEth, targetVaultSummary, repPerEthPrice, minimumVaultRepDepositAttoRep)
	const vaultAttoRepBackingToTransfer = transfer.vaultAttoRepBackingToTransfer
	const targetAfterRepDeposit = transfer.remainingAttoRep
	const remainingTargetUnderwritingLimitAttoEth = targetUnderwritingLimitAttoEth - underwritingLimitMovedAttoEth
	const callerAfterRepDeposit = receiverBackingAfterTransfer(callerVaultSummary, targetVaultSummary, transfer)
	const resultingCallerUnderwritingLimitAttoEth = callerUnderwritingLimitAttoEth + underwritingLimitMovedAttoEth
	return {
		callerAfter: {
			disputeStakedAttoRep: callerDisputeStakedAttoRep,
			vaultAttoRepBacking: callerAfterRepDeposit,
			underwritingLimitAttoEth: resultingCallerUnderwritingLimitAttoEth,
		},
		callerBefore: {
			disputeStakedAttoRep: callerDisputeStakedAttoRep,
			vaultAttoRepBacking: callerRepDeposit,
			underwritingLimitAttoEth: callerUnderwritingLimitAttoEth,
		},
		badDebtAttoEth,
		underwritingLimitMovedAttoEth,
		debtMovedAttoEth,
		grossRepAwardAttoRep,
		vaultAttoRepBackingToTransfer,
		targetAccruedFeesRetained: targetVaultSummary.claimableFeesAttoEth,
		targetAfter: {
			disputeStakedAttoRep: targetDisputeStakedAttoRep,
			vaultAttoRepBacking: targetAfterRepDeposit,
			underwritingLimitAttoEth: remainingTargetUnderwritingLimitAttoEth,
		},
		targetBefore: {
			disputeStakedAttoRep: targetDisputeStakedAttoRep,
			vaultAttoRepBacking: targetRepDeposit,
			underwritingLimitAttoEth: targetUnderwritingLimitAttoEth,
		},
	}
}

export function getDeterministicLiquidationFailureReason({
	callerVaultSummary,
	requestedDebtAttoEth,
	totalUnderwritingLimitAttoEth,
	maxLiquidationDebtAttoEth,
	minLiquidationPriceDistanceBps,
	minimumSecurityBondDebtAttoEth = DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH,
	minimumVaultRepDepositAttoRep = DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP,
	repPerEthPrice,
	settlementCollateralAttoEth,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	requestedDebtAttoEth: bigint | undefined
	totalUnderwritingLimitAttoEth?: bigint | undefined
	maxLiquidationDebtAttoEth?: bigint | undefined
	minLiquidationPriceDistanceBps?: bigint | undefined
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
	const badDebtReason = getBadDebtReason(targetVaultSummary, callerVaultSummary)
	if (badDebtReason !== undefined) return badDebtReason
	if (repPerEthPrice !== undefined && statoblastSecurityMultiplierBps !== undefined) {
		const targetReason = getTargetLiquidatabilityReason({ minLiquidationPriceDistanceBps, openInterestAttoEth: targetOpenInterestAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary })
		if (targetReason !== undefined) return targetReason
	}
	const targetMaxLiquidationDebtAttoEth = maxLiquidationDebtAttoEth === undefined || maxLiquidationDebtAttoEth > targetOpenInterestAttoEth ? targetOpenInterestAttoEth : maxLiquidationDebtAttoEth
	const boundedRequestedDebtAttoEth = requestedDebtAttoEth < targetMaxLiquidationDebtAttoEth ? requestedDebtAttoEth : targetMaxLiquidationDebtAttoEth
	if (repPerEthPrice === undefined || settlementCollateralAttoEth === undefined || totalUnderwritingLimitAttoEth === undefined) return undefined
	const { badDebtAttoEth, underwritingLimitMovedAttoEth, debtMovedAttoEth } = getFundedLiquidationAmounts(boundedRequestedDebtAttoEth, targetVaultSummary, callerVaultSummary, repPerEthPrice, minimumVaultRepDepositAttoRep, settlementCollateralAttoEth, totalUnderwritingLimitAttoEth)
	if ((debtMovedAttoEth <= 0n || underwritingLimitMovedAttoEth === 0n) && badDebtAttoEth <= 0n) return liquidationCopy.executableCapacityOwnershipUnavailable
	const transfer = getPartialLiquidationTransfer(debtMovedAttoEth, targetVaultSummary, repPerEthPrice, minimumVaultRepDepositAttoRep)
	const remainingTargetUnderwritingLimitAttoEth = targetVaultSummary.underwritingLimitAttoEth - underwritingLimitMovedAttoEth
	// Liquidation writes off nothing, so the target's remaining commitment is its remaining underwriting limit.
	const remainingTargetDebtAttoEth = remainingTargetUnderwritingLimitAttoEth
	const callerAfterRepDeposit = receiverBackingAfterTransfer(callerVaultSummary, targetVaultSummary, transfer)
	const resultingCallerUnderwritingLimitAttoEth = (callerVaultSummary?.underwritingLimitAttoEth ?? 0n) + underwritingLimitMovedAttoEth
	const callerOpenInterestAttoEth = callerVaultSummary === undefined ? 0n : getVaultOpenInterestAttoEth(callerVaultSummary)
	if (callerOpenInterestAttoEth === undefined) return 'Receiver vault live open interest is still loading.'
	const resultingReceiverDebtAttoEth = callerOpenInterestAttoEth + debtMovedAttoEth
	if (remainingTargetDebtAttoEth !== 0n && remainingTargetDebtAttoEth < minimumSecurityBondDebtAttoEth) return 'The target vault would fall below the minimum commitment after liquidation.'
	if (debtMovedAttoEth !== 0n && callerAfterRepDeposit < minimumVaultRepDepositAttoRep) return 'The receiver vault would remain below the minimum REP backing after liquidation.'
	if (debtMovedAttoEth !== 0n && resultingReceiverDebtAttoEth < minimumSecurityBondDebtAttoEth) return 'The selected receiver would remain below the minimum commitment after liquidation.'
	if (debtMovedAttoEth !== 0n && resultingCallerUnderwritingLimitAttoEth === 0n) return 'No commitment would move with this liquidation.'
	return undefined
}

export function getLiquidationFailureReason({
	callerVaultSummary,
	requestedDebtAttoEth,
	totalUnderwritingLimitAttoEth,
	minimumReceiverHealthFactorBps = LIQUIDATION_BPS_DENOMINATOR,
	minLiquidationPriceDistanceBps,
	minimumSecurityBondDebtAttoEth = DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH,
	minimumVaultRepDepositAttoRep = DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP,
	repPerEthPrice,
	settlementCollateralAttoEth,
	statoblastSecurityMultiplierBps,
	targetVaultSummary,
}: {
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	requestedDebtAttoEth: bigint | undefined
	totalUnderwritingLimitAttoEth: bigint
	minimumReceiverHealthFactorBps?: bigint | undefined
	minLiquidationPriceDistanceBps?: bigint | undefined
	minimumSecurityBondDebtAttoEth?: bigint | undefined
	minimumVaultRepDepositAttoRep?: bigint | undefined
	repPerEthPrice: bigint | undefined
	settlementCollateralAttoEth: bigint
	statoblastSecurityMultiplierBps: bigint | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
}) {
	const targetOpenInterestAttoEth = targetVaultSummary === undefined ? undefined : getVaultOpenInterestAttoEth(targetVaultSummary)
	if (repPerEthPrice !== undefined && statoblastSecurityMultiplierBps !== undefined && targetVaultSummary !== undefined && targetOpenInterestAttoEth !== undefined) {
		const targetReason = getTargetLiquidatabilityReason({ minLiquidationPriceDistanceBps, openInterestAttoEth: targetOpenInterestAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary })
		if (targetReason !== undefined) return targetReason
	}
	const deterministicFailureReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		requestedDebtAttoEth,
		totalUnderwritingLimitAttoEth,
		maxLiquidationDebtAttoEth: getMaxLiquidationAmount({
			minLiquidationPriceDistanceBps,
			repPerEthPrice,
			statoblastSecurityMultiplierBps,
			targetVaultSummary,
		}),
		minLiquidationPriceDistanceBps,
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
		totalUnderwritingLimitAttoEth,
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
