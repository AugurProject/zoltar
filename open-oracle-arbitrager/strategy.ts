import type { Address } from '@zoltar/shared/ethereum'
import type { OpenOracleGame } from '@zoltar/shared/openOracle'

export const OPEN_ORACLE_PERCENTAGE_PRECISION = 10_000_000n

export type ArbitrageDirection = 'sell-rep' | 'buy-rep'

export type ArbitrageQuote = {
	direction: ArbitrageDirection
	grossProceedsWeth: bigint
	hedgeAmountRep: bigint
	hedgeCostWeth: bigint
	netProfitWeth: bigint
	profitBeforeGasWeth: bigint
	tokenToSwap: Address
}

export function calculateFee(amount: bigint, rate: bigint) {
	return (amount * rate) / OPEN_ORACLE_PERCENTAGE_PRECISION
}

export function calculateNextAmount1(game: Pick<OpenOracleGame, 'currentAmount1' | 'escalationHalt' | 'multiplier'>) {
	if (game.escalationHalt > game.currentAmount1) {
		const multiplied = (game.currentAmount1 * game.multiplier) / 100n
		return multiplied > game.escalationHalt ? game.escalationHalt : multiplied
	}
	return game.currentAmount1 + 1n
}

export function deriveTokenToSwap(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'token1' | 'token2'>, newAmount1: bigint, newAmount2: bigint) {
	return newAmount2 * game.currentAmount1 > game.currentAmount2 * newAmount1 ? game.token2 : game.token1
}

export function isSelfReport(account: Address | undefined, currentReporter: Address) {
	return account !== undefined && account.toLowerCase() === currentReporter.toLowerCase()
}

export function calculateContribution(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee'>, tokenToSwap: Address, token1: Address, newAmount1: bigint, newAmount2: bigint) {
	if (tokenToSwap.toLowerCase() === token1.toLowerCase()) {
		return {
			token1: newAmount1 + game.currentAmount1 + calculateFee(game.currentAmount1, game.feePercentage) + calculateFee(game.currentAmount1, game.protocolFee),
			token2: newAmount2 > game.currentAmount2 ? newAmount2 - game.currentAmount2 : 0n,
		}
	}
	return {
		token1: newAmount1 > game.currentAmount1 ? newAmount1 - game.currentAmount1 : 0n,
		token2: newAmount2 + game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee),
	}
}

export function hedgeWethLimit(direction: ArbitrageDirection, quotedWeth: bigint, maximumSlippageBps: bigint) {
	if (maximumSlippageBps < 0n || maximumSlippageBps > 10_000n) throw new Error('Hedge slippage must be from 0 to 10000 bps')
	if (direction === 'sell-rep') return (quotedWeth * (10_000n - maximumSlippageBps)) / 10_000n
	return (quotedWeth * (10_000n + maximumSlippageBps) + 9_999n) / 10_000n
}

export function hedgeSlippageReserveWeth(direction: ArbitrageDirection, quotedWeth: bigint, maximumSlippageBps: bigint) {
	const limit = hedgeWethLimit(direction, quotedWeth, maximumSlippageBps)
	return direction === 'sell-rep' ? quotedWeth - limit : limit - quotedWeth
}

export function spotTwapDeviationWithinLimit(spotTick: bigint, twapTick: bigint, maximumDeviation: bigint) {
	const deviation = spotTick > twapTick ? spotTick - twapTick : twapTick - spotTick
	return deviation <= maximumDeviation
}

export function executorFunding(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee' | 'token1' | 'token2'>, newAmount1: bigint, newAmount2: bigint, buyHedgeWethLimit: bigint) {
	const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
	const contribution = calculateContribution(game, tokenToSwap, game.token1, newAmount1, newAmount2)
	if (tokenToSwap.toLowerCase() === game.token1.toLowerCase()) {
		return { token1: contribution.token1, token2: contribution.token2 + game.currentAmount2 }
	}
	const hedgeToken2 = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	if (contribution.token2 < hedgeToken2) throw new Error('Buy hedge exceeds the token contribution')
	return {
		token1: contribution.token1 + buyHedgeWethLimit,
		token2: contribution.token2 - hedgeToken2,
	}
}

export function fundedCapitalAtRiskWeth(funding: { token1: bigint; token2: bigint }, hedgeAmountToken: bigint, quotedHedgeWeth: bigint, signedHedgeWethLimit: bigint) {
	if (hedgeAmountToken === 0n) return funding.token1
	const conservativeHedgeWeth = quotedHedgeWeth > signedHedgeWethLimit ? quotedHedgeWeth : signedHedgeWethLimit
	return funding.token1 + (funding.token2 * conservativeHedgeWeth + hedgeAmountToken - 1n) / hedgeAmountToken
}

export function evaluateSellRep(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee' | 'token1'>, quotedWethOut: bigint, gasCostWeth: bigint): ArbitrageQuote {
	const wethSpend = game.currentAmount1 + calculateFee(game.currentAmount1, game.feePercentage) + calculateFee(game.currentAmount1, game.protocolFee)
	return {
		direction: 'sell-rep',
		grossProceedsWeth: quotedWethOut,
		hedgeAmountRep: game.currentAmount2,
		hedgeCostWeth: wethSpend,
		netProfitWeth: quotedWethOut - wethSpend - gasCostWeth,
		profitBeforeGasWeth: quotedWethOut - wethSpend,
		tokenToSwap: game.token1,
	}
}

export function evaluateBuyRep(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee' | 'token2'>, quotedWethIn: bigint, gasCostWeth: bigint): ArbitrageQuote {
	const repNeeded = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	return {
		direction: 'buy-rep',
		grossProceedsWeth: game.currentAmount1,
		hedgeAmountRep: repNeeded,
		hedgeCostWeth: quotedWethIn,
		netProfitWeth: game.currentAmount1 - quotedWethIn - gasCostWeth,
		profitBeforeGasWeth: game.currentAmount1 - quotedWethIn,
		tokenToSwap: game.token2,
	}
}

export function meetsProfitThreshold(quote: ArbitrageQuote, minimumProfitWeth: bigint, minimumProfitBps: bigint) {
	if (quote.netProfitWeth < minimumProfitWeth || quote.hedgeCostWeth <= 0n) return false
	return quote.netProfitWeth * 10_000n >= quote.hedgeCostWeth * minimumProfitBps
}

export function calculateTrackedNetProfitEth(profitBeforeGasWeth: bigint, actualGasCostEth: bigint) {
	return profitBeforeGasWeth - actualGasCostEth
}

export function hasFreshSubmissionWindow({ currentTime, deadline, minimumRemaining, quoteBlock, submissionBlock }: { currentTime: bigint; deadline: bigint; minimumRemaining: bigint; quoteBlock: bigint; submissionBlock: bigint }) {
	if (submissionBlock !== quoteBlock) return false
	if (currentTime >= deadline) return false
	return deadline - currentTime >= minimumRemaining
}
