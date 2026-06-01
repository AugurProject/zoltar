import { parseUnits } from 'viem'

const DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/

function normalizeDecimalInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') return trimmed
	return (() => {
		if (trimmed.startsWith('.')) return `0${trimmed}`
		if (trimmed.endsWith('.')) return `${trimmed}0`

		return trimmed
	})()
}

function hasValidDecimalPrecision(value: string, units: number) {
	const fractionalPart = value.split('.')[1]
	return fractionalPart === undefined || fractionalPart.length <= units
}

export function tryParseDecimalInput(value: string, units: number = 18) {
	const trimmed = value.trim()
	if (trimmed === '') return undefined
	const normalized = normalizeDecimalInput(trimmed)
	if (!DECIMAL_INPUT_PATTERN.test(normalized)) return undefined
	if (!hasValidDecimalPrecision(normalized, units)) return undefined
	return parseUnits(normalized, units)
}

export function parseDecimalInput(value: string, label: string, units: number = 18) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)
	const parsed = tryParseDecimalInput(trimmed, units)
	if (parsed === undefined) throw new Error(`${label} must be a decimal number`)
	return parsed
}
