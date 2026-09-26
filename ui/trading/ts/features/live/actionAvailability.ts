import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import type { LiquidityOperation } from '../../protocol/live.js'
import * as copy from '../../copy/availability.js'
import type { BalanceState } from './liveTradingTypes.js'
import type { QuoteState } from './useQuotedTransaction.js'

// No trading flow needs an ERC-20 or ERC-1155 approval: entries pay ETH directly, and exits, liquidity
// removal, and settlement hand shares to the router through ERC-1155 transfer callbacks that the router
// authorises with the encoded request data (see protocol/authorization.ts). The missing
// "Approval required" state is therefore intentional. Trade availability lives in tradeTicketModel.

type WalletInputs = Readonly<{
	/** True when the session holds an account and a wallet client. A wallet on the wrong network is not disconnected. */
	walletConnected: boolean
	networkMismatchReason: string | undefined
}>

type BalanceInputs = Readonly<{ balanceState: BalanceState }>

type WorkflowInputs = Readonly<{ workflowLocked: boolean }>

/** The automatic quote behind the panel: the action waits for it and explains a failed quote. */
type QuoteInputs = Readonly<{ quoteState: QuoteState; quoteError: string | undefined }>

function walletReason({ walletConnected, networkMismatchReason }: WalletInputs) {
	if (!walletConnected && networkMismatchReason === undefined) return copy.connectWalletReason
	if (networkMismatchReason !== undefined) return networkMismatchReason
	return undefined
}

function balanceReason({ balanceState }: BalanceInputs) {
	if (balanceState === 'loading') return copy.balancesLoadingReason
	if (balanceState === 'error') return copy.balancesUnavailableReason
	if (balanceState === 'disconnected') return copy.connectWalletReason
	return undefined
}

function amountReason(parsedAmount: bigint | undefined) {
	if (parsedAmount === undefined || parsedAmount === 0n) return copy.amountRequiredReason
	return undefined
}

function insufficientReason(requested: bigint | undefined, available: bigint | undefined, reason: string) {
	if (requested === undefined || available === undefined) return undefined
	return requested > available ? reason : undefined
}

function workflowReason({ workflowLocked }: WorkflowInputs) {
	return workflowLocked ? copy.transactionInProgressReason : undefined
}

function quoteReason({ quoteState, quoteError }: QuoteInputs) {
	if (quoteState === 'loading' || quoteState === 'idle') return copy.quoteLoadingReason
	if (quoteState === 'error') return quoteError ?? copy.quoteUnavailableReason
	return undefined
}

/** Marks the availability as in progress when its reason is a wait rather than a blocker, so the notice shows loading feedback. */
function withLoading(availability: ActionAvailability, loadingReasons: ReadonlyArray<string | undefined>): ActionAvailability {
	if (availability.reason === undefined || !loadingReasons.includes(availability.reason)) return availability
	return { ...availability, loading: true }
}

export type LiquidityAvailabilityInputs = WalletInputs &
	BalanceInputs &
	WorkflowInputs &
	QuoteInputs &
	Readonly<{
		operation: LiquidityOperation
		marketClosed: boolean
		/** Initialize and add: ETH to deposit. Remove: LP tokens to burn. */
		requestedAmount: bigint | undefined
		walletEthAttoEth: bigint | undefined
		lpBalance: bigint | undefined
		initializePriceValid: boolean
	}>

export function resolveLiquidityAvailability(inputs: LiquidityAvailabilityInputs): ActionAvailability {
	const insufficient = inputs.operation === 'remove' ? insufficientReason(inputs.requestedAmount, inputs.lpBalance, copy.insufficientLpReason) : insufficientReason(inputs.requestedAmount, inputs.walletEthAttoEth, copy.insufficientEthReason)
	return withLoading(
		createActionAvailability(
			walletReason(inputs),
			inputs.operation !== 'remove' && inputs.marketClosed ? copy.marketClosedReason : undefined,
			balanceReason(inputs),
			amountReason(inputs.requestedAmount),
			insufficient,
			inputs.operation === 'initialize' && !inputs.initializePriceValid ? copy.initializePriceInvalidReason : undefined,
			workflowReason(inputs),
			quoteReason(inputs),
		),
		[copy.balancesLoadingReason, copy.quoteLoadingReason],
	)
}

export type SettlementAvailabilityInputs = WalletInputs &
	BalanceInputs &
	WorkflowInputs &
	QuoteInputs &
	Readonly<{
		/** Operation, amount, balance, and fork-target blockers already resolved by the settlement model. */
		inputBlocker: string | undefined
		/** True when the input blocker reports work still in flight (for example fork details loading). */
		inputBlockerLoading?: boolean
	}>

export function resolveSettlementAvailability(inputs: SettlementAvailabilityInputs): ActionAvailability {
	return withLoading(createActionAvailability(walletReason(inputs), balanceReason(inputs), inputs.inputBlocker, workflowReason(inputs), quoteReason(inputs)), [copy.balancesLoadingReason, copy.quoteLoadingReason, inputs.inputBlockerLoading === true ? inputs.inputBlocker : undefined])
}
