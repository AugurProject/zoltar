import type { TransactionState } from './liveTradingTypes.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import type { LiquidityOperation } from '../../protocol/live.js'
import * as copy from '../../copy/availability.js'
import type { BalanceState } from './liveTradingTypes.js'

// No trading flow needs an ERC-20 or ERC-1155 approval: entries pay ETH directly, and exits, liquidity
// removal, and settlement hand shares to the router through ERC-1155 transfer callbacks that the router
// authorises with the encoded request data (see protocol/authorization.ts). The missing
// "Approval required" state is therefore intentional.

type WalletInputs = Readonly<{
	/** True when the session holds an account and a wallet client. A wallet on the wrong network is not disconnected. */
	walletConnected: boolean
	networkMismatchReason: string | undefined
}>

type BalanceInputs = Readonly<{ balanceState: BalanceState }>

type ProtectionInputs = Readonly<{ protectionValid: boolean }>

type WorkflowInputs = Readonly<{ workflowLocked: boolean }>

type SubmitInputs = Readonly<{ quoteReady: boolean }>

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

function amountReason(parsedAmount: bigint | undefined, amountError: string | undefined) {
	if (parsedAmount === undefined || parsedAmount === 0n) return amountError ?? copy.amountRequiredReason
	return undefined
}

function insufficientReason(requested: bigint | undefined, available: bigint | undefined, reason: string) {
	if (requested === undefined || available === undefined) return undefined
	return requested > available ? reason : undefined
}

function protectionReason({ protectionValid }: ProtectionInputs) {
	return protectionValid ? undefined : copy.protectionInvalidReason
}

function workflowReason({ workflowLocked }: WorkflowInputs) {
	return workflowLocked ? copy.transactionInProgressReason : undefined
}

function quoteReason({ quoteReady }: SubmitInputs) {
	return quoteReady ? undefined : copy.quoteRequiredReason
}

/** Marks the availability as in progress when its reason is a wait rather than a blocker, so the notice shows loading feedback. */
function withLoading(availability: ActionAvailability, loadingReasons: ReadonlyArray<string | undefined>): ActionAvailability {
	if (availability.reason === undefined || !loadingReasons.includes(availability.reason)) return availability
	return { ...availability, loading: true }
}

export type PositionAvailabilityInputs = WalletInputs &
	BalanceInputs &
	ProtectionInputs &
	WorkflowInputs &
	Readonly<{
		mode: 'entry' | 'exit'
		side: 'YES' | 'NO'
		marketClosed: boolean
		/** The parsed field value; undefined or zero means the amount is missing or invalid. */
		enteredAmount: bigint | undefined
		/** Entry: ETH to spend. Exit: complete-set shares to redeem. */
		requestedAmount: bigint | undefined
		amountError: string | undefined
		walletEthAttoEth: bigint | undefined
		outcomeBalance: bigint | undefined
		exceedsInsurance: boolean
		exceedsInsuranceDetail?: string | undefined
		exitTooSmall: boolean
	}>

export function resolvePositionSimulateAvailability(inputs: PositionAvailabilityInputs): ActionAvailability {
	const insufficient = inputs.mode === 'entry' ? insufficientReason(inputs.requestedAmount, inputs.walletEthAttoEth, copy.insufficientEthReason) : insufficientReason(inputs.requestedAmount, inputs.outcomeBalance, copy.formatInsufficientOutcomeReason(inputs.side))
	return withLoading(
		createActionAvailability(
			walletReason(inputs),
			inputs.marketClosed ? copy.marketClosedReason : undefined,
			balanceReason(inputs),
			amountReason(inputs.enteredAmount, inputs.amountError),
			insufficient,
			inputs.exceedsInsurance ? (inputs.exceedsInsuranceDetail ?? copy.exitExceedsInsuranceReason) : undefined,
			inputs.exitTooSmall ? copy.amountTooSmallReason : undefined,
			protectionReason(inputs),
			workflowReason(inputs),
		),
		[copy.balancesLoadingReason],
	)
}

export function resolvePositionSubmitAvailability(inputs: PositionAvailabilityInputs & SubmitInputs): ActionAvailability {
	const simulate = resolvePositionSimulateAvailability(inputs)
	return simulate.disabled ? simulate : createActionAvailability(quoteReason(inputs))
}

export type LiquidityAvailabilityInputs = WalletInputs &
	BalanceInputs &
	ProtectionInputs &
	WorkflowInputs &
	Readonly<{
		operation: LiquidityOperation
		marketClosed: boolean
		/** Initialize and add: ETH to deposit. Remove: LP tokens to burn. */
		requestedAmount: bigint | undefined
		walletEthAttoEth: bigint | undefined
		lpBalance: bigint | undefined
		initializePriceValid: boolean
	}>

export function resolveLiquiditySimulateAvailability(inputs: LiquidityAvailabilityInputs): ActionAvailability {
	const insufficient = inputs.operation === 'remove' ? insufficientReason(inputs.requestedAmount, inputs.lpBalance, copy.insufficientLpReason) : insufficientReason(inputs.requestedAmount, inputs.walletEthAttoEth, copy.insufficientEthReason)
	return withLoading(
		createActionAvailability(
			walletReason(inputs),
			inputs.operation !== 'remove' && inputs.marketClosed ? copy.marketClosedReason : undefined,
			balanceReason(inputs),
			amountReason(inputs.requestedAmount, undefined),
			insufficient,
			inputs.operation === 'initialize' && !inputs.initializePriceValid ? copy.initializePriceInvalidReason : undefined,
			protectionReason(inputs),
			workflowReason(inputs),
		),
		[copy.balancesLoadingReason],
	)
}

export function resolveLiquiditySubmitAvailability(inputs: LiquidityAvailabilityInputs & SubmitInputs): ActionAvailability {
	const simulate = resolveLiquiditySimulateAvailability(inputs)
	return simulate.disabled ? simulate : createActionAvailability(quoteReason(inputs))
}

export type SettlementAvailabilityInputs = WalletInputs &
	BalanceInputs &
	ProtectionInputs &
	WorkflowInputs &
	Readonly<{
		/** Operation, amount, balance, and fork-target blockers already resolved by the settlement model. */
		inputBlocker: string | undefined
		/** True when the input blocker reports work still in flight (for example fork details loading). */
		inputBlockerLoading?: boolean
	}>

export function resolveSettlementSimulateAvailability(inputs: SettlementAvailabilityInputs): ActionAvailability {
	return withLoading(createActionAvailability(walletReason(inputs), balanceReason(inputs), inputs.inputBlocker, protectionReason(inputs), workflowReason(inputs)), [copy.balancesLoadingReason, inputs.inputBlockerLoading === true ? inputs.inputBlocker : undefined])
}

export function resolveSettlementSubmitAvailability(inputs: SettlementAvailabilityInputs & SubmitInputs): ActionAvailability {
	const simulate = resolveSettlementSimulateAvailability(inputs)
	return simulate.disabled ? simulate : createActionAvailability(quoteReason(inputs))
}

/** The group notice for a workflow: a blocked idle or ready action explains itself; an in-flight or finished workflow keeps its progress text. */
export function resolveActionGroupMessage(state: TransactionState, availability: ActionAvailability, statusText: string | undefined) {
	if ((state === 'idle' || state === 'ready') && availability.disabled && availability.reason !== undefined) return availability.reason
	return statusText ?? availability.reason
}
