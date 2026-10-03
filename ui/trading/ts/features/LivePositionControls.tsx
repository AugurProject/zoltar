import { outcomeLabel } from '../copy/outcomes.js'
import { useId } from 'preact/hooks'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { formatCurrencyInputBalance, formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatOutcomeWithValue, SHARE_QUANTITY_DECIMALS, shareOutcome } from '../lib/shareValue.js'
import type { TradeSettings } from '../lib/tradeSettings.js'
import { marketAcceptsNewRisk, type LiveBalances, type LiveMarket } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as ticketCopy from '../copy/tradeTicket.js'
import { marketsCopy } from '../copy/markets.js'
import { marketOddsPercent } from '../lib/marketListing.js'
import { transactionInFlight } from './live/transactionPresentation.js'
import { positionControlsWorkflowLocked } from './liveTradingControllerHelpers.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import type { TransactionPhase } from './live/transactionWorkflow.js'
import type { TradeMode } from './live/useTransactionWorkflow.js'
import { panelWalletStep, QuotedTransactionPanel } from './QuotedTransactionPanel.js'
import { TradeEstimatePanel } from './TradeEstimatePanel.js'
import { roundDownShortcut, tradeTicketModel, type TradeEstimate, type TradeTicketModel } from './live/tradeTicketModel.js'
import { useDebouncedValue } from './live/useDebouncedValue.js'

const ESTIMATE_DEBOUNCE_MILLISECONDS = 250

/** The trade-ticket slice of the Trading controller: inputs, workflow result, and actions. */
export type PositionTicket = Readonly<{
	mode: TradeMode
	side: 'YES' | 'NO'
	amount: string
	acknowledgedImpactBps: bigint | undefined
	state: TransactionPhase
	positionHash: Hash | undefined
	message: string | undefined
	positionReceiptWarning: string | undefined
	/** The last submission stopped because the price moved past the estimate; shown as a prompt to review instead of a failure. */
	requoteNotice: string | undefined
	setMode(value: TradeMode): void
	setSide(value: 'YES' | 'NO'): void
	setAmount(value: string): void
	setAcknowledgedImpactBps(value: bigint | undefined): void
	submit(estimate: TradeEstimate | undefined): Promise<void>
}>

export type TicketWallet = Readonly<{
	connected: boolean
	networkMismatchReason: string | undefined
	/** Connecting also switches a wallet on another network to the deployment chain. */
	actionLabel: string
	walletEthAttoEth: bigint | undefined
	connect(): Promise<void>
}>

export type TicketBalances = Readonly<{
	balances: LiveBalances | undefined
	balanceState: BalanceState
	balanceError: string | undefined
	retry(): Promise<void>
}>

function amountHint(model: TradeTicketModel, mode: TradeMode, side: 'YES' | 'NO', holdings: LiveBalances | undefined, walletEthAttoEth: bigint | undefined, market: LiveMarket) {
	if (mode === 'entry') return walletEthAttoEth === undefined ? undefined : ticketCopy.walletBalance(`${formatTrimmedUnits(walletEthAttoEth)} ${workflowCopy.eth}`)
	const holding = side === 'YES' ? holdings?.yes : holdings?.no
	if (holding === undefined || model.sellable === undefined) return undefined
	// The sellable amount only needs saying when INVALID coverage or pool depth holds it below the holding.
	if (model.sellable >= holding) return ticketCopy.holdingHint(formatOutcomeWithValue(holding, side, market, 4, 'down'))
	return ticketCopy.sellableHint(formatOutcomeWithValue(holding, side, market, 4, 'down'), formatOutcomeWithValue(model.sellable, side, market, 4, 'down'))
}

function InvalidCoverageExplanation({ model, side, disabled, onUseSellable, market }: { model: TradeTicketModel; market: LiveMarket; side: 'YES' | 'NO'; disabled: boolean; onUseSellable(value: string): void }) {
	if (model.shortfall === undefined) return null
	const sellable = model.sellable ?? 0n
	return (
		<WarningSurface role='status' surface='flat' variant='compact' className='trade-invalid-coverage'>
			<p>{ticketCopy.invalidCoverageExplanation(formatOutcomeWithValue(model.shortfall.invalidRequired, shareOutcome.invalid, market), formatOutcomeWithValue(model.shortfall.invalidHeld, shareOutcome.invalid, market), formatOutcomeWithValue(sellable, side, market, 4, 'down'), side)}</p>
			{sellable > 0n ? (
				<button type='button' className='secondary' disabled={disabled} onClick={() => onUseSellable(formatCurrencyInputBalance(roundDownShortcut(sellable), SHARE_QUANTITY_DECIMALS))}>
					{ticketCopy.sellInsteadAction(formatOutcomeWithValue(sellable, side, market, 4, 'down'))}
				</button>
			) : null}
		</WarningSurface>
	)
}

/**
 * Trade ticket container: debounces the amount, derives the pure ticket model, and renders the estimate and the
 * one-button workflow. Without a wallet it still prices the trade and the button offers to connect.
 */
export function LivePositionControls({
	market,
	nowSeconds,
	settings,
	onSettingsChange,
	ticket,
	wallet,
	holdings,
	externallyLocked,
	onOpenSettlement,
}: {
	market: LiveMarket
	nowSeconds: bigint
	settings: TradeSettings
	/** Lets the estimate change slippage and validity in place. */
	onSettingsChange?: ((settings: TradeSettings) => void) | undefined
	ticket: PositionTicket
	wallet: TicketWallet
	holdings: TicketBalances
	externallyLocked: boolean
	/** Opens the market's Settlement view, which the closed-market notice points to. */
	onOpenSettlement?: (() => void) | undefined
}) {
	const { mode, side, state } = ticket
	const settledAmount = useDebouncedValue(ticket.amount, ESTIMATE_DEBOUNCE_MILLISECONDS)
	const closed = !marketAcceptsNewRisk(market, nowSeconds)
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, ticket.positionReceiptWarning)
	const model = tradeTicketModel({
		market,
		mode,
		side,
		amount: settledAmount,
		amountSettling: settledAmount !== ticket.amount,
		settings,
		balances: holdings.balances,
		balanceState: holdings.balanceState,
		walletConnected: wallet.connected,
		networkMismatchReason: wallet.networkMismatchReason,
		walletEthAttoEth: wallet.walletEthAttoEth,
		marketClosed: closed,
		nowSeconds,
		acknowledgedImpactBps: ticket.acknowledgedImpactBps,
		workflowLocked,
	})
	// After a receipt the workflow stays locked until the market and balances have been re-read; say so instead of showing a silent disabled form.
	const revalidatingAfterReceipt = state === 'confirmed' && externallyLocked
	const amountId = useId()
	const controlsDisabled = closed || workflowLocked
	const estimate = model.estimate
	const walletStep = panelWalletStep(wallet, model.primaryStep === 'submit', workflowLocked)
	const confirmedText = revalidatingAfterReceipt ? workflowCopy.revalidatingAfterReceipt(workflowCopy.actionConfirmedOnchain(model.actionLabel)) : undefined
	const requoted = state === 'error' && ticket.requoteNotice !== undefined
	const odds = marketOddsPercent(market)
	const selectMode = (next: TradeMode) => {
		ticket.setMode(next)
		// Selling starts on the outcome the wallet holds, instead of an empty holding of the outcome last bought.
		const held = side === 'YES' ? holdings.balances?.yes : holdings.balances?.no
		const otherHeld = side === 'YES' ? holdings.balances?.no : holdings.balances?.yes
		if (next === 'exit' && held === 0n && otherHeld !== undefined && otherHeld > 0n) ticket.setSide(side === 'YES' ? 'NO' : 'YES')
	}
	const submit = () => void ticket.submit(estimate)
	const canSubmit = walletStep === undefined && !model.availability.disabled && !transactionInFlight(state)
	return (
		<div className='position-controls' aria-busy={revalidatingAfterReceipt}>
			{closed ? (
				<UserMessage
					className='trade-ticket-closed'
					detail={ticketCopy.tradingEndedDetail}
					actions={
						onOpenSettlement === undefined ? undefined : (
							<button type='button' className='secondary' onClick={onOpenSettlement}>
								{ticketCopy.openSettlement}
							</button>
						)
					}
				/>
			) : null}
			<div className='trade-ticket-switchers'>
				<ViewTabs
					ariaLabel={ticketCopy.tradeDirection}
					semantics='switcher'
					variant='segmented'
					size='compact'
					value={mode}
					onChange={selectMode}
					options={[
						{ value: 'entry', label: ticketCopy.buy, disabled: controlsDisabled },
						{ value: 'exit', label: ticketCopy.sell, disabled: controlsDisabled },
					]}
				/>
				<ViewTabs
					ariaLabel={odds === undefined ? workflowCopy.outcome : ticketCopy.outcomeWithOdds}
					className='outcome-picker'
					semantics='switcher'
					variant='segmented'
					size='compact'
					value={side}
					onChange={ticket.setSide}
					options={[
						{ value: 'YES', label: odds === undefined ? workflowCopy.yes : marketsCopy.outcomeOdds(workflowCopy.yes, odds.yes), disabled: controlsDisabled },
						{ value: 'NO', label: odds === undefined ? workflowCopy.no : marketsCopy.outcomeOdds(workflowCopy.no, odds.no), disabled: controlsDisabled },
					]}
				/>
			</div>
			<FormField id={amountId} label={mode === 'entry' ? ticketCopy.youPay : ticketCopy.sharesToSell}>
				<FormInput
					id={amountId}
					name='amount'
					value={ticket.amount}
					placeholder={workflowCopy.amountPlaceholder}
					disabled={controlsDisabled}
					inputMode='decimal'
					autoComplete='off'
					adornment={mode === 'entry' ? workflowCopy.eth : outcomeLabel(side)}
					error={model.amountError ?? model.insufficientReason}
					hint={amountHint(model, mode, side, holdings.balances, wallet.walletEthAttoEth, market)}
					onInput={event => ticket.setAmount(event.currentTarget.value)}
					onKeyDown={event => {
						if (event.key === 'Enter' && canSubmit) submit()
					}}
				/>
			</FormField>
			{model.shortcuts.length === 0 ? null : (
				<div className='trade-amount-shortcuts' role='group' aria-label={mode === 'entry' ? ticketCopy.buyShortcutsLabel : ticketCopy.sellShortcutsLabel}>
					{model.shortcuts.map(shortcut => (
						<button key={shortcut.label} type='button' className='secondary' disabled={controlsDisabled} onClick={() => ticket.setAmount(formatCurrencyInputBalance(shortcut.value, SHARE_QUANTITY_DECIMALS))}>
							{shortcut.label}
						</button>
					))}
				</div>
			)}
			<InvalidCoverageExplanation market={market} model={model} side={side} disabled={controlsDisabled} onUseSellable={ticket.setAmount} />
			{requoted ? <UserMessage placement='page' tone='warning' announcement='polite' className='trade-requote-notice' detail={ticket.requoteNotice} /> : null}
			<QuotedTransactionPanel phase={state} actionLabel={model.actionLabel} availability={model.availability} statusText={confirmedText} transactionHash={ticket.positionHash} receiptWarning={ticket.positionReceiptWarning} error={requoted ? undefined : ticket.message} walletStep={walletStep} onSubmit={submit}>
				{estimate === undefined || model.impactTier === undefined ? null : (
					<TradeEstimatePanel
						estimate={estimate}
						market={market}
						settings={settings}
						balances={holdings.balances}
						onSettingsChange={onSettingsChange}
						impactTier={model.impactTier}
						impactAcknowledged={model.impactAcknowledged}
						disabled={controlsDisabled}
						onAcknowledgeImpact={checked => ticket.setAcknowledgedImpactBps(checked ? estimate.impactBps : undefined)}
					/>
				)}
			</QuotedTransactionPanel>
		</div>
	)
}
