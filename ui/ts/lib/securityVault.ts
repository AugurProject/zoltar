import type { Address } from 'viem'

export function getSelectedVaultAddress(selectedVaultAddress: string | undefined, accountAddress: Address | undefined) {
	const trimmedSelectedVaultAddress = selectedVaultAddress?.trim() ?? ''
	if (trimmedSelectedVaultAddress !== '') return trimmedSelectedVaultAddress
	return accountAddress?.toString()
}

export function isSelectedVaultOwnedByAccount(selectedVaultAddress: string | undefined, accountAddress: Address | undefined) {
	const trimmedSelectedVaultAddress = selectedVaultAddress?.trim() ?? ''
	if (trimmedSelectedVaultAddress === '' || accountAddress === undefined) return false
	return trimmedSelectedVaultAddress.toLowerCase() === accountAddress.toLowerCase()
}
