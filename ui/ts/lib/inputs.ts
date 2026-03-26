import { getAddress, isHex, type Address, type Hex } from 'viem'
import { parseBigIntInput } from './marketForm.js'

export function parseAddressInput(value: string, label: string): Address {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${ label } is required`)
	return getAddress(trimmed)
}

export function parseBytes32Input(value: string, label: string): Hex {
	const trimmed = value.trim()
	if (!isHex(trimmed, { strict: true }) || trimmed.length !== 66) {
		throw new Error(`${ label } must be a 32-byte hex value`)
	}

	return trimmed
}

export function parseReportIdInput(value: string) {
	return parseBigIntInput(value, 'Report ID')
}
