import type { Address, WalletClient } from '@zoltar/shared/ethereum'
import type { LiveMarket, SettlementOperation, ShareOutcome } from '../../protocol/live.js'
import type { LiveSettlementServices } from '../LiveSettlementControls.js'
import type { BalanceState } from './liveTradingTypes.js'

export type SettlementQuote = Awaited<ReturnType<LiveSettlementServices['simulate']>> & Readonly<{ account: Address; walletClient: WalletClient; inputRevision: number }>

export function settlementQuoteMatchesInputs(
	quote: SettlementQuote | undefined,
	inputRevision: number,
	market: LiveMarket,
	operation: SettlementOperation,
	parsedAmount: bigint | undefined,
	sourceOutcome: ShareOutcome,
	targetOutcomeIndexes: readonly bigint[],
	account: Address | undefined,
	walletClient: WalletClient | undefined,
) {
	if (quote === undefined || quote.inputRevision !== inputRevision || quote.market.pool !== market.pool || quote.operation !== operation || quote.account !== account || quote.walletClient !== walletClient) return false
	if (quote.operation === 'redeem-complete-set') return quote.amount === parsedAmount
	if (quote.operation === 'migrate-shares') return quote.sourceOutcome === sourceOutcome && quote.targetOutcomeIndexes.length === targetOutcomeIndexes.length && quote.targetOutcomeIndexes.every(target => targetOutcomeIndexes.includes(target))
	return true
}

export function settlementQuoteCanSubmit(balanceState: BalanceState, inputBlocker: string | undefined, quoteMatchesInputs: boolean) {
	return balanceState === 'ready' && inputBlocker === undefined && quoteMatchesInputs
}
