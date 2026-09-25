import { ceilDiv } from '@zoltar/core-shared/math/bigint'
const BPS_DENOMINATOR = 10_000n

export type SwapQuote = Readonly<{ amountIn: bigint; amountOut: bigint; netInput: bigint; feeAmount: bigint }>

function requirePositive(value: bigint, label: string) {
	if (value <= 0n) throw new Error(`${label} must be positive`)
}

export function quoteExactOutput(reserveIn: bigint, reserveOut: bigint, amountOut: bigint, feeBps: bigint): SwapQuote {
	requirePositive(reserveIn, 'reserveIn')
	requirePositive(reserveOut, 'reserveOut')
	if (amountOut <= 0n || amountOut >= reserveOut) throw new Error('amountOut is out of range')
	if (feeBps < 0n || feeBps >= BPS_DENOMINATOR) throw new Error('feeBps is out of range')
	const netInput = ceilDiv(reserveIn * amountOut, reserveOut - amountOut)
	const amountIn = ceilDiv(netInput * BPS_DENOMINATOR, BPS_DENOMINATOR - feeBps)
	return { amountIn, amountOut, netInput, feeAmount: amountIn - netInput }
}

/** Mirrors TwoWayConstantProductMath.quoteExactInput: the fee is taken from the input and the output rounds down. */
export function quoteExactInput(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint): SwapQuote {
	requirePositive(reserveIn, 'reserveIn')
	requirePositive(reserveOut, 'reserveOut')
	requirePositive(amountIn, 'amountIn')
	if (feeBps < 0n || feeBps >= BPS_DENOMINATOR) throw new Error('feeBps is out of range')
	const netInput = (amountIn * (BPS_DENOMINATOR - feeBps)) / BPS_DENOMINATOR
	requirePositive(netInput, 'netInput')
	const amountOut = (reserveOut * netInput) / (reserveIn + netInput)
	if (amountOut <= 0n || amountOut >= reserveOut) throw new Error('amountOut is out of range')
	return { amountIn, amountOut, netInput, feeAmount: amountIn - netInput }
}

/** Mirrors TwoWayConstantProductMath.conditionalYesBps: the YES price is the NO share of the reserves. */
export function conditionalYesBps(yesReserve: bigint, noReserve: bigint) {
	if (yesReserve < 0n || noReserve < 0n || yesReserve + noReserve === 0n) throw new Error('Empty reserves')
	return (BPS_DENOMINATOR * noReserve) / (yesReserve + noReserve)
}
