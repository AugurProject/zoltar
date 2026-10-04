import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { LiveMarket } from '../../protocol/live.js'
import type { TradeSettings } from '../../lib/tradeSettings.js'
import { formatOutcomeQuantity } from '../../lib/shareValue.js'
import * as ticketCopy from '../../copy/tradeTicket.js'
import type { LiveTradingControllerServices, Quote } from './liveTradingTypes.js'
import type { TradeMode, useTransactionWorkflow } from './useTransactionWorkflow.js'
import type { WorkflowOwner } from '../liveTradingControllerHelpers.js'
import type { GuardedWalletWrite } from '../../protocol/tradeQuote.js'
import { authoritativeQuoteMoved, type TradeEstimate } from './tradeTicketModel.js'

type TransactionWorkflow = ReturnType<typeof useTransactionWorkflow>
type Refresh = (configuration?: DeploymentConfiguration, requestedStart?: bigint, owner?: WorkflowOwner, options?: Readonly<{ ownerMarket?: Address }>) => Promise<void>

function priceMovedDetail(estimate: TradeEstimate, authoritativeLongShares: bigint) {
	const amount = formatOutcomeQuantity(authoritativeLongShares, estimate.side)
	return estimate.kind === 'entry' ? ticketCopy.formatRequotedReceive(amount) : ticketCopy.formatRequotedSell(amount)
}

/**
 * The wallet is held to the bounds the ticket displayed, not to fresh slippage around the chain's price: the
 * minimum received and the most shares sold are the estimate's, which the chain result already satisfies.
 */
function withApprovedBounds(quote: Quote, estimate: TradeEstimate): Quote {
	if (quote.kind === 'entry' && estimate.kind === 'entry') return { ...quote, value: { ...quote.value, minimumLongShares: estimate.minimumLongShares } }
	if (quote.kind === 'exit' && estimate.kind === 'exit') {
		const maximumLongShares = estimate.maximumLongShares < quote.value.longBalance ? estimate.maximumLongShares : quote.value.longBalance
		return { ...quote, value: { ...quote.value, maximumLongShares, minimumEth: estimate.minimumAttoEth } }
	}
	return quote
}

/**
 * Trade actions: one submit that re-simulates against the chain right before the wallet opens, compares the result
 * with the estimate the user saw, and stops with a refreshed estimate if the price moved past the slippage bound.
 */
export function createPositionTransactionController({
	configuration,
	selected,
	account,
	walletClient,
	settings,
	workflow,
	services,
	createGuardedWalletWrite,
	executeWithCurrentWalletContext,
	refresh,
}: {
	configuration: DeploymentConfiguration | undefined
	selected: LiveMarket | undefined
	account: Address | undefined
	walletClient: Parameters<LiveTradingControllerServices['simulateEntry']>[0] | undefined
	settings: TradeSettings
	workflow: TransactionWorkflow
	services: LiveTradingControllerServices
	createGuardedWalletWrite(expectedAccount: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	executeWithCurrentWalletContext<T>(expectedAccount: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	refresh: Refresh
}) {
	const { mode, side, transaction, isPositionLocked, liquidityWorkflowLockedRef, setMode, setSide, setAmount, setAcknowledgedImpactBps } = workflow
	// Only this market's own trade holds its inputs; a trade running on another market leaves them free.
	const inputsLocked = () => isPositionLocked(selected?.pool)

	async function submit(estimate: TradeEstimate | undefined) {
		if (configuration === undefined || selected === undefined || account === undefined || walletClient === undefined || estimate === undefined) return
		if (isPositionLocked(selected.pool) || liquidityWorkflowLockedRef.current || estimate.kind !== mode || estimate.side !== side) return
		const market = selected
		const ownerRefresh = { ownerMarket: market.pool }
		const { slippageBps, validityMinutes } = settings
		workflow.setRequoteNotice(market.pool, undefined)
		await transaction.submit<Quote>({
			prepare: async () => {
				await executeWithCurrentWalletContext(account, 'Wallet network changed. Switch back before submitting.', 'Wallet account changed. Reconnect and try again.', async () => undefined)
				const quoteContext = { account, configuration, walletClient }
				const quote: Quote =
					estimate.kind === 'entry'
						? { ...quoteContext, kind: 'entry', value: await withReadTimeout(services.simulateEntry(walletClient, configuration, market, account, side, estimate.payAttoEth, validityMinutes, slippageBps)) }
						: { ...quoteContext, kind: 'exit', value: await withReadTimeout(services.simulateExit(walletClient, configuration, market, account, side, estimate.quote.completeSetShares, validityMinutes, slippageBps)) }
				if (authoritativeQuoteMoved(estimate, quote.value.result.totalLongShares, quote.kind === 'exit' ? quote.value.result.ethOut : undefined)) {
					// Reload the reserves so the estimate on screen shows the price the chain now quotes.
					void refresh(undefined, undefined, 'position', ownerRefresh)
					const requote = ticketCopy.formatPriceMoved(priceMovedDetail(estimate, quote.value.result.totalLongShares), estimate.kind === 'entry' ? ticketCopy.buyOutcome(estimate.side) : ticketCopy.sellOutcome(estimate.side))
					// The submission still stops here; the ticket presents the stop as a prompt to review the new estimate.
					workflow.setRequoteNotice(market.pool, requote)
					throw new Error(requote)
				}
				return withApprovedBounds(quote, estimate)
			},
			send: async (quote, requestSignature) => {
				const guarded = createGuardedWalletWrite(account, 'Wallet network changed while the transaction was checked. Reconnect and try again.', 'Wallet account changed while the transaction was checked. Reconnect and try again.')
				const guardedWrite: GuardedWalletWrite = async write => await guarded(async () => await requestSignature(write))
				return quote.kind === 'entry' ? await services.submitFreshEntry(walletClient, configuration, account, quote.value, guardedWrite) : await services.submitFreshExit(walletClient, configuration, account, quote.value, guardedWrite)
			},
			afterConfirmed: async () => {
				workflow.clearConfirmedAmount(market.pool)
				await refresh(undefined, undefined, 'position', ownerRefresh)
			},
		})
	}

	function resetPositionInput(update: () => void) {
		if (inputsLocked()) return
		update()
		setAcknowledgedImpactBps(undefined)
		transaction.invalidate()
	}

	return {
		submit,
		setMode: (value: TradeMode) =>
			resetPositionInput(() => {
				// Buy amounts are ETH and sell amounts are shares, so an amount never carries across directions.
				if (value !== mode) setAmount('')
				setMode(value)
			}),
		setSide: (value: 'YES' | 'NO') => resetPositionInput(() => setSide(value)),
		setAmount: (value: string) => resetPositionInput(() => setAmount(value)),
		setAcknowledgedImpactBps: (value: bigint | undefined) => {
			if (!inputsLocked()) setAcknowledgedImpactBps(value)
		},
	}
}
