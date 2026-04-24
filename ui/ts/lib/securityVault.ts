import type { Address } from 'viem'
import type { OracleManagerDetails } from '../types/contracts.js'
import { sameAddress } from './address.js'

export const MIN_SECURITY_VAULT_REP_DEPOSIT = 10n * 10n ** 18n
export const ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS = 60n * 60n

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

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS
}

export function hasValidSecurityVaultOraclePrice(managerAddress: Address | undefined, oracleManagerDetails: Pick<OracleManagerDetails, 'isPriceValid' | 'managerAddress'> | undefined) {
	if (managerAddress === undefined || oracleManagerDetails === undefined) return false
	if (!sameAddress(managerAddress, oracleManagerDetails.managerAddress)) return false
	return oracleManagerDetails.isPriceValid
}
