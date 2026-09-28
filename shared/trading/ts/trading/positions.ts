import { conditionalYesBps, quoteExactInput, quoteExactOutput } from './math.js'

type PairReserves = Readonly<{ yesReserve: bigint; noReserve: bigint; feeBps: bigint }>

export type EnterPositionQuote = Readonly<{
	longOutcome: 'YES' | 'NO'
	completeSetShares: bigint
	oppositeSharesSwapped: bigint
	additionalLongShares: bigint
	totalLongShares: bigint
	invalidInsurance: bigint
	feeAmount: bigint
	conditionalYesBpsBefore: bigint
	conditionalYesBpsAfter: bigint
}>

/**
 * Mirrors TwoWayConstantProductRouter.enterPosition after the complete sets are minted: the opposite outcome is sold
 * into the pair for more of the long outcome, and the whole input (fee included) stays in the reserves.
 */
export function quoteEnterPosition(longOutcome: 'YES' | 'NO', completeSetShares: bigint, { yesReserve, noReserve, feeBps }: PairReserves): EnterPositionQuote {
	const swap = longOutcome === 'YES' ? quoteExactInput(noReserve, yesReserve, completeSetShares, feeBps) : quoteExactInput(yesReserve, noReserve, completeSetShares, feeBps)
	const yesAfter = longOutcome === 'YES' ? yesReserve - swap.amountOut : yesReserve + swap.amountIn
	const noAfter = longOutcome === 'YES' ? noReserve + swap.amountIn : noReserve - swap.amountOut
	return {
		longOutcome,
		completeSetShares,
		oppositeSharesSwapped: completeSetShares,
		additionalLongShares: swap.amountOut,
		totalLongShares: completeSetShares + swap.amountOut,
		invalidInsurance: completeSetShares,
		feeAmount: swap.feeAmount,
		conditionalYesBpsBefore: conditionalYesBps(yesReserve, noReserve),
		conditionalYesBpsAfter: conditionalYesBps(yesAfter, noAfter),
	}
}

export type ExitPositionQuote = Readonly<{
	longOutcome: 'YES' | 'NO'
	completeSetShares: bigint
	longSharesSwapped: bigint
	totalLongShares: bigint
	invalidRequired: bigint
	feeAmount: bigint
	conditionalYesBpsBefore: bigint
	conditionalYesBpsAfter: bigint
}>

/** An insured exit buys the opposite outcome with long shares so equal YES, NO, and INVALID redeem as complete sets. */
export function quoteExitPosition(longOutcome: 'YES' | 'NO', completeSetShares: bigint, { yesReserve, noReserve, feeBps }: PairReserves): ExitPositionQuote {
	const swap = longOutcome === 'YES' ? quoteExactOutput(yesReserve, noReserve, completeSetShares, feeBps) : quoteExactOutput(noReserve, yesReserve, completeSetShares, feeBps)
	const yesAfter = longOutcome === 'YES' ? yesReserve + swap.amountIn : yesReserve - completeSetShares
	const noAfter = longOutcome === 'YES' ? noReserve - completeSetShares : noReserve + swap.amountIn
	return {
		longOutcome,
		completeSetShares,
		longSharesSwapped: swap.amountIn,
		totalLongShares: completeSetShares + swap.amountIn,
		invalidRequired: completeSetShares,
		feeAmount: swap.feeAmount,
		conditionalYesBpsBefore: conditionalYesBps(yesReserve, noReserve),
		conditionalYesBpsAfter: conditionalYesBps(yesAfter, noAfter),
	}
}

export type LargestExitParameters = PairReserves &
	Readonly<{
		longOutcome: 'YES' | 'NO'
		/** Long shares the exit may consume in total. */
		longShares: bigint
		/** Upper bound on complete sets, such as the wallet's INVALID balance; omit for no bound. */
		completeSetCap?: bigint
	}>

/** The largest insured exit, in complete sets, whose long-share cost fits within `longShares`. */
export function largestExitForLongShares(parameters: LargestExitParameters) {
	const oppositeReserve = parameters.longOutcome === 'YES' ? parameters.noReserve : parameters.yesReserve
	if (parameters.yesReserve <= 0n || parameters.noReserve <= 0n || parameters.longShares <= 0n) return 0n
	let low = 0n
	let high = oppositeReserve - 1n
	if (parameters.longShares < high) high = parameters.longShares
	if (parameters.completeSetCap !== undefined && parameters.completeSetCap < high) high = parameters.completeSetCap
	if (high < 0n) return 0n
	while (low < high) {
		const candidate = (low + high + 1n) / 2n
		if (quoteExitPosition(parameters.longOutcome, candidate, parameters).totalLongShares <= parameters.longShares) low = candidate
		else high = candidate - 1n
	}
	return low
}

export type MaximumExitParameters = PairReserves &
	Readonly<{
		longOutcome: 'YES' | 'NO'
		longBalance: bigint
		invalidBalance: bigint
	}>

export function maximumInsuredExit(parameters: MaximumExitParameters) {
	return largestExitForLongShares({ ...parameters, longShares: parameters.longBalance, completeSetCap: parameters.invalidBalance })
}
