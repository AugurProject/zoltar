import { parseUnits } from '@zoltar/core-shared/evm/ethereum'

export function parsePortfolioAmount(value: string) {
	const amount = portfolioAmountOrUndefined(value)
	if (amount === undefined) throw new Error('Enter a nonnegative amount with up to 18 decimal places.')
	return amount
}

export function portfolioAmountOrUndefined(value: string) {
	if (!/^(\d+)(\.\d{0,18})?$/.test(value.trim())) return undefined
	return parseUnits(value.trim(), 18)
}

export function portfolioUnsignedId(value: string, bits = 256) {
	if (!/^(0x[\da-fA-F]+|\d+)$/.test(value.trim())) return undefined
	const id = BigInt(value.trim())
	return id < 1n << BigInt(bits) ? id : undefined
}
