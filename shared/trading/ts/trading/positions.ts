import { quoteExactOutput } from './math.js'

export type ExitPositionQuote = Readonly<{
	longOutcome: 'YES' | 'NO'
	completeSetShares: bigint
	longSharesSwapped: bigint
	totalLongShares: bigint
	invalidRequired: bigint
	feeAmount: bigint
}>

function quoteExitPosition(longOutcome: 'YES' | 'NO', completeSetShares: bigint, yesReserve: bigint, noReserve: bigint, feeBps: bigint): ExitPositionQuote {
	const swap = longOutcome === 'YES' ? quoteExactOutput(yesReserve, noReserve, completeSetShares, feeBps) : quoteExactOutput(noReserve, yesReserve, completeSetShares, feeBps)
	return {
		longOutcome,
		completeSetShares,
		longSharesSwapped: swap.amountIn,
		totalLongShares: completeSetShares + swap.amountIn,
		invalidRequired: completeSetShares,
		feeAmount: swap.feeAmount,
	}
}

export type MaximumExitParameters = Readonly<{
	longOutcome: 'YES' | 'NO'
	longBalance: bigint
	invalidBalance: bigint
	yesReserve: bigint
	noReserve: bigint
	feeBps: bigint
	maximumLongInput?: bigint
}>

export function maximumInsuredExit(parameters: MaximumExitParameters) {
	const oppositeReserve = parameters.longOutcome === 'YES' ? parameters.noReserve : parameters.yesReserve
	if (parameters.yesReserve <= 0n || parameters.noReserve <= 0n) return 0n
	let low = 0n
	let high = parameters.invalidBalance < oppositeReserve ? parameters.invalidBalance : oppositeReserve - 1n
	if (high < 0n) return 0n
	const maximumLong = parameters.maximumLongInput === undefined || parameters.maximumLongInput > parameters.longBalance ? parameters.longBalance : parameters.maximumLongInput
	while (low < high) {
		const candidate = (low + high + 1n) / 2n
		const required = quoteExitPosition(parameters.longOutcome, candidate, parameters.yesReserve, parameters.noReserve, parameters.feeBps).totalLongShares
		if (required <= maximumLong) low = candidate
		else high = candidate - 1n
	}
	return low
}
