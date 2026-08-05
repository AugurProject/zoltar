import type { Address } from '@zoltar/shared/ethereum'
import type { OracleManagerDetails } from '../../../types/contracts.js'
import type { SecurityVaultDetails } from '../../../types/contracts.js'
import { sameAddress } from '../../../lib/address.js'
import { getOracleManagerPriceValidUntilTimestamp, ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../../../protocol/oracleTiming.js'

export { getOracleManagerPriceValidUntilTimestamp, ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS }

export const MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP = 10n * 10n ** 18n
export const MIN_COVERAGE_COMMITMENT_ATTO_ETH = 1n * 10n ** 18n
export const DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES = 5n
export const MIN_STAGED_OPERATION_TIMEOUT_MINUTES = 1n
export const MAX_STAGED_OPERATION_TIMEOUT_MINUTES = 5n
const PRICE_PRECISION = 10n ** 18n
const BPS_DENOMINATOR = 10_000n

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

export function isSecurityVaultDepositBelowMinimum(currentVaultRepBackingAttoRep: bigint | undefined, depositAmount: bigint | undefined) {
	if (depositAmount === undefined || depositAmount <= 0n) return false
	return (currentVaultRepBackingAttoRep ?? 0n) === 0n && depositAmount < MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP
}

export function doesSecurityVaultExistOnchain(securityVaultDetails: SecurityVaultDetails | undefined) {
	if (securityVaultDetails === undefined) return false
	return securityVaultDetails.vaultAttoRepBacking > 0n || securityVaultDetails.coverageCommitmentAttoEth > 0n || securityVaultDetails.claimableFeesAttoEth > 0n || securityVaultDetails.disputeStakedAttoRep > 0n
}

function divideBigintRoundUp(value: bigint, divisor: bigint) {
	if (divisor <= 0n) throw new Error('Divisor must be greater than zero')
	return (value + divisor - 1n) / divisor
}

function getCoverageCommitmentBackedRepFloor(coverageCommitmentAttoEth: bigint | undefined, repPerEthPrice: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (coverageCommitmentAttoEth === undefined || coverageCommitmentAttoEth <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return undefined
	if (statoblastSecurityMultiplierBps === undefined || statoblastSecurityMultiplierBps <= 0n) return undefined
	return divideBigintRoundUp(coverageCommitmentAttoEth * repPerEthPrice * statoblastSecurityMultiplierBps, PRICE_PRECISION * BPS_DENOMINATOR)
}

function getStrictCoverageCommitmentBackedRepMinimum(coverageCommitmentAttoEth: bigint | undefined, repPerEthPrice: bigint | undefined, multiplierBps: bigint | undefined) {
	if (coverageCommitmentAttoEth === undefined || coverageCommitmentAttoEth <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return undefined
	if (multiplierBps === undefined || multiplierBps <= 0n) return undefined
	return (coverageCommitmentAttoEth * repPerEthPrice * multiplierBps) / (PRICE_PRECISION * BPS_DENOMINATOR) + 1n
}

function getBackedCoverageCommitmentCeiling(attoRepAmount: bigint | undefined, repPerEthPrice: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (attoRepAmount === undefined || attoRepAmount <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return 0n
	if (statoblastSecurityMultiplierBps === undefined || statoblastSecurityMultiplierBps <= 0n) return 0n
	return (attoRepAmount * PRICE_PRECISION * BPS_DENOMINATOR) / (repPerEthPrice * statoblastSecurityMultiplierBps)
}

function getStrictlyBackedCoverageCommitmentCeiling(attoRepAmount: bigint | undefined, repPerEthPrice: bigint | undefined, multiplierBps: bigint | undefined) {
	if (attoRepAmount === undefined || attoRepAmount <= 0n || repPerEthPrice === undefined || repPerEthPrice <= 0n || multiplierBps === undefined || multiplierBps <= 0n) return 0n
	const numerator = attoRepAmount * PRICE_PRECISION * BPS_DENOMINATOR
	return numerator === 0n ? 0n : (numerator - 1n) / (repPerEthPrice * multiplierBps)
}

export function getSecurityVaultWithdrawableRepAmount({
	disputeStakedAttoRep = 0n,
	vaultAttoRepBacking,
	repPerEthPrice,
	coverageCommitmentAttoEth,
	statoblastSecurityMultiplierBps,
	totalPoolHeldAttoRep,
	totalCoverageCommitmentAttoEth,
}: {
	vaultAttoRepBacking: bigint | undefined
	disputeStakedAttoRep?: bigint | undefined
	repPerEthPrice: bigint | undefined
	coverageCommitmentAttoEth: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	totalPoolHeldAttoRep?: bigint | undefined
	totalCoverageCommitmentAttoEth?: bigint | undefined
}) {
	if (vaultAttoRepBacking === undefined) return undefined
	if (disputeStakedAttoRep > 0n) return 0n
	const requiredVaultAttoRep = getCoverageCommitmentBackedRepFloor(coverageCommitmentAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps)
	if (requiredVaultAttoRep === undefined) return undefined
	const associatedAttoRep = vaultAttoRepBacking + disputeStakedAttoRep
	const ordinaryHeadroom = associatedAttoRep > requiredVaultAttoRep ? associatedAttoRep - requiredVaultAttoRep : 0n
	const migrationRequiredRep = getStrictCoverageCommitmentBackedRepMinimum(coverageCommitmentAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
	if (migrationRequiredRep === undefined) return undefined
	const migrationHeadroom = vaultAttoRepBacking > migrationRequiredRep ? vaultAttoRepBacking - migrationRequiredRep : 0n
	const maxLocalWithdrawal = vaultAttoRepBacking < ordinaryHeadroom ? vaultAttoRepBacking : ordinaryHeadroom
	let maxWithdrawableAttoRep = maxLocalWithdrawal
	if (migrationHeadroom < maxWithdrawableAttoRep) maxWithdrawableAttoRep = migrationHeadroom
	if (totalPoolHeldAttoRep !== undefined && totalPoolHeldAttoRep > 0n) {
		const requiredPoolRep = getCoverageCommitmentBackedRepFloor(totalCoverageCommitmentAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps)
		if (requiredPoolRep === undefined) return undefined
		const maxGlobalWithdrawal = totalPoolHeldAttoRep > requiredPoolRep ? totalPoolHeldAttoRep - requiredPoolRep : 0n
		maxWithdrawableAttoRep = maxWithdrawableAttoRep < maxGlobalWithdrawal ? maxWithdrawableAttoRep : maxGlobalWithdrawal
	}
	return maxWithdrawableAttoRep
}

export function getSecurityVaultMaxCoverageCommitmentAttoEthAmount({
	currentCoverageCommitmentAttoEth,
	disputeStakedAttoRep = 0n,
	vaultAttoRepBacking,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	totalPoolHeldAttoRep,
	totalCoverageCommitmentAttoEth,
}: {
	currentCoverageCommitmentAttoEth?: bigint | undefined
	disputeStakedAttoRep?: bigint | undefined
	vaultAttoRepBacking: bigint | undefined
	repPerEthPrice: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	totalPoolHeldAttoRep?: bigint | undefined
	totalCoverageCommitmentAttoEth?: bigint | undefined
}) {
	const localCoverageCommitmentCeilingAttoEth = getBackedCoverageCommitmentCeiling((vaultAttoRepBacking ?? 0n) + disputeStakedAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
	const migrationCoverageCommitmentCeilingAttoEth = getStrictlyBackedCoverageCommitmentCeiling(vaultAttoRepBacking, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
	let maxCoverageCommitmentAttoEthAmount = localCoverageCommitmentCeilingAttoEth
	if (migrationCoverageCommitmentCeilingAttoEth < maxCoverageCommitmentAttoEthAmount) maxCoverageCommitmentAttoEthAmount = migrationCoverageCommitmentCeilingAttoEth
	if (totalPoolHeldAttoRep !== undefined && totalCoverageCommitmentAttoEth !== undefined) {
		const normalizedCurrentCoverageCommitmentAttoEth = currentCoverageCommitmentAttoEth ?? 0n
		const otherVaultCoverageCommitmentAttoEth = totalCoverageCommitmentAttoEth > normalizedCurrentCoverageCommitmentAttoEth ? totalCoverageCommitmentAttoEth - normalizedCurrentCoverageCommitmentAttoEth : 0n
		const globalCoverageCommitmentCeilingAttoEth = getBackedCoverageCommitmentCeiling(totalPoolHeldAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
		const remainingPoolCoverageCommitmentAttoEth = globalCoverageCommitmentCeilingAttoEth > otherVaultCoverageCommitmentAttoEth ? globalCoverageCommitmentCeilingAttoEth - otherVaultCoverageCommitmentAttoEth : 0n
		maxCoverageCommitmentAttoEthAmount = maxCoverageCommitmentAttoEthAmount < remainingPoolCoverageCommitmentAttoEth ? maxCoverageCommitmentAttoEthAmount : remainingPoolCoverageCommitmentAttoEth
	}
	return maxCoverageCommitmentAttoEthAmount
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
