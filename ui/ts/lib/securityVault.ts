import type { Address } from 'viem'
import type { OracleManagerDetails } from '../types/contracts.js'
import { sameAddress } from './address.js'

export const MIN_SECURITY_VAULT_REP_DEPOSIT = 10n * 10n ** 18n
export const ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS = 60n * 60n
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

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS
}

export function hasValidSecurityVaultOraclePrice(managerAddress: Address | undefined, oracleManagerDetails: Pick<OracleManagerDetails, 'isPriceValid' | 'managerAddress'> | undefined) {
	if (managerAddress === undefined || oracleManagerDetails === undefined) return false
	if (!sameAddress(managerAddress, oracleManagerDetails.managerAddress)) return false
	return oracleManagerDetails.isPriceValid
}
