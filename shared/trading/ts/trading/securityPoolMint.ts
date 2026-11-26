import { ceilDiv } from '@zoltar/core-shared/math/bigint'

export type SecurityPoolMintFees = Readonly<{
	securityMultiplierBps: bigint
	purchaseFeeBps: bigint
	minimumPurchaseFeeAttoEth: bigint
	annualFeeBps: bigint
	feePrincipalAttoEth: bigint
	cashAttoEth: bigint
	outcomeSupplyAttoShares: bigint
}>

/** Estimate from rounded public balances. Use an authoritative quote when enforcing an exact budget. */
export function securityPoolMintFee(cash: bigint, state: SecurityPoolMintFees) {
	if (cash < 0n || Object.values(state).some(value => value < 0n)) throw new Error('Negative security pool mint input')
	const supply = state.outcomeSupplyAttoShares
	if (supply !== 0n && state.cashAttoEth === 0n) throw new Error('Question backing exhausted')
	const shares = supply === 0n ? cash : (cash * supply) / state.cashAttoEth
	const principal = supply === 0n ? cash : ceilDiv(state.feePrincipalAttoEth * shares, supply)
	const backing = ceilDiv(cash * state.securityMultiplierBps, 10_000n)
	const proportional = ceilDiv(backing * state.purchaseFeeBps, 10_000n)
	const base = proportional > state.minimumPurchaseFeeAttoEth ? proportional : state.minimumPurchaseFeeAttoEth
	return base + ceilDiv(principal * state.annualFeeBps * 52n, 10_000n * 365n)
}

/** Off-chain integer search only; contract calls receive an explicit mint amount and ETH ceiling. */
export function securityPoolMintWithinBudget(budget: bigint, state: SecurityPoolMintFees) {
	if (budget < 0n || budget >= 1n << 256n) throw new Error('Mint budget must fit uint256')
	let low = 0n
	let high = budget
	while (low < high) {
		const cash = (low + high + 1n) / 2n
		if (cash + securityPoolMintFee(cash, state) <= budget) low = cash
		else high = cash - 1n
	}
	return low
}

/** Validate an estimated seed against authoritative checkpointed fees, reducing it to respect the budget. */
export async function securityPoolMintForQuotedBudget(budget: bigint, seed: bigint, quoteFee: (cash: bigint) => Promise<bigint>) {
	if (budget < 0n || seed <= 0n || seed > budget) throw new Error('Invalid mint budget seed')
	let cash = seed
	for (let attempt = 0; attempt < 8; attempt++) {
		const fee = await quoteFee(cash)
		if (fee < 0n) throw new Error('Negative purchase fee')
		if (cash + fee <= budget) return { cash, fee }
		const deficit = cash + fee - budget
		if (deficit >= cash) break
		cash -= deficit
	}
	throw new Error('ETH budget is too small to cover the security pool purchase fee')
}
