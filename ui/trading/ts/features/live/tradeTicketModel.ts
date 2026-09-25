import { largestExitForLongShares, maximumInsuredExit, quoteEnterPosition, quoteExitPosition, type EnterPositionQuote, type ExitPositionQuote } from '@zoltar/trading-shared/trading/positions'
import { tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import { attoSharesToCollateralAttoEth, collateralAttoEthToAttoShares, SHARE_QUANTITY_DECIMALS } from '../../lib/shareValue.js'
import type { TradeSettings } from '../../lib/tradeSettings.js'
import type { LiveBalances, LiveMarket } from '../../protocol/live.js'
import { maximumAfterSlippage, minimumAfterSlippage } from '../../protocol/tradeQuote.js'
import * as availabilityCopy from '../../copy/availability.js'
import * as ticketCopy from '../../copy/tradeTicket.js'
import type { BalanceState } from './liveTradingTypes.js'
import type { TradeMode } from './useTransactionWorkflow.js'

const BPS = 10_000n
/** Price-impact tiers in basis points: above 2% is worth a caution, above 5% needs an explicit acknowledgment, and above 15% is refused. */
const PRICE_IMPACT_CAUTION_BPS = 200n
const PRICE_IMPACT_WARNING_BPS = 500n
const PRICE_IMPACT_BLOCKED_BPS = 1_500n

export type PriceImpactTier = 'low' | 'caution' | 'warning' | 'blocked'

function priceImpactTier(impactBps: bigint): PriceImpactTier {
	if (impactBps > PRICE_IMPACT_BLOCKED_BPS) return 'blocked'
	if (impactBps > PRICE_IMPACT_WARNING_BPS) return 'warning'
	if (impactBps > PRICE_IMPACT_CAUTION_BPS) return 'caution'
	return 'low'
}

type Reserves = Pick<LiveMarket, 'yesReserve' | 'noReserve' | 'feeBps'>
type Side = 'YES' | 'NO'

type BuyEstimate = Readonly<{
	kind: 'entry'
	side: Side
	payAttoEth: bigint
	quote: EnterPositionQuote
	minimumLongShares: bigint
	impactBps: bigint
}>

type SellEstimate = Readonly<{
	kind: 'exit'
	side: Side
	/** Shares the user asked to sell; the exit spends at most this many. */
	requestedShares: bigint
	quote: ExitPositionQuote
	/** Slippage ceiling on long shares, capped by the wallet balance when it is known. */
	maximumLongShares: bigint
	receiveAttoEth: bigint
	minimumAttoEth: bigint
	impactBps: bigint
}>

export type TradeEstimate = BuyEstimate | SellEstimate

function reservesFor(side: Side, { yesReserve, noReserve }: Reserves, direction: 'entry' | 'exit') {
	// Entries sell the opposite outcome into the pair; exits sell the long outcome for the opposite one.
	const sellsYes = direction === 'entry' ? side === 'NO' : side === 'YES'
	return sellsYes ? { reserveIn: yesReserve, reserveOut: noReserve } : { reserveIn: noReserve, reserveOut: yesReserve }
}

/** Impact of the pool moving against the trade, measured against the pre-trade mid price and excluding the pool fee. */
function buyImpactBps(side: Side, quote: EnterPositionQuote, market: Reserves) {
	const { reserveIn, reserveOut } = reservesFor(side, market, 'entry')
	const netInput = quote.oppositeSharesSwapped - quote.feeAmount
	const idealTotal = quote.completeSetShares + (netInput * reserveOut) / reserveIn
	if (idealTotal === 0n) return 0n
	return ((idealTotal - quote.totalLongShares) * BPS) / idealTotal
}

function sellImpactBps(side: Side, quote: ExitPositionQuote, market: Reserves) {
	const { reserveIn, reserveOut } = reservesFor(side, market, 'exit')
	const idealTotal = quote.completeSetShares + (quote.completeSetShares * reserveIn) / reserveOut
	const actualTotal = quote.totalLongShares - quote.feeAmount
	if (actualTotal === 0n || actualTotal <= idealTotal) return 0n
	return ((actualTotal - idealTotal) * BPS) / actualTotal
}

type EstimateResult = Readonly<{ estimate: TradeEstimate | undefined; problem: string | undefined }>

function estimateBuy(market: LiveMarket, side: Side, payAttoEth: bigint, slippageBps: bigint): EstimateResult {
	if (payAttoEth === 0n) return { estimate: undefined, problem: undefined }
	const completeSets = collateralAttoEthToAttoShares(payAttoEth, market)
	if (completeSets === undefined || completeSets === 0n) return { estimate: undefined, problem: ticketCopy.amountTooSmall }
	// Mirror the swap's rejection of an input that rounds to no output, so the shared math never throws here.
	const { reserveIn, reserveOut } = reservesFor(side, market, 'entry')
	const netInput = (completeSets * (BPS - market.feeBps)) / BPS
	if (reserveIn <= 0n || reserveOut <= 0n || netInput === 0n || (reserveOut * netInput) / (reserveIn + netInput) === 0n) return { estimate: undefined, problem: ticketCopy.amountTooSmall }
	const quote = quoteEnterPosition(side, completeSets, market)
	return { estimate: { kind: 'entry', side, payAttoEth, quote, minimumLongShares: minimumAfterSlippage(quote.totalLongShares, slippageBps), impactBps: buyImpactBps(side, quote, market) }, problem: undefined }
}

function estimateSell(market: LiveMarket, side: Side, requestedShares: bigint, slippageBps: bigint, longBalance: bigint | undefined): EstimateResult {
	if (requestedShares === 0n) return { estimate: undefined, problem: undefined }
	const completeSets = largestExitForLongShares({ ...market, longOutcome: side, longShares: requestedShares })
	if (completeSets === 0n) return { estimate: undefined, problem: ticketCopy.amountTooSmall }
	const quote = quoteExitPosition(side, completeSets, market)
	const receiveAttoEth = attoSharesToCollateralAttoEth(completeSets, market)
	if (receiveAttoEth === 0n) return { estimate: undefined, problem: ticketCopy.amountTooSmall }
	const slippageMaximum = maximumAfterSlippage(quote.totalLongShares, slippageBps)
	const maximumLongShares = longBalance !== undefined && longBalance < slippageMaximum ? longBalance : slippageMaximum
	return {
		estimate: { kind: 'exit', side, requestedShares, quote, maximumLongShares, receiveAttoEth, minimumAttoEth: minimumAfterSlippage(receiveAttoEth, slippageBps), impactBps: sellImpactBps(side, quote, market) },
		problem: undefined,
	}
}

/** Plain decimal text for an input field: no digit grouping, trailing zeros trimmed. */
export function formatAmountInput(value: bigint, decimals: number) {
	const base = 10n ** BigInt(decimals)
	const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
	return fraction === '' ? (value / base).toString() : `${(value / base).toString()}.${fraction}`
}

function amountDecimals(mode: TradeMode) {
	return mode === 'entry' ? 18 : SHARE_QUANTITY_DECIMALS
}

function parseTradeAmount(mode: TradeMode, amount: string) {
	if (amount.trim() === '') return { value: undefined, error: undefined }
	const value = tryParseNonNegativeDecimalInput(amount.trim(), amountDecimals(mode))
	return value === undefined ? { value: undefined, error: mode === 'entry' ? ticketCopy.invalidEthAmount : ticketCopy.invalidShareAmount } : { value, error: undefined }
}

/** Largest sell the wallet can make now: long shares, INVALID coverage, and pair liquidity all bound it. */
function sellableShares(market: LiveMarket, side: Side, balances: LiveBalances | undefined) {
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	if (balances === undefined || longBalance === undefined) return undefined
	const completeSets = maximumInsuredExit({ ...market, longOutcome: side, longBalance, invalidBalance: balances.invalid })
	return completeSets === 0n ? 0n : quoteExitPosition(side, completeSets, market).totalLongShares
}

// Shortcut amounts keep eight decimals, rounded down so they never exceed what can be sold.
const SHORTCUT_STEP = 10n ** BigInt(SHARE_QUANTITY_DECIMALS - 8)

/** A share amount trimmed to eight decimals for the amount field; amounts below that step stay exact. */
export function roundDownShortcut(value: bigint) {
	return value < SHORTCUT_STEP ? value : value - (value % SHORTCUT_STEP)
}

/** The Max, 25%, and 50% shortcuts for a sell, as share amounts. Percentages are of the holding; Max is what can be sold now. */
function sellShortcuts(market: LiveMarket, side: Side, balances: LiveBalances | undefined) {
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	const maximum = sellableShares(market, side, balances)
	if (longBalance === undefined || maximum === undefined || longBalance === 0n) return []
	return [
		{ label: ticketCopy.quarter, value: roundDownShortcut(longBalance / 4n) },
		{ label: ticketCopy.half, value: roundDownShortcut(longBalance / 2n) },
		{ label: ticketCopy.max, value: roundDownShortcut(maximum) },
	].filter(shortcut => shortcut.value > 0n)
}

/** Explains why a sell is larger than the INVALID balance can insure, instead of only disabling the button. */
function invalidCoverageShortfall(estimate: TradeEstimate | undefined, balances: LiveBalances | undefined) {
	if (estimate?.kind !== 'exit' || balances === undefined) return undefined
	if (estimate.quote.invalidRequired <= balances.invalid) return undefined
	return { invalidRequired: estimate.quote.invalidRequired, invalidHeld: balances.invalid }
}

export function probabilityPercent(yesBps: bigint) {
	return Number(yesBps) / 100
}

export type TradeTicketInputs = Readonly<{
	market: LiveMarket
	mode: TradeMode
	side: Side
	amount: string
	/** True while typing has not settled; the estimate still describes the previous amount. */
	amountSettling: boolean
	settings: TradeSettings
	balances: LiveBalances | undefined
	balanceState: BalanceState
	walletConnected: boolean
	networkMismatchReason: string | undefined
	walletEthAttoEth: bigint | undefined
	marketClosed: boolean
	impactAcknowledged: boolean
	workflowLocked: boolean
}>

/** Everything the trade ticket shows and allows, derived from plain inputs so the view stays a pure render. */
export function tradeTicketModel(inputs: TradeTicketInputs) {
	const { market, mode, side, settings, balances } = inputs
	const parsed = parseTradeAmount(mode, inputs.amount)
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	let estimated: EstimateResult = { estimate: undefined, problem: undefined }
	if (parsed.value !== undefined) estimated = mode === 'entry' ? estimateBuy(market, side, parsed.value, settings.slippageBps) : estimateSell(market, side, parsed.value, settings.slippageBps, longBalance)
	const { estimate, problem } = estimated
	const impactTier = estimate === undefined ? undefined : priceImpactTier(estimate.impactBps)
	const shortfall = invalidCoverageShortfall(estimate, balances)
	const needsAcknowledgment = impactTier === 'warning'
	let insufficient: string | undefined
	if (mode === 'entry' && parsed.value !== undefined && inputs.walletEthAttoEth !== undefined && parsed.value > inputs.walletEthAttoEth) insufficient = availabilityCopy.insufficientEthReason
	if (mode === 'exit' && parsed.value !== undefined && longBalance !== undefined && parsed.value > longBalance) insufficient = availabilityCopy.formatInsufficientOutcomeReason(side)
	let balanceReason: string | undefined
	if (inputs.balanceState === 'loading') balanceReason = availabilityCopy.balancesLoadingReason
	else if (inputs.balanceState === 'error') balanceReason = availabilityCopy.balancesUnavailableReason
	const availability: ActionAvailability = createActionAvailability(
		inputs.networkMismatchReason,
		inputs.marketClosed ? availabilityCopy.marketClosedReason : undefined,
		balanceReason,
		parsed.value === undefined || parsed.value === 0n ? (parsed.error ?? availabilityCopy.amountRequiredReason) : undefined,
		inputs.amountSettling ? ticketCopy.updatingEstimate : undefined,
		problem,
		insufficient,
		shortfall === undefined ? undefined : ticketCopy.invalidCoverageReason,
		impactTier === 'blocked' ? ticketCopy.priceImpactBlockedReason : undefined,
		needsAcknowledgment && !inputs.impactAcknowledged ? ticketCopy.acknowledgeImpactReason : undefined,
		inputs.workflowLocked ? availabilityCopy.transactionInProgressReason : undefined,
	)
	let primaryStep: 'connect' | 'switch-network' | 'submit' = 'submit'
	if (inputs.networkMismatchReason !== undefined) primaryStep = 'switch-network'
	else if (!inputs.walletConnected) primaryStep = 'connect'
	const loadingReasons: ReadonlyArray<string> = [availabilityCopy.balancesLoadingReason, ticketCopy.updatingEstimate]
	return {
		parsedAmount: parsed.value,
		amountError: parsed.error,
		estimate,
		estimateProblem: problem,
		impactTier,
		needsAcknowledgment,
		shortfall,
		sellable: mode === 'exit' ? sellableShares(market, side, balances) : undefined,
		shortcuts: mode === 'exit' ? sellShortcuts(market, side, balances) : [],
		// Connecting comes first: without a wallet the ticket still prices the trade, and the button offers to connect.
		primaryStep,
		availability: availability.reason !== undefined && loadingReasons.includes(availability.reason) ? { ...availability, loading: true } : availability,
		actionLabel: mode === 'entry' ? ticketCopy.buyOutcome(side) : ticketCopy.sellOutcome(side),
	}
}

export type TradeTicketModel = ReturnType<typeof tradeTicketModel>

/** The authoritative simulation may price differently from the local estimate; beyond the slippage bound, stop and show the new price. */
export function authoritativeQuoteMoved(estimate: TradeEstimate, authoritativeLongShares: bigint) {
	return estimate.kind === 'entry' ? authoritativeLongShares < estimate.minimumLongShares : authoritativeLongShares > estimate.maximumLongShares
}
