import { ceilDiv } from '@zoltar/core-shared/math/bigint'

export type PortfolioMintFees = Readonly<{
	securityMultiplierBps: bigint
	purchaseFeeBps: bigint
	minimumPurchaseFeeAttoEth: bigint
	annualFeeBps: bigint
	feePrincipalAttoEth: bigint
	cashAttoEth: bigint
	outcomeSupplyAttoShares: bigint
}>

/** Mirrors the portfolio's checkpointed purchase fee, including all integer rounding. */
export function portfolioMintFee(cash: bigint, state: PortfolioMintFees) {
	if (cash < 0n || Object.values(state).some(value => value < 0n)) throw new Error('Negative portfolio mint input')
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
export function portfolioMintWithinBudget(budget: bigint, state: PortfolioMintFees) {
	if (budget < 0n || budget >= 1n << 256n) throw new Error('Mint budget must fit uint256')
	let low = 0n
	let high = budget
	while (low < high) {
		const cash = (low + high + 1n) / 2n
		if (cash + portfolioMintFee(cash, state) <= budget) low = cash
		else high = cash - 1n
	}
	return low
}
