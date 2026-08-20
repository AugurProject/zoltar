import type { Address } from '@zoltar/shared/ethereum'
import type { OracleManagerDetails } from '../../../types/contracts.js'
import type { SecurityVaultDetails } from '../../../types/contracts.js'
import { sameAddress } from '../../../lib/address.js'
import { getOracleManagerPriceValidUntilTimestamp, ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../../../protocol/oracleTiming.js'

export { getOracleManagerPriceValidUntilTimestamp, ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS }

export const MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP = 10n * 10n ** 18n
export const DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES = 5n
export const MIN_STAGED_OPERATION_TIMEOUT_MINUTES = 1n
export const MAX_STAGED_OPERATION_TIMEOUT_MINUTES = 5n
const PRICE_PRECISION = 10n ** 18n
const BPS_DENOMINATOR = 10_000n

export function parseTargetHealthFactorBps(value: string) {
	const trimmed = value.trim()
	if (!/^\d+(?:\.\d{1,4})?$/.test(trimmed)) throw new Error('Deposit target factor must be a number with at most four decimal places')
	const [whole = '', fraction = ''] = trimmed.split('.')
	const factorBps = BigInt(whole) * BPS_DENOMINATOR + BigInt(fraction.padEnd(4, '0'))
	if (factorBps < BPS_DENOMINATOR) throw new Error('Deposit target factor must be at least 1.00×')
	return factorBps
}

function getMigrationSecurityMultiplierBps(poolSecurityMultiplierBps: bigint) {
	return BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2n
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

export function isSecurityVaultDepositBelowMinimum(currentVaultRepBackingAttoRep: bigint | undefined, depositAmount: bigint | undefined, minimumVaultRepDepositAttoRep = MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP) {
	if (depositAmount === undefined || depositAmount <= 0n) return false
	return (currentVaultRepBackingAttoRep ?? 0n) === 0n && depositAmount < minimumVaultRepDepositAttoRep
}

export function doesSecurityVaultExistOnchain(securityVaultDetails: SecurityVaultDetails | undefined) {
	if (securityVaultDetails === undefined) return false
	return securityVaultDetails.vaultAttoRepBacking > 0n || securityVaultDetails.capacityOwnershipAttoRep > 0n || securityVaultDetails.claimableFeesAttoEth > 0n || securityVaultDetails.disputeStakedAttoRep > 0n || securityVaultDetails.badDebtAttoEth > 0n
}

function divideBigintRoundUp(value: bigint, divisor: bigint) {
	if (divisor <= 0n) throw new Error('Divisor must be greater than zero')
	return (value + divisor - 1n) / divisor
}

function getCapacityOwnershipBackedRepFloor(capacityOwnershipAttoRep: bigint | undefined, repPerEthPrice: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (capacityOwnershipAttoRep === undefined || capacityOwnershipAttoRep <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return undefined
	if (statoblastSecurityMultiplierBps === undefined || statoblastSecurityMultiplierBps <= 0n) return undefined
	return divideBigintRoundUp(capacityOwnershipAttoRep * repPerEthPrice * statoblastSecurityMultiplierBps, PRICE_PRECISION * BPS_DENOMINATOR)
}

function getStrictCapacityOwnershipBackedRepMinimum(capacityOwnershipAttoRep: bigint | undefined, repPerEthPrice: bigint | undefined, multiplierBps: bigint | undefined) {
	if (capacityOwnershipAttoRep === undefined || capacityOwnershipAttoRep <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return undefined
	if (multiplierBps === undefined || multiplierBps <= 0n) return undefined
	return (capacityOwnershipAttoRep * repPerEthPrice * multiplierBps) / (PRICE_PRECISION * BPS_DENOMINATOR) + 1n
}

function getBackedCapacityOwnershipCeiling(attoRepAmount: bigint | undefined, repPerEthPrice: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (attoRepAmount === undefined || attoRepAmount <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return 0n
	if (statoblastSecurityMultiplierBps === undefined || statoblastSecurityMultiplierBps <= 0n) return 0n
	return (attoRepAmount * PRICE_PRECISION * BPS_DENOMINATOR) / (repPerEthPrice * statoblastSecurityMultiplierBps)
}

function getStrictlyBackedCapacityOwnershipCeiling(attoRepAmount: bigint | undefined, repPerEthPrice: bigint | undefined, multiplierBps: bigint | undefined) {
	if (attoRepAmount === undefined || attoRepAmount <= 0n || repPerEthPrice === undefined || repPerEthPrice <= 0n || multiplierBps === undefined || multiplierBps <= 0n) return 0n
	const numerator = attoRepAmount * PRICE_PRECISION * BPS_DENOMINATOR
	return numerator === 0n ? 0n : (numerator - 1n) / (repPerEthPrice * multiplierBps)
}

export function getSecurityVaultWithdrawableRepAmount({
	disputeStakedAttoRep = 0n,
	vaultAttoRepBacking,
	repPerEthPrice,
	capacityOwnershipAttoRep,
	statoblastSecurityMultiplierBps,
	totalPoolHeldAttoRep,
	totalCapacityOwnershipAttoRep,
}: {
	vaultAttoRepBacking: bigint | undefined
	disputeStakedAttoRep?: bigint | undefined
	repPerEthPrice: bigint | undefined
	capacityOwnershipAttoRep: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	totalPoolHeldAttoRep?: bigint | undefined
	totalCapacityOwnershipAttoRep?: bigint | undefined
}) {
	if (vaultAttoRepBacking === undefined) return undefined
	if (disputeStakedAttoRep > 0n) return 0n
	const requiredVaultAttoRep = getCapacityOwnershipBackedRepFloor(capacityOwnershipAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
	if (requiredVaultAttoRep === undefined) return undefined
	const associatedAttoRep = vaultAttoRepBacking + disputeStakedAttoRep
	const ordinaryHeadroom = associatedAttoRep > requiredVaultAttoRep ? associatedAttoRep - requiredVaultAttoRep : 0n
	const migrationRequiredRep = getStrictCapacityOwnershipBackedRepMinimum(capacityOwnershipAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
	if (migrationRequiredRep === undefined) return undefined
	const migrationHeadroom = vaultAttoRepBacking > migrationRequiredRep ? vaultAttoRepBacking - migrationRequiredRep : 0n
	const maxLocalWithdrawal = vaultAttoRepBacking < ordinaryHeadroom ? vaultAttoRepBacking : ordinaryHeadroom
	let maxWithdrawableAttoRep = maxLocalWithdrawal
	if (migrationHeadroom < maxWithdrawableAttoRep) maxWithdrawableAttoRep = migrationHeadroom
	if (totalPoolHeldAttoRep !== undefined && totalPoolHeldAttoRep > 0n) {
		const requiredPoolRep = getCapacityOwnershipBackedRepFloor(totalCapacityOwnershipAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
		if (requiredPoolRep === undefined) return undefined
		const maxGlobalWithdrawal = totalPoolHeldAttoRep > requiredPoolRep ? totalPoolHeldAttoRep - requiredPoolRep : 0n
		maxWithdrawableAttoRep = maxWithdrawableAttoRep < maxGlobalWithdrawal ? maxWithdrawableAttoRep : maxGlobalWithdrawal
	}
	return maxWithdrawableAttoRep
}

export function getSecurityVaultMaxCapacityOwnershipAttoRepAmount({
	currentCapacityOwnershipAttoRep,
	disputeStakedAttoRep = 0n,
	vaultAttoRepBacking,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	totalPoolHeldAttoRep,
	totalCapacityOwnershipAttoRep,
}: {
	currentCapacityOwnershipAttoRep?: bigint | undefined
	disputeStakedAttoRep?: bigint | undefined
	vaultAttoRepBacking: bigint | undefined
	repPerEthPrice: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	totalPoolHeldAttoRep?: bigint | undefined
	totalCapacityOwnershipAttoRep?: bigint | undefined
}) {
	const localCapacityOwnershipCeilingAttoRep = getBackedCapacityOwnershipCeiling((vaultAttoRepBacking ?? 0n) + disputeStakedAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
	const migrationCapacityOwnershipCeilingAttoRep = getStrictlyBackedCapacityOwnershipCeiling(vaultAttoRepBacking, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
	let maxCapacityOwnershipAttoRepAmount = localCapacityOwnershipCeilingAttoRep
	if (migrationCapacityOwnershipCeilingAttoRep < maxCapacityOwnershipAttoRepAmount) maxCapacityOwnershipAttoRepAmount = migrationCapacityOwnershipCeilingAttoRep
	if (totalPoolHeldAttoRep !== undefined && totalCapacityOwnershipAttoRep !== undefined) {
		const normalizedCurrentCapacityOwnershipAttoRep = currentCapacityOwnershipAttoRep ?? 0n
		const otherVaultCapacityOwnershipAttoRep = totalCapacityOwnershipAttoRep > normalizedCurrentCapacityOwnershipAttoRep ? totalCapacityOwnershipAttoRep - normalizedCurrentCapacityOwnershipAttoRep : 0n
		const globalCapacityOwnershipCeilingAttoRep = getBackedCapacityOwnershipCeiling(totalPoolHeldAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
		const remainingPoolCapacityOwnershipAttoRep = globalCapacityOwnershipCeilingAttoRep > otherVaultCapacityOwnershipAttoRep ? globalCapacityOwnershipCeilingAttoRep - otherVaultCapacityOwnershipAttoRep : 0n
		maxCapacityOwnershipAttoRepAmount = maxCapacityOwnershipAttoRepAmount < remainingPoolCapacityOwnershipAttoRep ? maxCapacityOwnershipAttoRepAmount : remainingPoolCapacityOwnershipAttoRep
	}
	return maxCapacityOwnershipAttoRepAmount
}

export function getStagedOperationTimeoutSeconds(timeoutMinutes: bigint | undefined) {
	if (timeoutMinutes === undefined || timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) return undefined
	return timeoutMinutes * 60n
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
