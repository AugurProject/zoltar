import type { MarketType, ReportingOutcomeKey } from '../types/contracts.js'
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

export function parseBigIntListInput(value: string, label: string) {
	const values = value
		.split(',')
		.map(entry => entry.trim())
		.filter(entry => entry !== '')

	if (values.length === 0) throw new Error(`${ label } is required`)

	return values.map((entry, index) => parseBigIntInput(entry, `${ label } #${ index + 1 }`))
}

export function parseMarketTypeInput(value: string): MarketType {
	switch (value) {
		case 'binary':
		case 'categorical':
		case 'scalar':
			return value
		default:
			throw new Error(`Unknown market type: ${ value }`)
	}
}

export function parseReportingOutcomeInput(value: string): ReportingOutcomeKey {
	switch (value) {
		case 'invalid':
		case 'yes':
		case 'no':
			return value
		default:
			throw new Error(`Unknown reporting outcome: ${ value }`)
	}
}
