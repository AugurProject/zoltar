import { capSubmissionDeadline, submissionWindowBlocker } from '../../protocol/submissionWindow.js'
import { largestExitForLongShares, maximumInsuredExit, quoteEnterPosition, quoteExitPosition, type EnterPositionQuote, type ExitPositionQuote } from '@zoltar/trading-shared/trading/positions'
import { tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { ETH_GAS_RESERVE_ATTO_ETH, getSpendableEthBalance } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import { attoSharesToCollateralAttoEth, collateralAttoEthToAttoShares, SHARE_QUANTITY_DECIMALS } from '../../lib/shareValue.js'
import type { TradeSettings } from '../../lib/tradeSettings.js'
import type { LiveBalances, LiveMarket } from '../../protocol/live.js'
import { maximumAfterSlippage, minimumAfterSlippage } from '../../protocol/tradeQuote.js'
import * as availabilityCopy from '../../copy/availability.js'
import * as ticketCopy from '../../copy/tradeTicket.js'
import { sellHoldingFeeBlocker } from '../../protocol/holdingFees.js'
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

// Shortcut amounts keep eight decimals, rounded down so they never exceed what can be sold or spent; ETH and shares share the precision.
const SHORTCUT_STEP = 10n ** BigInt(SHARE_QUANTITY_DECIMALS - 8)

/** A share or ETH amount trimmed to eight decimals for the amount field; amounts below that step stay exact. */
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

/** The 25%, 50%, and Max shortcuts for a buy: shares of the wallet's ETH less the gas reserve, trimmed to eight decimals like the sell shortcuts. */
function buyShortcuts(walletEthAttoEth: bigint | undefined) {
	if (walletEthAttoEth === undefined) return []
	const spendable = getSpendableEthBalance(walletEthAttoEth)
	return [
		{ label: ticketCopy.quarter, value: roundDownShortcut(spendable / 4n) },
		{ label: ticketCopy.half, value: roundDownShortcut(spendable / 2n) },
		{ label: ticketCopy.max, value: roundDownShortcut(spendable) },
	].filter(shortcut => shortcut.value > 0n)
}

/** A buy above the wallet balance cannot be paid; one that only eats into the gas reserve would leave nothing to send it with. */
function insufficientEthReason(payAttoEth: bigint, walletEthAttoEth: bigint) {
	if (payAttoEth > walletEthAttoEth) return availabilityCopy.insufficientEthReason
	if (payAttoEth > getSpendableEthBalance(walletEthAttoEth)) return ticketCopy.gasReserveReason(formatTrimmedUnits(ETH_GAS_RESERVE_ATTO_ETH))
	return undefined
}

/** Explains why a sell is larger than the INVALID balance can insure, instead of only disabling the button. */
function invalidCoverageShortfall(estimate: TradeEstimate | undefined, balances: LiveBalances | undefined) {
	if (estimate?.kind !== 'exit' || balances === undefined) return undefined
	if (estimate.quote.invalidRequired <= balances.invalid) return undefined
	return { invalidRequired: estimate.quote.invalidRequired, invalidHeld: balances.invalid }
}

/** What a buy pays out if its outcome wins, at the pool's current backing, and the gain over the ETH paid. */
export function buyReturn(estimate: BuyEstimate, market: LiveMarket) {
	const payoutAttoEth = attoSharesToCollateralAttoEth(estimate.quote.totalLongShares, market)
	const profitAttoEth = payoutAttoEth - estimate.payAttoEth
	return { payoutAttoEth, profitAttoEth, returnBps: (profitAttoEth * BPS) / estimate.payAttoEth }
}

/**
 * The pool fee in ETH. The pair takes it in the outcome sold into it, so it is valued at that outcome's price before
 * the trade and the pool's current backing; an approximation, shown as one.
 */
export function poolFeeAttoEth(estimate: TradeEstimate, market: LiveMarket) {
	const feeOutcomeIsYes = estimate.kind === 'entry' ? estimate.side === 'NO' : estimate.side === 'YES'
	const feeOutcomeBps = feeOutcomeIsYes ? estimate.quote.conditionalYesBpsBefore : BPS - estimate.quote.conditionalYesBpsBefore
	return attoSharesToCollateralAttoEth((estimate.quote.feeAmount * feeOutcomeBps) / BPS, market)
}

/** The wallet's holding of the traded outcome once the trade settles; undefined while balances are unknown or below the sale. */
export function holdingAfterTrade(estimate: TradeEstimate, balances: LiveBalances | undefined) {
	const held = estimate.side === 'YES' ? balances?.yes : balances?.no
	if (held === undefined) return undefined
	if (estimate.kind === 'entry') return held + estimate.quote.totalLongShares
	return held < estimate.quote.totalLongShares ? undefined : held - estimate.quote.totalLongShares
}

/** What the trade ticket holds for one market between renders. */
export type TicketInputs = Readonly<{
	mode: TradeMode
	side: Side
	amount: string
	/** The impact the user accepted; a later estimate with a higher impact needs a new acknowledgment. */
	acknowledgedImpactBps: bigint | undefined
	/** Set when the last submission stopped because the chain re-quoted past the estimate; the ticket shows it as a prompt to review, not a failure. */
	requoteNotice: string | undefined
}>

/**
 * Changes what the ticket trades. The amount is ETH on a buy and shares of one outcome on a sell, so it is cleared
 * whenever the selection changes its unit; an accepted price impact named the previous trade, so it never carries over.
 * Selecting what is already selected returns the same inputs.
 */
export function ticketInputsAfterSelection(previous: TicketInputs, selection: Partial<Pick<TicketInputs, 'mode' | 'side'>>): TicketInputs {
	const next = { ...previous, ...selection }
	if (next.mode === previous.mode && next.side === previous.side) return previous
	const amountUnitChanged = next.mode !== previous.mode || next.mode === 'exit'
	return { ...next, amount: amountUnitChanged ? '' : previous.amount, acknowledgedImpactBps: undefined }
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
	nowSeconds: bigint
	/** The price impact the user accepted, if any; it covers only estimates at or below that impact. */
	acknowledgedImpactBps: bigint | undefined
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
	const impactAcknowledged = estimate !== undefined && inputs.acknowledgedImpactBps !== undefined && estimate.impactBps <= inputs.acknowledgedImpactBps
	let insufficient: string | undefined
	if (mode === 'entry' && parsed.value !== undefined && inputs.walletEthAttoEth !== undefined) insufficient = insufficientEthReason(parsed.value, inputs.walletEthAttoEth)
	if (mode === 'exit' && parsed.value !== undefined && longBalance !== undefined && parsed.value > longBalance) insufficient = availabilityCopy.formatInsufficientOutcomeReason(side)
	let balanceReason: string | undefined
	if (inputs.balanceState === 'loading') balanceReason = availabilityCopy.balancesLoadingReason
	else if (inputs.balanceState === 'error') balanceReason = availabilityCopy.balancesUnavailableReason
	const actionAvailability = createActionAvailability(
		inputs.networkMismatchReason,
		inputs.marketClosed ? ticketCopy.tradingEndedReason : undefined,
		submissionWindowBlocker(market, mode, inputs.nowSeconds),
		balanceReason,
		parsed.error,
		inputs.amountSettling ? ticketCopy.updatingEstimate : undefined,
		problem,
		insufficient,
		shortfall === undefined ? undefined : ticketCopy.invalidCoverageReason,
		estimate?.kind === 'exit' ? sellHoldingFeeBlocker(market, estimate.quote.completeSetShares, estimate.minimumAttoEth, capSubmissionDeadline(market, mode, inputs.nowSeconds + settings.validityMinutes * 60n)) : undefined,
		impactTier === 'blocked' ? ticketCopy.priceImpactBlockedReason : undefined,
		needsAcknowledgment && !impactAcknowledged ? ticketCopy.acknowledgeImpactReason : undefined,
		inputs.workflowLocked ? availabilityCopy.transactionInProgressReason : undefined,
	)
	const availability: ActionAvailability = { ...actionAvailability, disabled: actionAvailability.disabled || parsed.value === undefined || parsed.value <= 0n }
	let primaryStep: 'connect' | 'switch-network' | 'submit' = 'submit'
	if (inputs.networkMismatchReason !== undefined) primaryStep = 'switch-network'
	else if (!inputs.walletConnected) primaryStep = 'connect'
	const loadingReasons: ReadonlyArray<string> = [availabilityCopy.balancesLoadingReason, ticketCopy.updatingEstimate]
	return {
		parsedAmount: parsed.value,
		amountError: parsed.error,
		estimate,
		estimateProblem: problem,
		/** A buy the wallet cannot pay for or a sell above the holding, said at the amount field as well as the button. */
		insufficientReason: insufficient,
		impactTier,
		needsAcknowledgment,
		impactAcknowledged,
		shortfall,
		sellable: mode === 'exit' ? sellableShares(market, side, balances) : undefined,
		shortcuts: mode === 'exit' ? sellShortcuts(market, side, balances) : buyShortcuts(inputs.walletEthAttoEth),
		// Connecting comes first: without a wallet the ticket still prices the trade, and the button offers to connect.
		primaryStep,
		availability: availability.reason !== undefined && loadingReasons.includes(availability.reason) ? { ...availability, loading: true } : availability,
		actionLabel: mode === 'entry' ? ticketCopy.buyOutcome(side) : ticketCopy.sellOutcome(side),
	}
}

export type TradeTicketModel = ReturnType<typeof tradeTicketModel>

/** The authoritative simulation may price differently from the local estimate; beyond the slippage bound, stop and show the new price. */
export function authoritativeQuoteMoved(estimate: TradeEstimate, authoritativeLongShares: bigint, authoritativeAttoEthOut?: bigint) {
	if (estimate.kind === 'entry') return authoritativeLongShares < estimate.minimumLongShares
	return authoritativeLongShares > estimate.maximumLongShares || (authoritativeAttoEthOut !== undefined && authoritativeAttoEthOut < estimate.minimumAttoEth)
}
