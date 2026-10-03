import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { isVaultHealthyAtFactor } from './liquidation.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { OracleManagerDetails, SecurityVaultDetails } from '../../../types/contracts.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getOracleManagerPriceValidUntilTimestamp } from '../../../protocol/oracleTiming.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

export const DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES = 5n
export const MIN_STAGED_OPERATION_TIMEOUT_MINUTES = 1n
export const MAX_STAGED_OPERATION_TIMEOUT_MINUTES = 5n
const PRICE_PRECISION = 10n ** 18n
const BPS_DENOMINATOR = 10_000n

export function parseTargetHealthFactorBps(value: string, label = 'Target backing ratio', minimumBps = BPS_DENOMINATOR) {
	const trimmed = value.trim()
	if (!/^\d+(?:\.\d{1,4})?$/.test(trimmed)) throw new Error(`${label} must be a number with at most four decimal places`)
	const [whole = '', fraction = ''] = trimmed.split('.')
	const factorBps = BigInt(whole) * BPS_DENOMINATOR + BigInt(fraction.padEnd(4, '0'))
	if (factorBps < minimumBps) throw new Error(`${label} must be at least ${formatMultiplier(minimumBps, 4)}`)
	return factorBps
}

function getMigrationSecurityMultiplierBps(poolSecurityMultiplierBps: bigint) {
	const multiplier = BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2n
	return multiplier < 10_500n ? 10_500n : multiplier
}

export function getSelectedVaultOwner(selectedVaultOwner: string | undefined, accountAddress: Address | undefined) {
	const trimmedSelectedVaultOwner = selectedVaultOwner?.trim() ?? ''
	if (trimmedSelectedVaultOwner !== '') return trimmedSelectedVaultOwner
	return accountAddress?.toString()
}

export function isSelectedVaultOwnedByAccount(selectedVaultOwner: string | undefined, accountAddress: Address | undefined) {
	const trimmedSelectedVaultOwner = selectedVaultOwner?.trim() ?? ''
	if (trimmedSelectedVaultOwner === '' || accountAddress === undefined) return false
	return sameAddress(trimmedSelectedVaultOwner, accountAddress)
}

export function doesLoadedSecurityVaultMatchSelection({ accountAddress, securityPoolAddress, securityVaultDetails, selectedVaultOwner }: { accountAddress: Address | undefined; securityPoolAddress: string | undefined; securityVaultDetails: SecurityVaultDetails | undefined; selectedVaultOwner: string | undefined }) {
	if (securityVaultDetails === undefined) return false
	const effectiveSelectedVaultOwner = getSelectedVaultOwner(selectedVaultOwner, accountAddress)
	if (effectiveSelectedVaultOwner === undefined) return false
	return sameAddress(securityVaultDetails.securityPoolAddress, securityPoolAddress) && sameAddress(securityVaultDetails.vaultAddress, effectiveSelectedVaultOwner)
}

/** The vault read supplies the backing and both pool totals from one block, so the unit conversion never mixes reads. */
type SecurityVaultDepositState = Pick<SecurityVaultDetails, 'totalPoolHeldRepBalanceAttoRep' | 'totalRepBackingUnits' | 'vaultAttoRepBacking'>

/**
 * Mirrors how a deposit is credited: REP converts to backing units with a floor, and the vault minimum is checked after
 * converting those units back to REP against the post-deposit pool. The round trip can lose attoREP whenever the pool's
 * REP per backing unit is not exact, so a deposit of exactly the minimum can still fall short.
 */
function getCreditedVaultDepositAttoRep(depositAmount: bigint, vault: SecurityVaultDepositState | undefined) {
	const totalPoolHeldAttoRep = vault?.totalPoolHeldRepBalanceAttoRep
	const totalRepBackingUnits = vault?.totalRepBackingUnits
	if (depositAmount <= 0n || totalPoolHeldAttoRep === undefined || totalRepBackingUnits === undefined) return depositAmount
	if (totalRepBackingUnits === 0n || totalPoolHeldAttoRep === 0n) return depositAmount
	const creditedBackingUnits = (depositAmount * totalRepBackingUnits) / totalPoolHeldAttoRep
	return (creditedBackingUnits * (totalPoolHeldAttoRep + depositAmount)) / (totalRepBackingUnits + creditedBackingUnits)
}

/** The pool stores its effective minimum (theoretical supply / 100_000 when unconfigured); an unloaded minimum is unknown, so it never flags a deposit. */
export function isSecurityVaultDepositBelowMinimum(vault: SecurityVaultDepositState | undefined, depositAmount: bigint | undefined, minimumVaultRepDepositAttoRep: bigint | undefined) {
	if (depositAmount === undefined || depositAmount <= 0n || minimumVaultRepDepositAttoRep === undefined) return false
	// The contract checks the whole vault after every deposit, so an existing vault below the minimum must also reach it.
	return (vault?.vaultAttoRepBacking ?? 0n) + getCreditedVaultDepositAttoRep(depositAmount, vault) < minimumVaultRepDepositAttoRep
}

export function doesSecurityVaultExistOnchain(securityVaultDetails: SecurityVaultDetails | undefined) {
	if (securityVaultDetails === undefined) return false
	return securityVaultDetails.vaultAttoRepBacking > 0n || securityVaultDetails.underwritingLimitAttoEth > 0n || securityVaultDetails.claimableFeesAttoEth > 0n || securityVaultDetails.disputeStakedAttoRep > 0n || securityVaultDetails.badDebtAttoEth > 0n
}

function getCapacityOwnershipBackedRepFloor(underwritingLimitAttoEth: bigint | undefined, repPerEthPrice: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (underwritingLimitAttoEth === undefined || underwritingLimitAttoEth <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return undefined
	if (statoblastSecurityMultiplierBps === undefined || statoblastSecurityMultiplierBps <= 0n) return undefined
	return ceilDiv(ceilDiv(underwritingLimitAttoEth * repPerEthPrice, PRICE_PRECISION) * statoblastSecurityMultiplierBps, BPS_DENOMINATOR)
}

export function getSecurityVaultWithdrawableRepAmount({
	disputeStakedAttoRep = 0n,
	vaultAttoRepBacking,
	repPerEthPrice,
	underwritingLimitAttoEth,
	statoblastSecurityMultiplierBps,
	totalPoolHeldAttoRep,
	totalUnderwritingLimitAttoEth,
	minimumVaultRepDepositAttoRep,
}: {
	vaultAttoRepBacking: bigint | undefined
	disputeStakedAttoRep?: bigint | undefined
	repPerEthPrice: bigint | undefined
	underwritingLimitAttoEth: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	totalPoolHeldAttoRep?: bigint | undefined
	totalUnderwritingLimitAttoEth?: bigint | undefined
	/** A withdrawal leaving less than this withdraws the entire vault, so a partial maximum must keep it. */
	minimumVaultRepDepositAttoRep?: bigint | undefined
}) {
	if (vaultAttoRepBacking === undefined) return undefined
	if (disputeStakedAttoRep > 0n) return 0n
	const requiredVaultAttoRep = getCapacityOwnershipBackedRepFloor(underwritingLimitAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps)
	if (requiredVaultAttoRep === undefined) return undefined
	const associatedAttoRep = vaultAttoRepBacking + disputeStakedAttoRep
	const ordinaryHeadroom = associatedAttoRep > requiredVaultAttoRep ? associatedAttoRep - requiredVaultAttoRep : 0n
	const migrationRequiredRep = getCapacityOwnershipBackedRepFloor(underwritingLimitAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
	if (migrationRequiredRep === undefined) return undefined
	const migrationHeadroom = vaultAttoRepBacking > migrationRequiredRep ? vaultAttoRepBacking - migrationRequiredRep : 0n
	const maxLocalWithdrawal = vaultAttoRepBacking < ordinaryHeadroom ? vaultAttoRepBacking : ordinaryHeadroom
	let maxWithdrawableAttoRep = maxLocalWithdrawal
	if (migrationHeadroom < maxWithdrawableAttoRep) maxWithdrawableAttoRep = migrationHeadroom
	if (totalPoolHeldAttoRep !== undefined && totalPoolHeldAttoRep > 0n) {
		// SecurityPool._requirePoolCoverage applies isVaultHealthy to the pool totals, so the pool keeps both the
		// associated reserve and the migration reserve. Pool-wide dispute stake is not loaded here, so the associated
		// check conservatively counts only pool-held REP.
		const associatedRequiredPoolRep = getCapacityOwnershipBackedRepFloor(totalUnderwritingLimitAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps)
		const migrationRequiredPoolRep = getCapacityOwnershipBackedRepFloor(totalUnderwritingLimitAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
		if (associatedRequiredPoolRep === undefined || migrationRequiredPoolRep === undefined) return undefined
		const requiredPoolRep = associatedRequiredPoolRep > migrationRequiredPoolRep ? associatedRequiredPoolRep : migrationRequiredPoolRep
		const maxGlobalWithdrawal = totalPoolHeldAttoRep > requiredPoolRep ? totalPoolHeldAttoRep - requiredPoolRep : 0n
		maxWithdrawableAttoRep = maxWithdrawableAttoRep < maxGlobalWithdrawal ? maxWithdrawableAttoRep : maxGlobalWithdrawal
	}
	return capWithdrawalAtVaultMinimum(maxWithdrawableAttoRep, vaultAttoRepBacking, minimumVaultRepDepositAttoRep)
}

/**
 * `withdrawRepFromVault` withdraws the entire vault when the remainder would fall below the vault minimum. A full exit
 * is only possible when coverage allows the whole backing to leave; otherwise the largest partial withdrawal keeps the minimum.
 * Partial amounts at or below this cap never revert on rounding: the contract floors both unit conversions, so the vault keeps
 * at least the requested remainder.
 */
function capWithdrawalAtVaultMinimum(coverageMaximumAttoRep: bigint, vaultAttoRepBacking: bigint, minimumVaultRepDepositAttoRep: bigint | undefined) {
	if (minimumVaultRepDepositAttoRep === undefined || coverageMaximumAttoRep >= vaultAttoRepBacking) return coverageMaximumAttoRep
	const partialMaximumAttoRep = vaultAttoRepBacking > minimumVaultRepDepositAttoRep ? vaultAttoRepBacking - minimumVaultRepDepositAttoRep : 0n
	return coverageMaximumAttoRep < partialMaximumAttoRep ? coverageMaximumAttoRep : partialMaximumAttoRep
}

/** True when the requested withdrawal leaves less than the vault minimum, so the contract withdraws the whole vault instead. */
export function doesVaultWithdrawalExitEntireVault(withdrawAmount: bigint | undefined, vaultAttoRepBacking: bigint | undefined, minimumVaultRepDepositAttoRep: bigint | undefined) {
	if (withdrawAmount === undefined || withdrawAmount <= 0n || vaultAttoRepBacking === undefined || minimumVaultRepDepositAttoRep === undefined) return false
	if (withdrawAmount >= vaultAttoRepBacking) return true
	return vaultAttoRepBacking - withdrawAmount < minimumVaultRepDepositAttoRep
}

export function getStagedOperationTimeoutSeconds(timeoutMinutes: bigint | undefined) {
	if (timeoutMinutes === undefined || timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) return undefined
	return timeoutMinutes * 60n
}

/** The inline error for a staged operation timeout field; an empty field has no error yet. */
export function getStagedOperationTimeoutFieldError(value: string) {
	if (value.trim() === '') return undefined
	const minutes = tryParseBigIntInput(value)
	if (minutes === undefined || minutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES || minutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) return securityPoolCopy.stagedOperationTimeoutRangeError
	return undefined
}

export function hasValidSecurityVaultOraclePrice(managerAddress: Address | undefined, oracleManagerDetails: Pick<OracleManagerDetails, 'isPriceValid' | 'lastSettlementTimestamp' | 'managerAddress' | 'priceValidUntilTimestamp'> | undefined, currentTimestamp?: bigint) {
	if (managerAddress === undefined || oracleManagerDetails === undefined) return false
	if (!sameAddress(managerAddress, oracleManagerDetails.managerAddress)) return false
	return isOracleManagerPriceUsable(oracleManagerDetails, currentTimestamp)
}

export function isOracleManagerPriceUsable(oracleManagerDetails: Pick<OracleManagerDetails, 'isPriceValid' | 'lastSettlementTimestamp' | 'priceValidUntilTimestamp'> | undefined, currentTimestamp?: bigint | undefined) {
	if (oracleManagerDetails?.isPriceValid !== true) return false
	if (currentTimestamp === undefined) return true
	const validUntilTimestamp = oracleManagerDetails.priceValidUntilTimestamp ?? getOracleManagerPriceValidUntilTimestamp(oracleManagerDetails.lastSettlementTimestamp)
	return validUntilTimestamp !== undefined && currentTimestamp < validUntilTimestamp
}

/** Inverts both rounded collateral requirements used by liquidation. */
export function getMaximumHealthyCommitment(details: Pick<SecurityVaultDetails, 'vaultAttoRepBacking' | 'disputeStakedAttoRep'> | undefined, repPerEthPrice: bigint | undefined, multiplierBps: bigint | undefined) {
	if (details === undefined || repPerEthPrice === undefined || repPerEthPrice <= 0n || multiplierBps === undefined || multiplierBps < BPS_DENOMINATOR) return undefined
	const associatedBase = ((details.vaultAttoRepBacking + details.disputeStakedAttoRep) * BPS_DENOMINATOR) / multiplierBps
	const freeBase = (details.vaultAttoRepBacking * BPS_DENOMINATOR) / getMigrationSecurityMultiplierBps(multiplierBps)
	return ((associatedBase < freeBase ? associatedBase : freeBase) * PRICE_PRECISION) / repPerEthPrice
}

export function getVaultBackingFactorAdjustmentGuard(details: SecurityVaultDetails | undefined, limitAttoEth?: bigint, repPerEthPrice?: bigint, poolSecurityMultiplierBps?: bigint) {
	if (details === undefined || details.settlementCollateralAttoEth === undefined) return 'Refresh vault details before changing the commitment limit.'
	if (limitAttoEth === undefined) return undefined
	if (limitAttoEth < 0n) return 'Commitment limit cannot be negative.'
	const total = details.totalUnderwritingLimitAttoEth - details.underwritingLimitAttoEth + limitAttoEth
	if (limitAttoEth < details.underwritingLimitAttoEth && total < details.settlementCollateralAttoEth) return 'Total commitments must cover outstanding settlement collateral.'
	if (limitAttoEth > details.underwritingLimitAttoEth && repPerEthPrice !== undefined && poolSecurityMultiplierBps !== undefined) {
		if (!isVaultHealthyAtFactor({ healthFactorBps: 10_000n, underwritingLimitAttoEth: limitAttoEth, disputeStakedAttoRep: details.disputeStakedAttoRep, poolHeldVaultRepBackingAttoRep: details.vaultAttoRepBacking, repPerEthPrice, poolSecurityMultiplierBps }))
			return 'Deposit more REP before increasing this commitment limit.'
	}
	return undefined
}
