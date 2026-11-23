import type { Address } from '@zoltar/bot-shared/ethereum'
import type { OpenOracleGame } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { attoWethValue, type CollateralValuation } from '#core/collateral-valuation'

const OPEN_ORACLE_PERCENTAGE_PRECISION = 10_000_000n

export type ArbitrageDirection = 'sell-rep' | 'buy-rep'

/**
 * `grossProceedsToken1` and `hedgeCostToken1` are report `token1` (collateral) base units, the amounts the executor
 * trades and bounds. Profits are atto-WETH: collateral amounts are converted with `valuation`, which is one to one for WETH.
 */
export type ArbitrageQuote = {
	direction: ArbitrageDirection
	grossProceedsToken1: bigint
	hedgeAmountAttoRep: bigint
	hedgeCostToken1: bigint
	netProfitAttoWeth: bigint
	profitBeforeGasAttoWeth: bigint
	tokenToSwap: Address
	valuation: CollateralValuation
}

export function calculateFee(amount: bigint, rate: bigint) {
	return (amount * rate) / OPEN_ORACLE_PERCENTAGE_PRECISION
}

/** OpenOracle uses the pre-dispute amount to decide whether both fees apply. */
const FLAG_FEES_ONLY_AT_HALT = 1n << 5n

export function chargesFees(game: Pick<OpenOracleGame, 'flags' | 'currentAmount1' | 'escalationHalt'>) {
	return (game.flags & FLAG_FEES_ONLY_AT_HALT) === 0n || game.currentAmount1 >= game.escalationHalt
}

export function gameFee(game: Pick<OpenOracleGame, 'flags' | 'currentAmount1' | 'escalationHalt'>, amount: bigint, rate: bigint) {
	return chargesFees(game) ? calculateFee(amount, rate) : 0n
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

function calculateContribution(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee' | 'flags' | 'escalationHalt'>, tokenToSwap: Address, token1: Address, newAmount1: bigint, newAmount2: bigint) {
	if (tokenToSwap.toLowerCase() === token1.toLowerCase()) {
		return {
			token1: newAmount1 + game.currentAmount1 + gameFee(game, game.currentAmount1, game.feePercentage) + gameFee(game, game.currentAmount1, game.protocolFee),
			token2: newAmount2 > game.currentAmount2 ? newAmount2 - game.currentAmount2 : 0n,
		}
	}
	return {
		token1: newAmount1 > game.currentAmount1 ? newAmount1 - game.currentAmount1 : 0n,
		token2: newAmount2 + game.currentAmount2 + gameFee(game, game.currentAmount2, game.feePercentage) + gameFee(game, game.currentAmount2, game.protocolFee),
	}
}

export function hedgeWethLimitAttoEth(direction: ArbitrageDirection, quotedAttoWeth: bigint, maximumSlippageBps: bigint) {
	if (maximumSlippageBps < 0n || maximumSlippageBps > 10_000n) throw new Error('Hedge slippage must be from 0 to 10000 bps')
	if (direction === 'sell-rep') return (quotedAttoWeth * (10_000n - maximumSlippageBps)) / 10_000n
	return (quotedAttoWeth * (10_000n + maximumSlippageBps) + 9_999n) / 10_000n
}

export function hedgeSlippageReserveToken1(direction: ArbitrageDirection, quotedToken1: bigint, maximumSlippageBps: bigint) {
	const limit = hedgeWethLimitAttoEth(direction, quotedToken1, maximumSlippageBps)
	return direction === 'sell-rep' ? quotedToken1 - limit : limit - quotedToken1
}

export function spotTwapDeviationWithinLimit(spotTick: bigint, twapTick: bigint, maximumDeviation: bigint) {
	const deviation = spotTick > twapTick ? spotTick - twapTick : twapTick - spotTick
	return deviation <= maximumDeviation
}

export function executorFunding(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee' | 'flags' | 'escalationHalt' | 'token1' | 'token2'>, newAmount1: bigint, newAmount2: bigint, buyHedgeWethLimitAttoEth: bigint) {
	const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
	const contribution = calculateContribution(game, tokenToSwap, game.token1, newAmount1, newAmount2)
	if (tokenToSwap.toLowerCase() === game.token1.toLowerCase()) {
		return { token1: contribution.token1, token2: contribution.token2 + game.currentAmount2 }
	}
	const hedgeToken2 = game.currentAmount2 + gameFee(game, game.currentAmount2, game.feePercentage) + gameFee(game, game.currentAmount2, game.protocolFee)
	if (contribution.token2 < hedgeToken2) throw new Error('Buy hedge exceeds the token contribution')
	return {
		token1: contribution.token1 + buyHedgeWethLimitAttoEth,
		token2: contribution.token2 - hedgeToken2,
	}
}

/** The funded token1 plus the token2 inventory valued at the conservative hedge price, in token1 base units. */
function fundedCapitalAtRiskToken1(funding: { token1: bigint; token2: bigint }, hedgeAmountToken: bigint, quotedHedgeToken1: bigint, signedHedgeLimitToken1: bigint) {
	if (hedgeAmountToken === 0n) return funding.token1
	const conservativeHedgeToken1 = quotedHedgeToken1 > signedHedgeLimitToken1 ? quotedHedgeToken1 : signedHedgeLimitToken1
	return funding.token1 + (funding.token2 * conservativeHedgeToken1 + hedgeAmountToken - 1n) / hedgeAmountToken
}

/** The funded capital at risk in atto-WETH, rounded up so a collateral valuation never understates exposure. */
export function fundedCapitalAtRiskAttoWeth(funding: { token1: bigint; token2: bigint }, hedgeAmountToken: bigint, quotedHedgeToken1: bigint, signedHedgeLimitToken1: bigint, valuation: CollateralValuation) {
	return attoWethValue(valuation, fundedCapitalAtRiskToken1(funding, hedgeAmountToken, quotedHedgeToken1, signedHedgeLimitToken1), 'up')
}

/** The collateral the hedge receives or pays, the side the executor's hedge limit bounds. */
export function hedgeReferenceToken1(quote: Pick<ArbitrageQuote, 'direction' | 'grossProceedsToken1' | 'hedgeCostToken1'>) {
	return quote.direction === 'sell-rep' ? quote.grossProceedsToken1 : quote.hedgeCostToken1
}

/** The executable hedge price in REP per ETH, with the collateral leg valued in WETH so it is comparable with market consensus. */
export function executableDexPriceRepPerEth(quote: ArbitrageQuote) {
	const referenceAttoWeth = attoWethValue(quote.valuation, hedgeReferenceToken1(quote), 'down')
	return referenceAttoWeth <= 0n ? 0n : (quote.hedgeAmountAttoRep * 10n ** 18n) / referenceAttoWeth
}

export function evaluateSellRep(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee' | 'flags' | 'escalationHalt' | 'token1'>, quotedToken1Out: bigint, gasCostAttoWeth: bigint, valuation: CollateralValuation): ArbitrageQuote {
	const token1Spend = game.currentAmount1 + gameFee(game, game.currentAmount1, game.feePercentage) + gameFee(game, game.currentAmount1, game.protocolFee)
	const profitBeforeGasAttoWeth = attoWethValue(valuation, quotedToken1Out - token1Spend, 'down')
	return {
		direction: 'sell-rep',
		grossProceedsToken1: quotedToken1Out,
		hedgeAmountAttoRep: game.currentAmount2,
		hedgeCostToken1: token1Spend,
		netProfitAttoWeth: profitBeforeGasAttoWeth - gasCostAttoWeth,
		profitBeforeGasAttoWeth,
		tokenToSwap: game.token1,
		valuation,
	}
}

export function evaluateBuyRep(game: Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'feePercentage' | 'protocolFee' | 'flags' | 'escalationHalt' | 'token2'>, quotedToken1In: bigint, gasCostAttoWeth: bigint, valuation: CollateralValuation): ArbitrageQuote {
	const repNeededAttoRep = game.currentAmount2 + gameFee(game, game.currentAmount2, game.feePercentage) + gameFee(game, game.currentAmount2, game.protocolFee)
	const profitBeforeGasAttoWeth = attoWethValue(valuation, game.currentAmount1 - quotedToken1In, 'down')
	return {
		direction: 'buy-rep',
		grossProceedsToken1: game.currentAmount1,
		hedgeAmountAttoRep: repNeededAttoRep,
		hedgeCostToken1: quotedToken1In,
		netProfitAttoWeth: profitBeforeGasAttoWeth - gasCostAttoWeth,
		profitBeforeGasAttoWeth,
		tokenToSwap: game.token2,
		valuation,
	}
}

export function meetsProfitThreshold(quote: ArbitrageQuote, minimumProfitAttoWeth: bigint, minimumProfitBps: bigint) {
	const hedgeCostAttoWeth = attoWethValue(quote.valuation, quote.hedgeCostToken1, 'up')
	if (quote.netProfitAttoWeth < minimumProfitAttoWeth || hedgeCostAttoWeth <= 0n) return false
	return quote.netProfitAttoWeth * 10_000n >= hedgeCostAttoWeth * minimumProfitBps
}

export function calculateTrackedNetProfitEth(profitBeforeGasAttoWeth: bigint, actualGasCostAttoEth: bigint) {
	return profitBeforeGasAttoWeth - actualGasCostAttoEth
}

export function hasFreshSubmissionWindow({ currentTime, deadline, minimumRemaining, quoteBlock, submissionBlock }: { currentTime: bigint; deadline: bigint; minimumRemaining: bigint; quoteBlock: bigint; submissionBlock: bigint }) {
	if (submissionBlock !== quoteBlock) return false
	if (currentTime >= deadline) return false
	return deadline - currentTime >= minimumRemaining
}
