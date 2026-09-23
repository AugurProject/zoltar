import { sameAddress as addressesMatch } from '@zoltar/core-shared/evm/address'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { normalizeCaseInsensitiveText } from './caseInsensitive.js'

export function normalizeAddress(address: Address | string | undefined) {
	return normalizeCaseInsensitiveText(address)
}

/** True for a complete 0x-prefixed 40-hex-digit address in any letter case. */
export function isHexAddressInput(value: string | undefined) {
	return value !== undefined && /^0x[0-9a-fA-F]{40}$/.test(value)
}

export function sameAddress(left: Address | string | undefined, right: Address | string | undefined) {
	return addressesMatch(left?.trim(), right?.trim())
}

export function abbreviateAddress(address: string, leadingLength: number = 8, trailingLength: number = 6) {
	if (address.length <= leadingLength + trailingLength + 1) return address
	return `${address.slice(0, leadingLength)}…${address.slice(-trailingLength)}`
}
