import type { Address } from 'viem'
import type { OracleManagerDetails } from '../types/contracts.js'
import type { SecurityVaultDetails } from '../types/contracts.js'
import { sameAddress } from './address.js'

export const MIN_SECURITY_VAULT_REP_DEPOSIT = 10n * 10n ** 18n
export const MIN_SECURITY_BOND_ALLOWANCE = 1n * 10n ** 18n
export const ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS = 60n * 60n
export const DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES = 30n
export const MIN_STAGED_OPERATION_TIMEOUT_MINUTES = 1n
const PRICE_PRECISION = 10n ** 18n

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

export function isSecurityVaultDepositBelowMinimum(currentRepDeposit: bigint | undefined, depositAmount: bigint | undefined) {
	if (depositAmount === undefined || depositAmount <= 0n) return false
	return (currentRepDeposit ?? 0n) === 0n && depositAmount < MIN_SECURITY_VAULT_REP_DEPOSIT
}

function divideBigintRoundUp(value: bigint, divisor: bigint) {
	if (divisor <= 0n) throw new Error('Divisor must be greater than zero')
	return (value + divisor - 1n) / divisor
}

function getAllowanceBackedRepFloor(securityBondAllowance: bigint | undefined, repPerEthPrice: bigint | undefined) {
	if (securityBondAllowance === undefined || securityBondAllowance <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return 0n
	return divideBigintRoundUp(securityBondAllowance * repPerEthPrice, PRICE_PRECISION)
}

function getBackedAllowanceCeiling(repAmount: bigint | undefined, repPerEthPrice: bigint | undefined) {
	if (repAmount === undefined || repAmount <= 0n) return 0n
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return 0n
	const repCapacity = repAmount * PRICE_PRECISION
	if (repCapacity <= 0n) return 0n
	return (repCapacity - 1n) / repPerEthPrice
}

export function getSecurityVaultWithdrawableRepAmount({
	lockedRepInEscalationGame,
	repDepositShare,
	repPerEthPrice,
	securityBondAllowance,
	totalRepDeposit,
	totalSecurityBondAllowance,
}: {
	lockedRepInEscalationGame: bigint | undefined
	repDepositShare: bigint | undefined
	repPerEthPrice: bigint | undefined
	securityBondAllowance: bigint | undefined
	totalRepDeposit?: bigint | undefined
	totalSecurityBondAllowance?: bigint | undefined
}) {
	if (repDepositShare === undefined) return undefined
	const unlockedRep = repDepositShare > (lockedRepInEscalationGame ?? 0n) ? repDepositShare - (lockedRepInEscalationGame ?? 0n) : 0n
	const requiredVaultRep = getAllowanceBackedRepFloor(securityBondAllowance, repPerEthPrice)
	const maxLocalWithdrawal = repDepositShare > requiredVaultRep ? repDepositShare - requiredVaultRep : 0n
	let maxWithdrawableRep = unlockedRep < maxLocalWithdrawal ? unlockedRep : maxLocalWithdrawal
	if (totalRepDeposit !== undefined && totalRepDeposit > 0n) {
		const requiredPoolRep = getAllowanceBackedRepFloor(totalSecurityBondAllowance, repPerEthPrice)
		const maxGlobalWithdrawal = totalRepDeposit > requiredPoolRep ? totalRepDeposit - requiredPoolRep : 0n
		maxWithdrawableRep = maxWithdrawableRep < maxGlobalWithdrawal ? maxWithdrawableRep : maxGlobalWithdrawal
	}
	return maxWithdrawableRep
}

export function getSecurityVaultMaxBondAllowanceAmount({
	currentSecurityBondAllowance,
	repDepositShare,
	repPerEthPrice,
	totalRepDeposit,
	totalSecurityBondAllowance,
}: {
	currentSecurityBondAllowance?: bigint | undefined
	repDepositShare: bigint | undefined
	repPerEthPrice: bigint | undefined
	totalRepDeposit?: bigint | undefined
	totalSecurityBondAllowance?: bigint | undefined
}) {
	const localAllowanceCeiling = getBackedAllowanceCeiling(repDepositShare, repPerEthPrice)
	let maxBondAllowanceAmount = localAllowanceCeiling
	if (totalRepDeposit !== undefined && totalSecurityBondAllowance !== undefined) {
		const currentAllowance = currentSecurityBondAllowance ?? 0n
		const otherVaultAllowance = totalSecurityBondAllowance > currentAllowance ? totalSecurityBondAllowance - currentAllowance : 0n
		const globalAllowanceCeiling = getBackedAllowanceCeiling(totalRepDeposit, repPerEthPrice)
		const remainingPoolAllowance = globalAllowanceCeiling > otherVaultAllowance ? globalAllowanceCeiling - otherVaultAllowance : 0n
		maxBondAllowanceAmount = maxBondAllowanceAmount < remainingPoolAllowance ? maxBondAllowanceAmount : remainingPoolAllowance
	}
	return maxBondAllowanceAmount
}

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS
}

export function getStagedOperationTimeoutSeconds(timeoutMinutes: bigint | undefined) {
	if (timeoutMinutes === undefined || timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) return undefined
	return timeoutMinutes * 60n
}

export function hasValidSecurityVaultOraclePrice(managerAddress: Address | undefined, oracleManagerDetails: Pick<OracleManagerDetails, 'isPriceValid' | 'managerAddress'> | undefined) {
	if (managerAddress === undefined || oracleManagerDetails === undefined) return false
	if (!sameAddress(managerAddress, oracleManagerDetails.managerAddress)) return false
	return oracleManagerDetails.isPriceValid
}
