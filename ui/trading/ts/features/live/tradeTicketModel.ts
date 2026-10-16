import { capSubmissionDeadline, submissionWindowBlocker } from '../../protocol/submissionWindow.js'
import { largestExitForLongShares, quoteEnterPosition, quoteExitPosition, type EnterPositionQuote, type ExitPositionQuote } from '@zoltar/trading-shared/trading/positions'
import { getAmountInputErrorMessage, validateAmountInput } from '@zoltar/ui-core-shared/forms/amountInput.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { ETH_GAS_RESERVE_ATTO_ETH, getSpendableEthBalance } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { attoSharesToCollateralAttoEth, collateralAttoEthToAttoShares, formatOutcomeQuantity, SHARE_QUANTITY_DECIMALS } from '../../lib/shareValue.js'
import type { TradeSettings } from '../../lib/tradeSettings.js'
import type { LiveBalances, LiveMarket } from '../../protocol/live.js'
import { maximumAfterSlippage, minimumAfterSlippage } from '../../protocol/tradeQuote.js'
import { formatEthAmount } from '../../copy/outcomes.js'
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
	/** Shares the user typed; the signed maximum never exceeds them. */
	requestedShares: bigint
	quote: ExitPositionQuote
	/**
	 * The most long shares the wallet signs over: the estimate plus the slippage allowance, which is taken out of the typed
	 * amount instead of added to it, and never above the wallet balance when it is known. The router refunds what it does not use.
	 */
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

function minimum(first: bigint, second: bigint) {
	return first < second ? first : second
}

/** The long shares an exit may cost before slippage, so that the cost plus the slippage allowance stays within `shares`. */
function exitBudget(shares: bigint, slippageBps: bigint) {
	return (shares * BPS) / (BPS + slippageBps)
}

function estimateSell(market: LiveMarket, side: Side, requestedShares: bigint, slippageBps: bigint, longBalance: bigint | undefined): EstimateResult {
	if (requestedShares === 0n) return { estimate: undefined, problem: undefined }
	// The router takes up to the signed maximum from the wallet, so the exit is sized for the typed amount less the slippage allowance.
	const completeSets = largestExitForLongShares({ ...market, longOutcome: side, longShares: exitBudget(requestedShares, slippageBps) })
	if (completeSets === 0n) return { estimate: undefined, problem: ticketCopy.amountTooSmall }
	const quote = quoteExitPosition(side, completeSets, market)
	const receiveAttoEth = attoSharesToCollateralAttoEth(completeSets, market)
	if (receiveAttoEth === 0n) return { estimate: undefined, problem: ticketCopy.amountTooSmall }
	const allowed = minimum(maximumAfterSlippage(quote.totalLongShares, slippageBps), requestedShares)
	const maximumLongShares = longBalance === undefined ? allowed : minimum(allowed, longBalance)
	return {
		estimate: { kind: 'exit', side, requestedShares, quote, maximumLongShares, receiveAttoEth, minimumAttoEth: minimumAfterSlippage(receiveAttoEth, slippageBps), impactBps: sellImpactBps(side, quote, market) },
		problem: undefined,
	}
}

function amountDecimals(mode: TradeMode) {
	return mode === 'entry' ? 18 : SHARE_QUANTITY_DECIMALS
}

/**
 * Reads the typed amount with the shared amount rules, so each unreadable entry names its own problem. Zero is accepted
 * here: it is usually an amount still being typed, and the action's reason already asks for more.
 */
function parseTradeAmount(mode: TradeMode, amount: string) {
	const decimals = amountDecimals(mode)
	const validation = validateAmountInput(amount, { decimals, allowZero: true })
	if (validation.status === 'valid') return { value: validation.amount, error: undefined }
	return { value: undefined, error: getAmountInputErrorMessage(validation, { decimals }) }
}

/** The most complete sets, up to `cap`, an exit redeems at or below the refused price-impact tier. Impact grows with the exit, so a binary search finds it. */
function largestExitWithinImpact(market: LiveMarket, side: Side, cap: bigint) {
	const withinLimit = (completeSets: bigint) => completeSets === 0n || sellImpactBps(side, quoteExitPosition(side, completeSets, market), market) <= PRICE_IMPACT_BLOCKED_BPS
	if (withinLimit(cap)) return cap
	let low = 0n
	let high = cap
	while (high - low > 1n) {
		const middle = (low + high) / 2n
		if (withinLimit(middle)) low = middle
		else high = middle
	}
	return low
}

/**
 * The largest share amount a sale accepts now. The wallet's long shares (less the slippage allowance), its INVALID
 * coverage, the pair's depth, and the refused price-impact tier all bound the exit; omitted balances leave their bound
 * out. When only the holding binds, the whole holding can be entered.
 */
function largestTradableSell(market: LiveMarket, side: Side, slippageBps: bigint, longBalance: bigint | undefined, invalidBalance: bigint | undefined) {
	const oppositeReserve = side === 'YES' ? market.noReserve : market.yesReserve
	const depth = oppositeReserve > 0n ? oppositeReserve - 1n : 0n
	const affordable = longBalance === undefined ? depth : largestExitForLongShares({ ...market, longOutcome: side, longShares: exitBudget(longBalance, slippageBps) })
	const insured = invalidBalance === undefined ? affordable : minimum(affordable, invalidBalance)
	const completeSets = largestExitWithinImpact(market, side, insured)
	if (completeSets === 0n) return 0n
	if (longBalance !== undefined && completeSets === affordable) return longBalance
	// The smallest entry that sells these complete sets: their long-share cost plus the slippage allowance.
	return maximumAfterSlippage(quoteExitPosition(side, completeSets, market).totalLongShares, slippageBps)
}

/** Largest sell the wallet can make now, or undefined while its balances are unknown. */
function sellableShares(market: LiveMarket, side: Side, balances: LiveBalances | undefined, slippageBps: bigint) {
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	if (balances === undefined || longBalance === undefined) return undefined
	return largestTradableSell(market, side, slippageBps, longBalance, balances.invalid)
}

// Shortcut amounts keep eight decimals, rounded down so they never exceed what can be sold or spent; ETH and shares share the precision.
const SHORTCUT_STEP = 10n ** BigInt(SHARE_QUANTITY_DECIMALS - 8)
// Limits stated in reasons keep six decimals, rounded down so the stated amount is always accepted.
const LIMIT_DIGITS = 6

/** A share or ETH amount trimmed to eight decimals for the amount field; amounts below that step stay exact. */
export function roundDownShortcut(value: bigint) {
	return value < SHORTCUT_STEP ? value : value - (value % SHORTCUT_STEP)
}

/** The 25%, 50%, and Max shortcuts for a sell, as share amounts. Like the buy shortcuts they divide what can be sold now, so none fills a sale the ticket would refuse. */
function sellShortcuts(sellable: bigint | undefined) {
	if (sellable === undefined || sellable === 0n) return []
	return [
		{ label: ticketCopy.quarter, value: roundDownShortcut(sellable / 4n) },
		{ label: ticketCopy.half, value: roundDownShortcut(sellable / 2n) },
		{ label: ticketCopy.max, value: roundDownShortcut(sellable) },
	].filter(shortcut => shortcut.value > 0n)
}

/**
 * The largest ETH amount up to `ceiling` whose buy stays at or below the refused price-impact tier. Impact only grows with
 * the amount, so a binary search finds it; amounts too small to quote count as within the limit.
 */
function largestTradableBuy(market: LiveMarket, side: Side, ceiling: bigint, slippageBps: bigint) {
	const withinLimit = (payAttoEth: bigint) => {
		const { estimate } = estimateBuy(market, side, payAttoEth, slippageBps)
		return estimate === undefined || estimate.impactBps <= PRICE_IMPACT_BLOCKED_BPS
	}
	if (withinLimit(ceiling)) return ceiling
	let low = 0n
	let high = ceiling
	while (high - low > 1n) {
		const middle = (low + high) / 2n
		if (withinLimit(middle)) low = middle
		else high = middle
	}
	return low
}

/**
 * The 25%, 50%, and Max shortcuts for a buy, trimmed to eight decimals like the sell shortcuts. They divide what can be
 * bought now: the wallet's ETH less the gas reserve and the security pool's remaining minting capacity, capped where the
 * price impact would pass the refused tier, so no shortcut fills an amount the ticket would then refuse.
 */
function buyShortcuts(market: LiveMarket, side: Side, walletEthAttoEth: bigint | undefined, slippageBps: bigint) {
	if (walletEthAttoEth === undefined) return []
	const buyable = largestTradableBuy(market, side, minimum(getSpendableEthBalance(walletEthAttoEth), market.availableMintingCapacityAttoEth), slippageBps)
	return [
		{ label: ticketCopy.quarter, value: roundDownShortcut(buyable / 4n) },
		{ label: ticketCopy.half, value: roundDownShortcut(buyable / 2n) },
		{ label: ticketCopy.max, value: roundDownShortcut(buyable) },
	].filter(shortcut => shortcut.value > 0n)
}

/** A buy above the wallet balance cannot be paid; one that only eats into the gas reserve would leave nothing to send it with. */
function insufficientEthReason(payAttoEth: bigint, walletEthAttoEth: bigint) {
	if (payAttoEth > walletEthAttoEth) return availabilityCopy.insufficientEthReason
	if (payAttoEth > getSpendableEthBalance(walletEthAttoEth)) return ticketCopy.gasReserveReason(formatTrimmedUnits(ETH_GAS_RESERVE_ATTO_ETH))
	return undefined
}

/**
 * A buy mints complete sets, which the security pool refuses past its remaining capacity. The reason states the largest
 * buy that is accepted: the capacity, or the price-impact limit when buying the whole capacity would itself be refused.
 */
function mintingCapacityReason(payAttoEth: bigint, market: LiveMarket, side: Side, slippageBps: bigint) {
	const capacity = market.availableMintingCapacityAttoEth
	if (payAttoEth <= capacity) return undefined
	if (capacity === 0n) return ticketCopy.mintingCapacityExhaustedReason
	const largest = largestTradableBuy(market, side, capacity, slippageBps)
	if (largest < capacity) return ticketCopy.formatPriceImpactBlockedReason(formatEthAmount(formatTrimmedUnits(largest, 18, LIMIT_DIGITS)))
	return ticketCopy.formatMintingCapacityReason(formatTrimmedUnits(capacity, 18, LIMIT_DIGITS))
}

/** A refused price impact names the largest amount of the same trade the pool takes within the limit. */
function priceImpactBlockedReason(estimate: TradeEstimate, market: LiveMarket, settings: TradeSettings, balances: LiveBalances | undefined) {
	if (estimate.kind === 'entry') return ticketCopy.formatPriceImpactBlockedReason(formatEthAmount(formatTrimmedUnits(largestTradableBuy(market, estimate.side, estimate.payAttoEth, settings.slippageBps), 18, LIMIT_DIGITS)))
	const longBalance = estimate.side === 'YES' ? balances?.yes : balances?.no
	const largest = largestTradableSell(market, estimate.side, settings.slippageBps, longBalance, balances?.invalid)
	return ticketCopy.formatPriceImpactBlockedReason(formatOutcomeQuantity(largest, estimate.side, LIMIT_DIGITS, 'down'))
}

/** A buy needs the wallet's ETH balance to check it can be paid; until it is known the buy waits for it. */
function walletEthReason(inputs: Pick<TradeTicketInputs, 'mode' | 'walletConnected' | 'walletEthAttoEth' | 'walletEthState'>) {
	if (inputs.mode !== 'entry' || !inputs.walletConnected || inputs.walletEthAttoEth !== undefined) return undefined
	return inputs.walletEthState === 'error' ? availabilityCopy.balancesUnavailableReason : availabilityCopy.balancesLoadingReason
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
	/** Whether an unknown `walletEthAttoEth` is still loading or failed to load. */
	walletEthState: BalanceState
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
	const sellable = mode === 'exit' ? sellableShares(market, side, balances, settings.slippageBps) : undefined
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
		parsed.error ?? availabilityCopy.amountReason(parsed.value),
		inputs.amountSettling ? ticketCopy.updatingEstimate : undefined,
		walletEthReason(inputs),
		problem,
		insufficient,
		estimate?.kind === 'entry' ? mintingCapacityReason(estimate.payAttoEth, market, estimate.side, settings.slippageBps) : undefined,
		shortfall === undefined ? undefined : ticketCopy.invalidCoverageReason,
		estimate?.kind === 'exit' ? sellHoldingFeeBlocker(market, estimate.quote.completeSetShares, estimate.minimumAttoEth, capSubmissionDeadline(market, mode, inputs.nowSeconds + settings.validityMinutes * 60n)) : undefined,
		estimate !== undefined && impactTier === 'blocked' ? priceImpactBlockedReason(estimate, market, settings, balances) : undefined,
		needsAcknowledgment && !impactAcknowledged ? ticketCopy.acknowledgeImpactReason : undefined,
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
		/** A buy the wallet cannot pay for or a sell above the holding, said at the amount field as well as the button. */
		insufficientReason: insufficient,
		impactTier,
		needsAcknowledgment,
		impactAcknowledged,
		shortfall,
		sellable,
		shortcuts: mode === 'exit' ? sellShortcuts(sellable) : buyShortcuts(market, side, inputs.walletEthAttoEth, settings.slippageBps),
		// Connecting comes first: without a wallet the ticket still prices the trade, and the button offers to connect.
		primaryStep,
		availability: actionAvailability.reason !== undefined && loadingReasons.includes(actionAvailability.reason) ? { ...actionAvailability, loading: true } : actionAvailability,
		actionLabel: mode === 'entry' ? ticketCopy.buyOutcome(side) : ticketCopy.sellOutcome(side),
	}
}

export type TradeTicketModel = ReturnType<typeof tradeTicketModel>

/** The authoritative simulation may price differently from the local estimate; beyond the slippage bound, stop and show the new price. */
export function authoritativeQuoteMoved(estimate: TradeEstimate, authoritativeLongShares: bigint, authoritativeAttoEthOut?: bigint) {
	if (estimate.kind === 'entry') return authoritativeLongShares < estimate.minimumLongShares
	return authoritativeLongShares > estimate.maximumLongShares || (authoritativeAttoEthOut !== undefined && authoritativeAttoEthOut < estimate.minimumAttoEth)
}
