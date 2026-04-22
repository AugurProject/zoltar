import type { Address } from 'viem'
import { sameAddress } from './address.js'
import { formatCurrencyInputBalance } from './formatters.js'
import { parseRepAmountInput } from './marketForm.js'

export const MIN_SECURITY_VAULT_REP_DEPOSIT = 10n * 10n ** 18n

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

export function formatSecurityVaultRepInputAmount(value: bigint) {
	return formatCurrencyInputBalance(value)
}

export function parseSecurityVaultRepInputAmount(value: string, label: string) {
	return parseRepAmountInput(value, label)
}

export function isSecurityVaultDepositBelowMinimum(currentRepDeposit: bigint | undefined, depositAmount: bigint | undefined) {
	if (depositAmount === undefined || depositAmount <= 0n) return false
	return (currentRepDeposit ?? 0n) === 0n && depositAmount < MIN_SECURITY_VAULT_REP_DEPOSIT
}
