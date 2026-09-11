const BPS_DENOMINATOR = 10_000n

export type SwapQuote = Readonly<{ amountIn: bigint; amountOut: bigint; netInput: bigint; feeAmount: bigint }>

function requirePositive(value: bigint, label: string) {
	if (value <= 0n) throw new Error(`${label} must be positive`)
}

function ceilDiv(numerator: bigint, denominator: bigint) {
	if (numerator < 0n || denominator <= 0n) throw new Error('ceilDiv requires a nonnegative numerator and positive denominator')
	return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n
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
