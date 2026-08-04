import { BPS_DENOMINATOR, quoteExactInput, quoteExactOutput, type SwapQuote } from './math.ts'

export type EnterPositionQuote = Readonly<{
	longOutcome: 'YES' | 'NO'
	completeSetShares: bigint
	oppositeSharesSwapped: bigint
	additionalLongShares: bigint
	totalLongShares: bigint
	invalidInsurance: bigint
	feeAmount: bigint
}>

export type ExitPositionQuote = Readonly<{
	longOutcome: 'YES' | 'NO'
	completeSetShares: bigint
	longSharesSwapped: bigint
	totalLongShares: bigint
	invalidRequired: bigint
	feeAmount: bigint
}>

export function quoteEnterPosition(longOutcome: 'YES' | 'NO', completeSetShares: bigint, yesReserve: bigint, noReserve: bigint, feeBps: bigint): EnterPositionQuote {
	const swap = longOutcome === 'YES' ? quoteExactInput(noReserve, yesReserve, completeSetShares, feeBps) : quoteExactInput(yesReserve, noReserve, completeSetShares, feeBps)
	return {
		longOutcome,
		completeSetShares,
		oppositeSharesSwapped: completeSetShares,
		additionalLongShares: swap.amountOut,
		totalLongShares: completeSetShares + swap.amountOut,
		invalidInsurance: completeSetShares,
		feeAmount: swap.feeAmount,
	}
}

export function quoteExitPosition(longOutcome: 'YES' | 'NO', completeSetShares: bigint, yesReserve: bigint, noReserve: bigint, feeBps: bigint): ExitPositionQuote {
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

export function minimumAfterSlippage(amount: bigint, slippageBps: bigint) {
	if (slippageBps < 0n || slippageBps >= BPS_DENOMINATOR) throw new Error('slippageBps is out of range')
	return (amount * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR
}

export function maximumAfterSlippage(amount: bigint, slippageBps: bigint) {
	if (slippageBps < 0n || slippageBps >= BPS_DENOMINATOR) throw new Error('slippageBps is out of range')
	return (amount * (BPS_DENOMINATOR + slippageBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
}

export function reserveImpact(beforeIn: bigint, beforeOut: bigint, quote: SwapQuote) {
	const beforeNumerator = beforeOut
	const beforeDenominator = beforeIn + beforeOut
	const afterIn = beforeIn + quote.amountIn
	const afterOut = beforeOut - quote.amountOut
	return {
		before: { numerator: beforeNumerator, denominator: beforeDenominator },
		after: { numerator: afterOut, denominator: afterIn + afterOut },
	}
}
