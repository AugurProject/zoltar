import { useEffect, useReducer, useRef, useState } from 'preact/hooks'
import type { Address, Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import { describeTransactionFailure, formatTransactionFailure, REVERTED_ON_CHAIN } from '../../protocol/transactionFailure.js'
import { broadcastUncertainMessage, positionControlsWorkflowLocked } from '../liveTradingControllerHelpers.js'
import { idleTransactionWorkflow, transactionPhase, transactionWorkflowError, transactionWorkflowHash, transactionWorkflowReceiptWarning, transactionWorkflowReducer, type TransactionContext } from './transactionWorkflow.js'

export type QuotedOperation = 'trade' | 'liquidity' | 'settlement'

/** Wraps the wallet write so the workflow shows "Confirm in wallet" exactly while the wallet is asked to sign. */
type RequestSignature = <T>(write: () => Promise<T>) => Promise<T>

/** One submission: an authoritative check right before signing, then the broadcast, then what to do after a confirmed receipt. */
export type SubmissionPlan<Prepared> = Readonly<{
	prepare(): Promise<Prepared>
	send(prepared: Prepared, requestSignature: RequestSignature): Promise<Hash>
	afterConfirmed?(prepared: Prepared): Promise<void>
}>

/** A quote the hook keeps current: `key` names the exact inputs it prices, and undefined means the inputs cannot be quoted yet. */
export type QuoteSource<Quote> = Readonly<{ key: string | undefined; load(): Promise<Quote> }>

export type QuoteState = 'idle' | 'loading' | 'ready' | 'error'

const QUOTE_DEBOUNCE_MILLISECONDS = 350

/**
 * The shared engine behind the trade, liquidity, and settlement panels. Quotes refresh automatically (debounced) as
 * inputs change, and a submission always re-simulates before the wallet is asked to sign, so no flow needs a separate
 * "simulate" step. The hook owns duplicate-submission guards, receipt tracking, stale-result rejection, and failure copy.
 */
export function useQuotedTransaction<Quote>({
	operation,
	label,
	account,
	chainId,
	market,
	walletClient,
	externallyLocked,
	quoteSource,
	onWorkflowLockChange,
	onKnownReceipt,
	failureFallback,
	quoteFailureFallback = failureFallback,
	resetOnIdentityChange = true,
}: {
	operation: QuotedOperation
	/** Names the transaction in the receipt-uncertainty warning. */
	label: string
	account: Address | undefined
	chainId: number | undefined
	market: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	quoteSource?: QuoteSource<Quote> | undefined
	onWorkflowLockChange(locked: boolean): void
	onKnownReceipt(): void
	failureFallback: string
	quoteFailureFallback?: string
	/** Clear a finished or failed result when the account, chain, or market changes. The trade ticket leaves this to the wallet session, which explains the change. */
	resetOnIdentityChange?: boolean
}) {
	const [workflowState, dispatchWorkflow] = useReducer(transactionWorkflowReducer, idleTransactionWorkflow)
	const [quoted, setQuoted] = useState<Readonly<{ key: string; value: Quote }>>()
	const [quoteLoad, setQuoteLoad] = useState<Readonly<{ key: string; state: 'loading' | 'error'; error?: string }>>()
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const quoteRequests = useRef(createLatestRequestGuard()).current
	const mounted = useRef(true)
	const revision = useRef(0)
	const state = transactionPhase(workflowState)
	const transactionHash = transactionWorkflowHash(workflowState)
	const error = transactionWorkflowError(workflowState, formatTransactionFailure(REVERTED_ON_CHAIN))
	const receiptWarning = transactionWorkflowReceiptWarning(workflowState)
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)
	// A failed submission retires the cached quote, so pressing again prices the pool afresh instead of resubmitting stale bounds.
	const [failureCount, setFailureCount] = useState(0)
	const quoteKey = quoteSource?.key === undefined ? undefined : `${quoteSource.key}\u0001${failureCount.toString()}`
	const loadRef = useRef(quoteSource?.load)
	loadRef.current = quoteSource?.load

	useEffect(() => {
		quoteRequests.invalidate()
		if (quoteKey === undefined) {
			setQuoteLoad(undefined)
			return
		}
		setQuoteLoad({ key: quoteKey, state: 'loading' })
		const request = quoteRequests.begin()
		const timer = setTimeout(() => {
			const load = loadRef.current
			if (load === undefined) return
			void withReadTimeout(load())
				.then(value => {
					if (!mounted.current || !quoteRequests.isCurrent(request)) return
					setQuoted({ key: quoteKey, value })
					setQuoteLoad(undefined)
				})
				.catch((caught: unknown) => {
					if (!mounted.current || !quoteRequests.isCurrent(request)) return
					setQuoteLoad({ key: quoteKey, state: 'error', error: describeTransactionFailure(caught, quoteFailureFallback) })
				})
		}, QUOTE_DEBOUNCE_MILLISECONDS)
		return () => {
			clearTimeout(timer)
			quoteRequests.invalidate()
		}
	}, [quoteKey])

	// Parents may pass a new lock callback on every render, so only a real unmount releases the lock.
	const lockChangeRef = useRef(onWorkflowLockChange)
	lockChangeRef.current = onWorkflowLockChange
	const knownReceiptRef = useRef(onKnownReceipt)
	knownReceiptRef.current = onKnownReceipt
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			quoteRequests.invalidate()
			if (workflow.isActive()) workflow.finish()
			lockChangeRef.current(false)
		}
	}, [])

	useEffect(() => {
		if (!resetOnIdentityChange || workflow.isActive() || workflowState.kind === 'uncertain') return
		if (workflowState.kind !== 'idle') dispatchWorkflow({ type: 'inputs-invalidated' })
	}, [account, chainId, market, walletClient])

	const quote = quoted !== undefined && quoteKey !== undefined && quoted.key === quoteKey ? quoted.value : undefined
	let quoteState: QuoteState = 'idle'
	if (quoteLoad !== undefined && quoteLoad.key === quoteKey) quoteState = quoteLoad.state
	else if (quote !== undefined) quoteState = 'ready'

	/** User edits clear an old failure or confirmation; nothing may disturb an active or uncertain transaction. */
	function invalidate(preserveConfirmed = false) {
		if (receiptWarning !== undefined || workflow.isActive()) return false
		dispatchWorkflow({ type: 'inputs-invalidated', preserveConfirmed })
		return true
	}

	async function submit<Prepared>(plan: SubmissionPlan<Prepared>) {
		if (account === undefined || chainId === undefined || market === undefined || walletClient === undefined || externallyLocked || receiptWarning !== undefined || !workflow.begin()) return
		const context: TransactionContext = { account, chainId, market, requestRevision: ++revision.current }
		lockChangeRef.current(true)
		dispatchWorkflow({ type: 'operation-preparing', context, operation })
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		let signatureRequested = false
		try {
			const prepared = await plan.prepare()
			if (!mounted.current) return
			broadcastHash = await plan.send(prepared, async write => {
				if (mounted.current && !signatureRequested) {
					signatureRequested = true
					dispatchWorkflow({ type: 'signature-requested', context, operation })
				}
				return await write()
			})
			if (!mounted.current) return
			if (!signatureRequested) dispatchWorkflow({ type: 'signature-requested', context, operation })
			dispatchWorkflow({ type: 'broadcast', context, operation, transactionHash: broadcastHash })
			const { receipt } = await waitForSubmittedTransactionReceipt(walletClient, broadcastHash, {
				allowRevertedReceipt: true,
				onKnownReceipt: () => {
					receiptKnown = true
					knownReceiptRef.current()
				},
				onTransactionReplaced: replacementHash => {
					broadcastHash = replacementHash
					if (mounted.current) dispatchWorkflow({ type: 'replaced', context, replacementHash })
				},
			})
			if (!mounted.current) return
			if (receipt.status === 'reverted') {
				dispatchWorkflow({ type: 'reverted', context })
				return
			}
			dispatchWorkflow({ type: 'confirmed', context })
			await plan.afterConfirmed?.(prepared)
		} catch (caught) {
			if (!mounted.current) return
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				dispatchWorkflow({ type: 'uncertain', context, reason: broadcastUncertainMessage(label, broadcastHash) })
			} else {
				dispatchWorkflow({ type: 'failed', context, operation, message: describeTransactionFailure(caught, failureFallback) })
				setFailureCount(count => count + 1)
			}
		} finally {
			workflow.finish()
			if (!keepLocked) lockChangeRef.current(false)
		}
	}

	return {
		workflowState,
		dispatchWorkflow,
		state,
		transactionHash,
		error,
		receiptWarning,
		workflowLocked,
		quote,
		quoteState,
		quoteError: quoteLoad !== undefined && quoteLoad.key === quoteKey ? quoteLoad.error : undefined,
		workflowIsActive: () => workflow.isActive(),
		invalidate,
		submit,
	}
}
