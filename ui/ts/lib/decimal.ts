import { parseUnits } from 'viem'

function normalizeDecimalInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') return trimmed
	return trimmed.startsWith('.') ? `0${trimmed}` : trimmed.endsWith('.') ? `${trimmed}0` : trimmed
}

export function parseDecimalInput(value: string, label: string, units: number = 18) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)

	const normalized = normalizeDecimalInput(trimmed)

	try {
		return parseUnits(normalized, units)
	} catch {
		throw new Error(`${label} must be a decimal number`)
	}
}
