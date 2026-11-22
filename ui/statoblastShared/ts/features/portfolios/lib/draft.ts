import { tryParseDecimalInput, type DecimalSeparator } from '@zoltar/ui-core-shared/forms/decimal.js'

export function parsePortfolioAmount(value: string) {
	const amount = portfolioAmountOrUndefined(value)
	if (amount === undefined) throw new Error('Enter a nonnegative amount with up to 18 decimal places.')
	return amount
}

export function portfolioAmountOrUndefined(value: string, decimals = 18, decimalSeparator?: DecimalSeparator) {
	const amount = tryParseDecimalInput(value, decimals, decimalSeparator)
	return amount !== undefined && amount >= 0n ? amount : undefined
}

export function portfolioUnsignedId(value: string, bits = 256) {
	if (!/^(0x[\da-fA-F]+|\d+)$/.test(value.trim())) return undefined
	const id = BigInt(value.trim())
	return id < 1n << BigInt(bits) ? id : undefined
}
