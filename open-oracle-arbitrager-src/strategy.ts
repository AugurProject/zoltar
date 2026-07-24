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
