import { useId } from 'preact/hooks'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { BackingDetails } from './BackingDetails.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { formatOutcomeQuantity, SHARE_QUANTITY_DECIMALS } from '../lib/shareValue.js'
import type { TradeSettings } from '../lib/tradeSettings.js'
import { marketAcceptsNewRisk, type LiveBalances, type LiveMarket, type ShareOutcome } from '../protocol/live.js'
import { conditionalYesBps } from '@zoltar/trading-shared/trading/math'
import * as workflowCopy from '../copy/workflows.js'
import * as ticketCopy from '../copy/tradeTicket.js'
import * as appCopy from '../copy/app.js'
import { positionControlsWorkflowLocked } from './liveTradingControllerHelpers.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import type { TransactionPhase } from './live/transactionWorkflow.js'
import type { TradeMode } from './live/useTransactionWorkflow.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import { QuotedTransactionPanel, type WalletStep } from './QuotedTransactionPanel.js'
import { TradeEstimatePanel } from './TradeEstimatePanel.js'
import { formatAmountInput, probabilityPercent, roundDownShortcut, tradeTicketModel, type TradeEstimate, type TradeTicketModel } from './live/tradeTicketModel.js'
import { useDebouncedValue } from './live/useDebouncedValue.js'

const ESTIMATE_DEBOUNCE_MILLISECONDS = 250

/** The trade-ticket slice of the Trading controller: inputs, workflow result, and actions. */
export type PositionTicket = Readonly<{
	mode: TradeMode
	side: 'YES' | 'NO'
	amount: string
	impactAcknowledged: boolean
	state: TransactionPhase
	positionHash: Hash | undefined
	message: string | undefined
	positionReceiptWarning: string | undefined
	setMode(value: TradeMode): void
	setSide(value: 'YES' | 'NO'): void
	setAmount(value: string): void
	setImpactAcknowledged(value: boolean): void
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

function currentYesPercent(market: LiveMarket) {
	return market.yesReserve + market.noReserve === 0n ? 0 : probabilityPercent(conditionalYesBps(market.yesReserve, market.noReserve))
}

function walletBalanceLabel(value: bigint | undefined, outcome: ShareOutcome, balanceState: BalanceState) {
	if (value !== undefined) return formatOutcomeQuantity(value, outcome)
	if (balanceState === 'loading') return appCopy.loadingBalances
	if (balanceState === 'error') return appCopy.unavailable
	// The primary button already offers to connect; the holdings stay quiet until a wallet is known.
	return ticketCopy.noBalance
}

function amountHint(model: TradeTicketModel, mode: TradeMode, side: 'YES' | 'NO', holdings: LiveBalances | undefined, walletEthAttoEth: bigint | undefined) {
	if (mode === 'entry') return walletEthAttoEth === undefined ? undefined : ticketCopy.walletBalance(`${formatTrimmedUnits(walletEthAttoEth)} ${workflowCopy.eth}`)
	const holding = side === 'YES' ? holdings?.yes : holdings?.no
	if (holding === undefined || model.sellable === undefined) return undefined
	// The sellable amount only needs saying when INVALID coverage or pool depth holds it below the holding.
	if (model.sellable >= holding) return ticketCopy.holdingHint(formatOutcomeQuantity(holding, side))
	return ticketCopy.sellableHint(formatOutcomeQuantity(holding, side), formatOutcomeQuantity(model.sellable, side, 4, 'down'))
}

function InvalidCoverageExplanation({ model, side, disabled, onUseSellable }: { model: TradeTicketModel; side: 'YES' | 'NO'; disabled: boolean; onUseSellable(value: string): void }) {
	if (model.shortfall === undefined) return null
	const sellable = model.sellable ?? 0n
	return (
		<WarningSurface role='status' surface='flat' variant='compact' className='trade-invalid-coverage'>
			<p>{ticketCopy.invalidCoverageExplanation(formatOutcomeQuantity(model.shortfall.invalidRequired, 'INVALID'), formatOutcomeQuantity(model.shortfall.invalidHeld, 'INVALID'), formatOutcomeQuantity(sellable, side, 4, 'down'), side)}</p>
			{sellable > 0n ? (
				<button type='button' className='secondary' disabled={disabled} onClick={() => onUseSellable(formatAmountInput(roundDownShortcut(sellable), SHARE_QUANTITY_DECIMALS))}>
					{ticketCopy.sellInsteadAction(formatOutcomeQuantity(sellable, side, 4, 'down'))}
				</button>
			) : null}
		</WarningSurface>
	)
}

/**
 * Trade ticket container: debounces the amount, derives the pure ticket model, and renders the estimate and the
 * one-button workflow. Without a wallet it still prices the trade and the button offers to connect.
 */
export function LivePositionControls({ market, nowSeconds, settings, ticket, wallet, holdings, externallyLocked }: { market: LiveMarket; nowSeconds: bigint; settings: TradeSettings; ticket: PositionTicket; wallet: TicketWallet; holdings: TicketBalances; externallyLocked: boolean }) {
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
		impactAcknowledged: ticket.impactAcknowledged,
		workflowLocked,
	})
	// After a receipt the workflow stays locked until the market and balances have been re-read; say so instead of showing a silent disabled form.
	const revalidatingAfterReceipt = state === 'confirmed' && externallyLocked
	const amountId = useId()
	const controlsDisabled = closed || workflowLocked
	const estimate = model.estimate
	const walletStep: WalletStep | undefined = model.primaryStep === 'submit' ? undefined : { label: wallet.actionLabel, disabled: workflowLocked, onClick: () => void wallet.connect() }
	const confirmedText = revalidatingAfterReceipt ? workflowCopy.revalidatingAfterReceipt(workflowCopy.actionConfirmedOnchain(model.actionLabel)) : undefined
	return (
		<div className='position-controls' aria-busy={holdings.balanceState === 'loading' || revalidatingAfterReceipt}>
			<ProbabilityBar yesPercent={estimate === undefined ? currentYesPercent(market) : probabilityPercent(estimate.quote.conditionalYesBpsAfter)} beforePercent={estimate === undefined ? undefined : probabilityPercent(estimate.quote.conditionalYesBpsBefore)} />
			<BackingDetails market={market} />
			<ul className='portfolio-holdings trade-holdings' aria-busy={holdings.balanceState === 'loading'}>
				<li className={`portfolio-holding-yes ${side === 'YES' ? 'selected-holding' : ''}`} data-outcome='yes'>
					<span className='holding-quantity'>{walletBalanceLabel(holdings.balances?.yes, workflowCopy.yes, holdings.balanceState)}</span>
					{holdings.balances === undefined ? <small className='payout-caption'>{workflowCopy.walletYes}</small> : undefined}
				</li>
				<li className={`portfolio-holding-no ${side === 'NO' ? 'selected-holding' : ''}`} data-outcome='no'>
					<span className='holding-quantity'>{walletBalanceLabel(holdings.balances?.no, workflowCopy.no, holdings.balanceState)}</span>
					{holdings.balances === undefined ? <small className='payout-caption'>{workflowCopy.walletNo}</small> : undefined}
				</li>
				<li data-outcome='invalid'>
					<span className='holding-quantity'>{walletBalanceLabel(holdings.balances?.invalid, 'INVALID', holdings.balanceState)}</span>
					{holdings.balances === undefined ? <small className='payout-caption'>{workflowCopy.walletInvalid}</small> : undefined}
				</li>
			</ul>
			{holdings.balanceState === 'loading' && holdings.balances !== undefined ? <LoadingText>{appCopy.loadingBalances}</LoadingText> : undefined}
			{holdings.balanceState === 'error' && wallet.networkMismatchReason === undefined ? <BalanceLoadError message={workflowCopy.walletBalancesUnavailable(holdings.balanceError ?? workflowCopy.balanceRefreshFailed)} retry={holdings.retry} disabled={workflowLocked} /> : null}
			<div className='trade-ticket-switchers'>
				<ViewTabs
					ariaLabel={ticketCopy.tradeDirection}
					semantics='switcher'
					variant='segmented'
					size='compact'
					value={mode}
					onChange={ticket.setMode}
					options={[
						{ value: 'entry', label: ticketCopy.buy, disabled: controlsDisabled },
						{ value: 'exit', label: ticketCopy.sell, disabled: controlsDisabled },
					]}
				/>
				<ViewTabs
					ariaLabel={workflowCopy.outcome}
					className='outcome-picker'
					semantics='switcher'
					variant='segmented'
					size='compact'
					value={side}
					onChange={ticket.setSide}
					options={[
						{ value: 'YES', label: workflowCopy.yes, disabled: controlsDisabled },
						{ value: 'NO', label: workflowCopy.no, disabled: controlsDisabled },
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
					adornment={mode === 'entry' ? workflowCopy.eth : side}
					error={model.amountError}
					hint={amountHint(model, mode, side, holdings.balances, wallet.walletEthAttoEth)}
					onInput={event => ticket.setAmount(event.currentTarget.value)}
				/>
			</FormField>
			{model.shortcuts.length === 0 ? null : (
				<div className='trade-amount-shortcuts' role='group' aria-label={ticketCopy.sellShortcutsLabel}>
					{model.shortcuts.map(shortcut => (
						<button key={shortcut.label} type='button' className='secondary' disabled={controlsDisabled} onClick={() => ticket.setAmount(formatAmountInput(shortcut.value, SHARE_QUANTITY_DECIMALS))}>
							{shortcut.label}
						</button>
					))}
				</div>
			)}
			<InvalidCoverageExplanation model={model} side={side} disabled={controlsDisabled} onUseSellable={ticket.setAmount} />
			<QuotedTransactionPanel phase={state} actionLabel={model.actionLabel} availability={model.availability} statusText={confirmedText} transactionHash={ticket.positionHash} receiptWarning={ticket.positionReceiptWarning} error={ticket.message} walletStep={walletStep} onSubmit={() => void ticket.submit(estimate)}>
				{estimate === undefined || model.impactTier === undefined ? null : <TradeEstimatePanel estimate={estimate} market={market} settings={settings} impactTier={model.impactTier} impactAcknowledged={ticket.impactAcknowledged} disabled={controlsDisabled} onAcknowledgeImpact={ticket.setImpactAcknowledged} />}
			</QuotedTransactionPanel>
		</div>
	)
}
