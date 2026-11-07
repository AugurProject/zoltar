import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { ETH_GAS_RESERVE_ATTO_ETH, getSpendableEthBalance } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { LiquidityOperation } from '../../protocol/live.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import * as copy from '../../copy/availability.js'
import type { BalanceState } from './liveTradingTypes.js'

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

type PreviewInputs = Readonly<{ previewBlocker: string | undefined }>

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

function insufficientReason(requested: bigint | undefined, available: bigint | undefined, reason: string) {
	if (requested === undefined || available === undefined) return undefined
	return requested > available ? reason : undefined
}

/**
 * Why the wallet cannot fund a liquidity amount: removals spend LP tokens; deposits spend ETH and, like trades, leave
 * the gas reserve in the wallet so the transaction can still be sent.
 */
export function liquidityShortfallReason(operation: LiquidityOperation, requested: bigint | undefined, walletEthAttoEth: bigint | undefined, lpBalance: bigint | undefined) {
	if (operation === 'remove') return insufficientReason(requested, lpBalance, copy.insufficientLpReason)
	if (requested === undefined || walletEthAttoEth === undefined) return undefined
	if (requested > walletEthAttoEth) return copy.insufficientEthReason
	if (requested > getSpendableEthBalance(walletEthAttoEth)) return copy.gasReserveReason(formatTrimmedUnits(ETH_GAS_RESERVE_ATTO_ETH))
	return undefined
}

/** A deposit cannot be checked against an ETH balance that has not loaded, so it waits for the balance or says it is unavailable. */
function unknownEthReason({ operation, walletEthAttoEth, walletEthStatus }: Pick<LiquidityAvailabilityInputs, 'operation' | 'walletEthAttoEth' | 'walletEthStatus'>) {
	if (operation === 'remove' || walletEthAttoEth !== undefined) return undefined
	return walletEthStatus === 'error' ? copy.balancesUnavailableReason : copy.balancesLoadingReason
}

/** Adding liquidity to a closed market can still be undone by removing it; creating a closed market cannot happen at all. */
function closedLiquidityReason({ operation, marketClosed, newRiskBlocker }: Pick<LiquidityAvailabilityInputs, 'operation' | 'marketClosed' | 'newRiskBlocker'>) {
	if (operation === 'remove' || !marketClosed) return undefined
	return operation === 'initialize' ? copy.formatInitializationClosedReason(newRiskBlocker) : copy.liquidityClosedReason
}

function workflowReason({ workflowLocked }: WorkflowInputs) {
	return workflowLocked ? copy.transactionInProgressReason : undefined
}

/** Marks the availability as in progress when its reason is a wait rather than a blocker, so the notice shows loading feedback. */
function withLoading(availability: ActionAvailability, loadingReasons: ReadonlyArray<string | undefined>): ActionAvailability {
	if (availability.reason === undefined || !loadingReasons.includes(availability.reason)) return availability
	return { ...availability, loading: true }
}

export type LiquidityAvailabilityInputs = WalletInputs &
	BalanceInputs &
	WorkflowInputs &
	PreviewInputs &
	Readonly<{
		operation: LiquidityOperation
		marketClosed: boolean
		/** The market status that closed it, such as `Question ended`; creating a market names it instead of the add-liquidity reason. */
		newRiskBlocker?: string | undefined
		submissionBlocker?: string | undefined
		/** Initialize and add: ETH to deposit. Remove: LP tokens to burn. */
		requestedAmount: bigint | undefined
		/** Why the typed amount cannot be read, such as a stray separator; it replaces the generic missing-amount reason. */
		amountError?: string | undefined
		walletEthAttoEth: bigint | undefined
		/** The wallet ETH read behind `walletEthAttoEth`, so an unknown balance waits or reports the failed read. */
		walletEthStatus: WalletSummaryState['status']
		lpBalance: bigint | undefined
		initializePriceValid: boolean
	}>

export function resolveLiquidityAvailability(inputs: LiquidityAvailabilityInputs): ActionAvailability {
	return withLoading(
		createActionAvailability(
			walletReason(inputs),
			closedLiquidityReason(inputs),
			inputs.submissionBlocker,
			balanceReason(inputs),
			unknownEthReason(inputs),
			liquidityShortfallReason(inputs.operation, inputs.requestedAmount, inputs.walletEthAttoEth, inputs.lpBalance),
			inputs.amountError ?? copy.amountReason(inputs.requestedAmount),
			inputs.operation === 'initialize' && !inputs.initializePriceValid ? copy.initializePriceInvalidReason : undefined,
			workflowReason(inputs),
			inputs.previewBlocker,
		),
		[copy.balancesLoadingReason],
	)
}

export type SettlementAvailabilityInputs = WalletInputs &
	BalanceInputs &
	WorkflowInputs &
	PreviewInputs &
	Readonly<{
		/** Operation, amount, balance, and fork-target blockers already resolved by the settlement model. */
		inputBlocker: string | undefined
		/** True when the input blocker reports work still in flight (for example fork details loading). */
		inputBlockerLoading?: boolean
	}>

export function resolveSettlementAvailability(inputs: SettlementAvailabilityInputs): ActionAvailability {
	return withLoading(createActionAvailability(walletReason(inputs), balanceReason(inputs), inputs.inputBlocker, workflowReason(inputs), inputs.previewBlocker), [copy.balancesLoadingReason, inputs.inputBlockerLoading === true ? inputs.inputBlocker : undefined])
}
