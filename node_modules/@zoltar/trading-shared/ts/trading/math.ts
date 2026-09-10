export const BPS_DENOMINATOR = 10_000n

export type SwapQuote = Readonly<{ amountIn: bigint; amountOut: bigint; netInput: bigint; feeAmount: bigint }>

function requirePositive(value: bigint, label: string) {
	if (value <= 0n) throw new Error(`${label} must be positive`)
}

export function ceilDiv(numerator: bigint, denominator: bigint) {
	if (numerator < 0n || denominator <= 0n) throw new Error('ceilDiv requires a nonnegative numerator and positive denominator')
	return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n
}

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

export function quoteExactOutput(reserveIn: bigint, reserveOut: bigint, amountOut: bigint, feeBps: bigint): SwapQuote {
	requirePositive(reserveIn, 'reserveIn')
	requirePositive(reserveOut, 'reserveOut')
	if (amountOut <= 0n || amountOut >= reserveOut) throw new Error('amountOut is out of range')
	if (feeBps < 0n || feeBps >= BPS_DENOMINATOR) throw new Error('feeBps is out of range')
	const netInput = ceilDiv(reserveIn * amountOut, reserveOut - amountOut)
	const amountIn = ceilDiv(netInput * BPS_DENOMINATOR, BPS_DENOMINATOR - feeBps)
	return { amountIn, amountOut, netInput, feeAmount: amountIn - netInput }
}

export function conditionalYesProbability(yesReserve: bigint, noReserve: bigint) {
	requirePositive(yesReserve + noReserve, 'reserve sum')
	return { numerator: noReserve, denominator: yesReserve + noReserve }
}

export function conditionalNoProbability(yesReserve: bigint, noReserve: bigint) {
	requirePositive(yesReserve + noReserve, 'reserve sum')
	return { numerator: yesReserve, denominator: yesReserve + noReserve }
}

export function quoteInitialLiquidity(completeSets: bigint, conditionalYesBps: bigint) {
	requirePositive(completeSets, 'completeSets')
	if (conditionalYesBps <= 0n || conditionalYesBps >= BPS_DENOMINATOR) throw new Error('conditionalYesBps is out of range')
	const amounts = conditionalYesBps >= 5_000n ? { yesUsed: (completeSets * (BPS_DENOMINATOR - conditionalYesBps)) / conditionalYesBps, noUsed: completeSets } : { yesUsed: completeSets, noUsed: (completeSets * conditionalYesBps) / (BPS_DENOMINATOR - conditionalYesBps) }
	if (amounts.yesUsed === 0n || amounts.noUsed === 0n) throw new Error('initial reserves round to zero')
	return { ...amounts, invalidReturned: completeSets, yesReturned: completeSets - amounts.yesUsed, noReturned: completeSets - amounts.noUsed }
}

export function quoteAddLiquidity(yesReserve: bigint, noReserve: bigint, maxYes: bigint, maxNo: bigint) {
	requirePositive(yesReserve, 'yesReserve')
	requirePositive(noReserve, 'noReserve')
	const yesLimited = maxYes * noReserve <= maxNo * yesReserve
	const yesUsed = yesLimited ? maxYes : (maxNo * yesReserve) / noReserve
	const noUsed = yesLimited ? (maxYes * noReserve) / yesReserve : maxNo
	return { yesUsed, noUsed, yesReturned: maxYes - yesUsed, noReturned: maxNo - noUsed }
}

export function quoteRemoveLiquidity(yesReserve: bigint, noReserve: bigint, liquidity: bigint, totalSupply: bigint) {
	requirePositive(totalSupply, 'totalSupply')
	return { yesOut: (yesReserve * liquidity) / totalSupply, noOut: (noReserve * liquidity) / totalSupply }
}
