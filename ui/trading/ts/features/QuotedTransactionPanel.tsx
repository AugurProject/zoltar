import * as availabilityCopy from '../copy/availability.js'
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { resolveActionGroupMessage, transactionInFlight, transactionPendingLabel, transactionStatusText } from './live/transactionPresentation.js'
import type { TransactionPhase } from './live/transactionWorkflow.js'
import type { PanelWallet } from './live/liveTradingTypes.js'
import { useFocusOnKeyChange } from './live/useFocusOnKeyChange.js'

const ALWAYS_AVAILABLE: ActionAvailability = { disabled: false, reason: undefined }

export type WalletStep = Readonly<{ label: string; onClick(): void; disabled: boolean }>

/** The connect or switch-network step shown instead of the action until the wallet is ready. */
export function panelWalletStep(wallet: PanelWallet, walletReady: boolean, workflowLocked: boolean): WalletStep | undefined {
	return walletReady ? undefined : { label: wallet.actionLabel, disabled: workflowLocked, onClick: () => void wallet.connect() }
}

/**
 * The one panel pattern shared by trade, liquidity, and settlement: the estimate or quote above, then the outcome
 * block with the transaction hash, any failure explained as cause and next step, and a single primary button that
 * steps from connecting the wallet to the action to "Confirm in wallet".
 */
export function QuotedTransactionPanel({
	phase,
	actionLabel,
	availability,
	statusText,
	transactionHash,
	receiptWarning,
	error,
	walletStep,
	onSubmit,
	children,
}: {
	phase: TransactionPhase
	actionLabel: string
	availability: ActionAvailability
	/** Overrides the default phase text, for example while balances revalidate after a receipt. */
	statusText?: string | undefined
	transactionHash: Hash | undefined
	receiptWarning: string | undefined
	error: string | undefined
	/** Present when the wallet must be connected or switched before the action can run. */
	walletStep?: WalletStep | undefined
	onSubmit(): void
	children?: ComponentChildren
}) {
	// Confirmation moves focus to the announced outcome so keyboard and screen-reader users land on the result.
	const outcomeRef = useFocusOnKeyChange<HTMLDivElement>(phase === 'confirmed' ? transactionHash : undefined)
	// Progress and confirmation name the action as it was pressed, even if the inputs behind the label reset afterwards.
	const pressedLabel = useRef(actionLabel)
	if (phase === 'idle' || phase === 'error') pressedLabel.current = actionLabel
	const status = statusText ?? transactionStatusText(phase, pressedLabel.current)
	const groupMessage = walletStep === undefined ? resolveActionGroupMessage(phase, availability, status) : status
	return (
		<>
			{children}
			<div className='transaction-outcome' ref={outcomeRef} tabIndex={-1}>
				{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
				<ErrorNotice message={receiptWarning} />
				<ErrorNotice message={error} />
				{/* The spinner belongs to a blocked action that is waiting; once a transaction runs or confirms, its status line speaks instead. */}
				<TransactionActionGroup loading={walletStep === undefined && (phase === 'idle' || phase === 'error') && availability.loading === true} message={groupMessage}>
					{walletStep === undefined ? (
						<TransactionActionButton availability={availability} idleLabel={actionLabel} pending={transactionInFlight(phase)} pendingLabel={transactionPendingLabel(phase)} onClick={onSubmit} />
					) : (
						<TransactionActionButton availability={walletStep.disabled ? { disabled: true, reason: status ?? availabilityCopy.transactionInProgressReason } : ALWAYS_AVAILABLE} idleLabel={walletStep.label} pendingLabel={walletStep.label} onClick={walletStep.onClick} />
					)}
				</TransactionActionGroup>
			</div>
		</>
	)
}
