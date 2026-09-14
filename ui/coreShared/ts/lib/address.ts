import { sameAddress as addressesMatch } from '@zoltar/core-shared/evm/address'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { normalizeCaseInsensitiveText } from './caseInsensitive.js'

export function normalizeAddress(address: Address | string | undefined) {
	return normalizeCaseInsensitiveText(address)
}

export function sameAddress(left: Address | string | undefined, right: Address | string | undefined) {
	return addressesMatch(left?.trim(), right?.trim())
}

export function abbreviateAddress(address: string, leadingLength: number = 8, trailingLength: number = 6) {
	if (address.length <= leadingLength + trailingLength + 1) return address
	return `${address.slice(0, leadingLength)}…${address.slice(-trailingLength)}`
}
