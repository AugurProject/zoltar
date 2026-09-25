import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { LiveBalances, LiveMarket } from '../../protocol/live.js'
import { tradeTicketModel, type TradeTicketInputs } from '../../features/live/tradeTicketModel.js'
import type { TradeMode } from '../../features/live/useTransactionWorkflow.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'

/** An open, initialized market: one ETH backs one complete set and the pool holds 100 YES and 100 NO. */
export function liveMarketFixture(overrides: Partial<LiveMarket> = {}): LiveMarket {
	return {
		pool: `0x${'22'.repeat(20)}` as Address,
		pair: `0x${'33'.repeat(20)}` as Address,
		shareToken: `0x${'44'.repeat(20)}` as Address,
		universeId: 1n,
		questionId: 2n,
		title: 'Fixture market',
		description: '',
		endTime: 2n ** 255n,
		statoblastSecurityMultiplierBps: 20_000n,
		initialReportPriorityFeeAttoEthPerGas: 0n,
		systemState: 0,
		awaitingForkContinuation: false,
		universeForkTime: 0n,
		vaultCount: 1n,
		shareTokenSupplyAttoShares: 10n ** 36n,
		settlementCollateralAttoEth: 10n ** 18n,
		currentRetentionRate: 10n ** 18n,
		totalCapacityOwnershipAttoRep: 1n,
		feeEligibleCapacityOwnershipAttoRep: 1n,
		mintingCapacityCeilingAttoEth: 1n,
		availableMintingCapacityAttoEth: 1n,
		feeBps: 30n,
		tradingStatus: 0,
		questionOutcome: 3,
		yesReserve: 100n * 10n ** 36n,
		noReserve: 100n * 10n ** 36n,
		lpTotalSupply: 100n * 10n ** 36n,
		...overrides,
	}
}

/** The ticket model for a connected wallet with ample ETH, so tests read estimates through the public model. */
export function ticketModelFor(market: LiveMarket, mode: TradeMode, amount: string, balances?: LiveBalances, overrides: Partial<TradeTicketInputs> = {}) {
	return tradeTicketModel({
		market,
		mode,
		side: 'YES',
		amount,
		amountSettling: false,
		settings: DEFAULT_TRADE_SETTINGS,
		balances,
		balanceState: balances === undefined ? 'disconnected' : 'ready',
		walletConnected: true,
		networkMismatchReason: undefined,
		walletEthAttoEth: 10n ** 24n,
		marketClosed: false,
		acknowledgedImpactBps: undefined,
		workflowLocked: false,
		...overrides,
	})
}

export function ticketEstimateFor(market: LiveMarket, mode: TradeMode, amount: string, balances?: LiveBalances) {
	const { estimate } = ticketModelFor(market, mode, amount, balances)
	if (estimate === undefined) throw new Error(`Expected a ${mode} estimate for ${amount}`)
	return estimate
}
