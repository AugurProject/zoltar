import { ceilDiv } from '@zoltar/core-shared/math/bigint'

const BPS_DENOMINATOR = 10_000n

export const TRADING_PNL_BASIS =
	'Cost basis is the ETH paid into the market’s security pool for complete sets minted for this account, directly or through the trading router; proceeds are the ETH returned when this account’s shares were redeemed, exited through the router, or settled. Router actions are attributed to the account whose shares were minted or burned, because router events are not indexed; a router recipient or payout recipient that differs from that account is not observable. Shares received by plain transfer carry no cost basis. While the market still trades, holdings are valued at the ETH an exit would return at the latest indexed reserves and complete-set exchange rate, and fee accrual after that pool event is not reflected; shares that such an exit cannot convert count as zero, so a partial valuation is a lower bound. After trading closes, holdings are not valued. Realized profit follows cost recovery: it counts only after proceeds exceed the ETH paid in, unless the position is closed.'

export type TradingHoldings = {
	readonly invalidShares: bigint
	readonly yesShares: bigint
	readonly noShares: bigint
	readonly lpTokens: bigint
}

export type TradingMarketState = {
	/** Latest indexed reserve synchronization; absent before the pair is initialized. */
	readonly reserves?: { readonly yes: bigint; readonly no: bigint }
	readonly feeBps: bigint
	readonly lpTotalSupply: bigint
	/** Latest indexed complete-set exchange rate: settlement collateral per share supply. */
	readonly completeSetRate?: { readonly settlementCollateralAttoEth: bigint; readonly shareSupplyAttoShares: bigint }
}

export type TradingLifecycle = {
	readonly asOfTimestamp: bigint
	/** Question end time in seconds; undefined when the question is not indexed. */
	readonly questionEndTime?: bigint
	/** Newest indexed pool state, from a SystemStateSet-style event or a tagged read, whichever is later. */
	readonly systemState?: string
	readonly awaitingForkContinuation: boolean
	/** Tagged pool read of isEscalationResolved, or a sampled escalation game's final resolution other than None. */
	readonly resolved: boolean
	readonly universeForked: boolean
	readonly settlementObserved: boolean
}

/** Whether the pair still accepts the router exit that the holdings valuation assumes (TwoWayConstantProductPair._requireLifecycleOpen). */
export const tradingExitAvailability = (lifecycle: TradingLifecycle): { readonly open: true } | { readonly open: false; readonly reason: string } => {
	if (lifecycle.questionEndTime === undefined) return { open: false, reason: 'Question end time is not indexed' }
	if (lifecycle.asOfTimestamp >= lifecycle.questionEndTime) return { open: false, reason: 'Trading has closed because the question ended' }
	if (lifecycle.universeForked) return { open: false, reason: 'Trading has closed because the universe forked' }
	if (lifecycle.settlementObserved || lifecycle.resolved) return { open: false, reason: 'Trading has closed because the question resolved' }
	if ((lifecycle.systemState !== undefined && lifecycle.systemState !== '0') || lifecycle.awaitingForkContinuation) return { open: false, reason: 'Trading has closed because the pool is not operational' }
	return { open: true }
}

export type TradingHoldingsValue = {
	readonly valueAttoEth: bigint
	readonly completeSetsRedeemed: bigint
	readonly insuredExitSets: bigint
	readonly unvalued: { readonly invalidShares: bigint; readonly yesShares: bigint; readonly noShares: bigint; readonly lpTokens: bigint }
}

/** Mirrors TwoWayConstantProductMath.quoteExactOutput; undefined where the pair would revert. */
const exactOutputInput = (reserveIn: bigint, reserveOut: bigint, amountOut: bigint, feeBps: bigint): bigint | undefined => {
	if (reserveIn <= 0n || reserveOut <= 0n || amountOut <= 0n || amountOut >= reserveOut || feeBps < 0n || feeBps >= BPS_DENOMINATOR) return undefined
	const netInput = ceilDiv(reserveIn * amountOut, reserveOut - amountOut)
	return ceilDiv(netInput * BPS_DENOMINATOR, BPS_DENOMINATOR - feeBps)
}

/** @internal Exported for unit tests. Largest router exit (TwoWayConstantProductRouter._exitReceivedPosition) that fits the INVALID and long balances. */
export const largestInsuredExit = (longYes: boolean, longShares: bigint, invalidShares: bigint, reserves: { readonly yes: bigint; readonly no: bigint }, feeBps: bigint): bigint => {
	const reserveIn = longYes ? reserves.yes : reserves.no
	const reserveOut = longYes ? reserves.no : reserves.yes
	let high = reserveOut - 1n
	if (longShares < high) high = longShares
	if (invalidShares < high) high = invalidShares
	let low = 0n
	while (low < high) {
		const candidate = (low + high + 1n) / 2n
		const swapInput = exactOutputInput(reserveIn, reserveOut, candidate, feeBps)
		if (swapInput !== undefined && candidate + swapInput <= longShares) low = candidate
		else high = candidate - 1n
	}
	return low
}

const minimum = (...values: readonly bigint[]): bigint => values.reduce((smallest, value) => (value < smallest ? value : smallest))

/**
 * ETH the holdings would return at the indexed state: LP tokens are removed pro rata, complete sets are redeemed, and the
 * remaining INVALID plus one long outcome are sold through the router's insured exit. Shares that cannot reach ETH that
 * way (for example YES and NO without INVALID) are reported as unvalued rather than priced.
 */
export const tradingHoldingsValue = (holdings: TradingHoldings, market: TradingMarketState): TradingHoldingsValue | undefined => {
	const rate = market.completeSetRate
	if (rate === undefined || rate.shareSupplyAttoShares <= 0n) return undefined
	// A negative reconstructed balance means indexed history starts after the account acquired shares.
	if (holdings.invalidShares < 0n || holdings.yesShares < 0n || holdings.noShares < 0n || holdings.lpTokens < 0n) return undefined
	let invalid = holdings.invalidShares
	let yes = holdings.yesShares
	let no = holdings.noShares
	let lpTokens = holdings.lpTokens
	let reserves = market.reserves
	if (lpTokens > 0n && reserves !== undefined && market.lpTotalSupply >= lpTokens) {
		const yesOut = (reserves.yes * lpTokens) / market.lpTotalSupply
		const noOut = (reserves.no * lpTokens) / market.lpTotalSupply
		yes += yesOut
		no += noOut
		reserves = { yes: reserves.yes - yesOut, no: reserves.no - noOut }
		lpTokens = 0n
	}
	const completeSets = minimum(invalid, yes, no)
	invalid -= completeSets
	yes -= completeSets
	no -= completeSets
	let insuredExitSets = 0n
	if (invalid > 0n && reserves !== undefined && yes > 0n !== no > 0n) {
		const longYes = yes > 0n
		const longShares = longYes ? yes : no
		insuredExitSets = largestInsuredExit(longYes, longShares, invalid, reserves, market.feeBps)
		if (insuredExitSets > 0n) {
			const swapInput = exactOutputInput(longYes ? reserves.yes : reserves.no, longYes ? reserves.no : reserves.yes, insuredExitSets, market.feeBps) ?? 0n
			invalid -= insuredExitSets
			if (longYes) yes -= insuredExitSets + swapInput
			else no -= insuredExitSets + swapInput
		}
	}
	const redeem = (sets: bigint) => (sets * rate.settlementCollateralAttoEth) / rate.shareSupplyAttoShares
	return {
		valueAttoEth: redeem(completeSets) + redeem(insuredExitSets),
		completeSetsRedeemed: completeSets,
		insuredExitSets,
		unvalued: { invalidShares: invalid, yesShares: yes, noShares: no, lpTokens },
	}
}

export type TradingProfitAndLoss = {
	readonly costBasisAttoEth: bigint
	readonly proceedsAttoEth: bigint
	readonly holdingsValueAttoEth?: bigint
	readonly realizedAttoEth: bigint
	readonly unrealizedAttoEth?: bigint
	readonly netAttoEth?: bigint
	readonly open: boolean
}

/**
 * Cost-recovery accounting: while a position is open, profit is realized only once proceeds exceed the ETH paid in, and
 * the unrecovered cost is carried against the current holdings value. A closed position realizes its whole result.
 */
export const tradingProfitAndLoss = (costBasisAttoEth: bigint, proceedsAttoEth: bigint, holdings: TradingHoldings, holdingsValueAttoEth: bigint | undefined): TradingProfitAndLoss => {
	const open = holdings.invalidShares !== 0n || holdings.yesShares !== 0n || holdings.noShares !== 0n || holdings.lpTokens !== 0n
	if (!open) return { costBasisAttoEth, proceedsAttoEth, holdingsValueAttoEth: 0n, realizedAttoEth: proceedsAttoEth - costBasisAttoEth, unrealizedAttoEth: 0n, netAttoEth: proceedsAttoEth - costBasisAttoEth, open }
	const recovered = proceedsAttoEth > costBasisAttoEth ? proceedsAttoEth - costBasisAttoEth : 0n
	const unrecoveredCost = costBasisAttoEth > proceedsAttoEth ? costBasisAttoEth - proceedsAttoEth : 0n
	if (holdingsValueAttoEth === undefined) return { costBasisAttoEth, proceedsAttoEth, realizedAttoEth: recovered, open }
	return {
		costBasisAttoEth,
		proceedsAttoEth,
		holdingsValueAttoEth,
		realizedAttoEth: recovered,
		unrealizedAttoEth: holdingsValueAttoEth - unrecoveredCost,
		netAttoEth: proceedsAttoEth + holdingsValueAttoEth - costBasisAttoEth,
		open,
	}
}
