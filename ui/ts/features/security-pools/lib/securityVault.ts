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

export function getSelectedVaultAddress(selectedVaultAddress: string | undefined, accountAddress: Address | undefined) {
	const trimmedSelectedVaultAddress = selectedVaultAddress?.trim() ?? ''
	if (trimmedSelectedVaultAddress !== '') return trimmedSelectedVaultAddress
	return accountAddress?.toString()
}

export function isSelectedVaultOwnedByAccount(selectedVaultAddress: string | undefined, accountAddress: Address | undefined) {
	const trimmedSelectedVaultAddress = selectedVaultAddress?.trim() ?? ''
	if (trimmedSelectedVaultAddress === '' || accountAddress === undefined) return false
	return sameAddress(trimmedSelectedVaultAddress, accountAddress)
}

export function doesLoadedSecurityVaultMatchSelection({ accountAddress, securityPoolAddress, securityVaultDetails, selectedVaultAddress }: { accountAddress: Address | undefined; securityPoolAddress: string | undefined; securityVaultDetails: SecurityVaultDetails | undefined; selectedVaultAddress: string | undefined }) {
	if (securityVaultDetails === undefined) return false
	const effectiveSelectedVaultAddress = getSelectedVaultAddress(selectedVaultAddress, accountAddress)
	if (effectiveSelectedVaultAddress === undefined) return false
	return sameAddress(securityVaultDetails.securityPoolAddress, securityPoolAddress) && sameAddress(securityVaultDetails.vaultAddress, effectiveSelectedVaultAddress)
}

export function isSecurityVaultDepositBelowMinimum(currentVaultRepBackingAttoRep: bigint | undefined, depositAmount: bigint | undefined) {
	if (depositAmount === undefined || depositAmount <= 0n) return false
	return (currentVaultRepBackingAttoRep ?? 0n) === 0n && depositAmount < MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP
}

export function doesSecurityVaultExistOnchain(securityVaultDetails: SecurityVaultDetails | undefined) {
	if (securityVaultDetails === undefined) return false
	return securityVaultDetails.vaultRepBackingAttoRep > 0n || securityVaultDetails.coverageCommitmentAttoEth > 0n || securityVaultDetails.claimableFeesAttoEth > 0n || securityVaultDetails.disputeStakedRepAttoRep > 0n
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

function getBackedCoverageCommitmentCeiling(repAmountAttoRep: bigint | undefined, repPerEthPrice: bigint | undefined, statoblastSecurityMultiplierBps: bigint | undefined) {
	if (repAmountAttoRep === undefined || repAmountAttoRep <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return 0n
	if (statoblastSecurityMultiplierBps === undefined || statoblastSecurityMultiplierBps <= 0n) return 0n
	return (repAmountAttoRep * PRICE_PRECISION * BPS_DENOMINATOR) / (repPerEthPrice * statoblastSecurityMultiplierBps)
}

function getStrictlyBackedCoverageCommitmentCeiling(repAmountAttoRep: bigint | undefined, repPerEthPrice: bigint | undefined, multiplierBps: bigint | undefined) {
	if (repAmountAttoRep === undefined || repAmountAttoRep <= 0n || repPerEthPrice === undefined || repPerEthPrice <= 0n || multiplierBps === undefined || multiplierBps <= 0n) return 0n
	const numerator = repAmountAttoRep * PRICE_PRECISION * BPS_DENOMINATOR
	return numerator === 0n ? 0n : (numerator - 1n) / (repPerEthPrice * multiplierBps)
}

export function getSecurityVaultWithdrawableRepAmount({
	disputeStakedRepAttoRep = 0n,
	vaultRepBackingAttoRep,
	repPerEthPrice,
	coverageCommitmentAttoEth,
	statoblastSecurityMultiplierBps,
	totalPoolHeldRepAttoRep,
	totalCoverageCommitmentAttoEth,
}: {
	vaultRepBackingAttoRep: bigint | undefined
	disputeStakedRepAttoRep?: bigint | undefined
	repPerEthPrice: bigint | undefined
	coverageCommitmentAttoEth: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	totalPoolHeldRepAttoRep?: bigint | undefined
	totalCoverageCommitmentAttoEth?: bigint | undefined
}) {
	if (vaultRepBackingAttoRep === undefined) return undefined
	if (disputeStakedRepAttoRep > 0n) return 0n
	const requiredVaultRepAttoRep = getCoverageCommitmentBackedRepFloor(coverageCommitmentAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps)
	if (requiredVaultRepAttoRep === undefined) return undefined
	const associatedRepAttoRep = vaultRepBackingAttoRep + disputeStakedRepAttoRep
	const ordinaryHeadroom = associatedRepAttoRep > requiredVaultRepAttoRep ? associatedRepAttoRep - requiredVaultRepAttoRep : 0n
	const migrationRequiredRep = getStrictCoverageCommitmentBackedRepMinimum(coverageCommitmentAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
	if (migrationRequiredRep === undefined) return undefined
	const migrationHeadroom = vaultRepBackingAttoRep > migrationRequiredRep ? vaultRepBackingAttoRep - migrationRequiredRep : 0n
	const maxLocalWithdrawal = vaultRepBackingAttoRep < ordinaryHeadroom ? vaultRepBackingAttoRep : ordinaryHeadroom
	let maxWithdrawableRepAttoRep = maxLocalWithdrawal
	if (migrationHeadroom < maxWithdrawableRepAttoRep) maxWithdrawableRepAttoRep = migrationHeadroom
	if (totalPoolHeldRepAttoRep !== undefined && totalPoolHeldRepAttoRep > 0n) {
		const requiredPoolRep = getCoverageCommitmentBackedRepFloor(totalCoverageCommitmentAttoEth, repPerEthPrice, statoblastSecurityMultiplierBps)
		if (requiredPoolRep === undefined) return undefined
		const maxGlobalWithdrawal = totalPoolHeldRepAttoRep > requiredPoolRep ? totalPoolHeldRepAttoRep - requiredPoolRep : 0n
		maxWithdrawableRepAttoRep = maxWithdrawableRepAttoRep < maxGlobalWithdrawal ? maxWithdrawableRepAttoRep : maxGlobalWithdrawal
	}
	return maxWithdrawableRepAttoRep
}

export function getSecurityVaultMaxCoverageCommitmentAttoEthAmount({
	currentCoverageCommitmentAttoEth,
	disputeStakedRepAttoRep = 0n,
	vaultRepBackingAttoRep,
	repPerEthPrice,
	statoblastSecurityMultiplierBps,
	totalPoolHeldRepAttoRep,
	totalCoverageCommitmentAttoEth,
}: {
	currentCoverageCommitmentAttoEth?: bigint | undefined
	disputeStakedRepAttoRep?: bigint | undefined
	vaultRepBackingAttoRep: bigint | undefined
	repPerEthPrice: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
	totalPoolHeldRepAttoRep?: bigint | undefined
	totalCoverageCommitmentAttoEth?: bigint | undefined
}) {
	const localCoverageCommitmentCeilingAttoEth = getBackedCoverageCommitmentCeiling((vaultRepBackingAttoRep ?? 0n) + disputeStakedRepAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
	const migrationCoverageCommitmentCeilingAttoEth = getStrictlyBackedCoverageCommitmentCeiling(vaultRepBackingAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps === undefined ? undefined : getMigrationSecurityMultiplierBps(statoblastSecurityMultiplierBps))
	let maxCoverageCommitmentAttoEthAmount = localCoverageCommitmentCeilingAttoEth
	if (migrationCoverageCommitmentCeilingAttoEth < maxCoverageCommitmentAttoEthAmount) maxCoverageCommitmentAttoEthAmount = migrationCoverageCommitmentCeilingAttoEth
	if (totalPoolHeldRepAttoRep !== undefined && totalCoverageCommitmentAttoEth !== undefined) {
		const normalizedCurrentCoverageCommitmentAttoEth = currentCoverageCommitmentAttoEth ?? 0n
		const otherVaultCoverageCommitmentAttoEth = totalCoverageCommitmentAttoEth > normalizedCurrentCoverageCommitmentAttoEth ? totalCoverageCommitmentAttoEth - normalizedCurrentCoverageCommitmentAttoEth : 0n
		const globalCoverageCommitmentCeilingAttoEth = getBackedCoverageCommitmentCeiling(totalPoolHeldRepAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps)
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
