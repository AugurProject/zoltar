import type { Address } from 'viem'
import { normalizeCaseInsensitiveText, sameCaseInsensitiveText } from './caseInsensitive.js'

export function normalizeAddress(address: Address | string | undefined) {
	return normalizeCaseInsensitiveText(address)
}

export function sameAddress(left: Address | string | undefined, right: Address | string | undefined) {
	return sameCaseInsensitiveText(left, right)
}
