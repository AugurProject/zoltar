import { useCallback, useEffect, useReducer, useRef, useState } from 'preact/hooks'
import type { Address, Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import { describeTransactionFailure, formatTransactionFailure, REVERTED_ON_CHAIN } from '../../protocol/transactionFailure.js'
import { broadcastUncertainMessage, positionControlsWorkflowLocked } from '../liveTradingControllerHelpers.js'
import { createMarketTransactionActivity } from './marketTransactionActivity.js'
import { marketTransactionWorkflow, marketTransactionWorkflowsReducer, transactionMarketKey, transactionPhase, transactionWorkflowError, transactionWorkflowHash, transactionWorkflowReceiptWarning, type TransactionContext, type TransactionWorkflowEvent } from './transactionWorkflow.js'

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
 * Workflow state, duplicate-submission guards, and locks are kept per market, so one market's running transaction
 * neither blocks nor relabels another market's ticket; the returned state is the one for `market`.
 */
export function useQuotedTransaction<Quote>({
	operation,
	label,
	activityTitle,
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
	/** Names the transaction in the activity list, which keeps it (and its market's lock) after navigation or a reload. */
	activityTitle?: string | undefined
	account: Address | undefined
	chainId: number | undefined
	market: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	quoteSource?: QuoteSource<Quote> | undefined
	/** Reports each market's lock by its `transactionMarketKey`. */
	onWorkflowLockChange(locked: boolean, market: string): void
	onKnownReceipt(): void
	failureFallback: string
	quoteFailureFallback?: string
	/** Clear a finished or failed result when the account, chain, or market changes. The trade ticket leaves this to the wallet session, which explains the change. */
	resetOnIdentityChange?: boolean
}) {
	const [workflows, dispatchWorkflows] = useReducer(marketTransactionWorkflowsReducer, {})
	const currentMarket = transactionMarketKey(market)
	const currentMarketRef = useRef(currentMarket)
	currentMarketRef.current = currentMarket
	const workflowState = marketTransactionWorkflow(workflows, currentMarket)
	const [quoted, setQuoted] = useState<Readonly<{ key: string; value: Quote }>>()
	const [quoteLoad, setQuoteLoad] = useState<Readonly<{ key: string; state: 'loading' | 'error'; error?: string }>>()
	// Markets with a submission between its start and its end, and markets whose transaction still holds its lock
	// (an uncertain receipt keeps it after the submission ends).
	const activeMarkets = useRef(new Set<string>()).current
	const lockedMarkets = useRef(new Set<string>()).current
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

	// Active submissions retain their market locks across tab unmounts until their promises settle.
	const lockChangeRef = useRef(onWorkflowLockChange)
	lockChangeRef.current = onWorkflowLockChange
	const knownReceiptRef = useRef(onKnownReceipt)
	knownReceiptRef.current = onKnownReceipt
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			quoteRequests.invalidate()
			for (const locked of lockedMarkets) {
				if (activeMarkets.has(locked)) continue
				lockChangeRef.current(false, locked)
				lockedMarkets.delete(locked)
			}
		}
	}, [])

	const setMarketLock = (key: string, locked: boolean) => {
		if (locked) lockedMarkets.add(key)
		else lockedMarkets.delete(key)
		lockChangeRef.current(locked, key)
	}
	/** Applies an event to the market on screen when it runs. */
	const dispatchWorkflow = useCallback((event: TransactionWorkflowEvent) => dispatchWorkflows({ type: 'market', market: currentMarketRef.current, event }), [])
	/** Clears finished and failed results; a market whose transaction holds its lock keeps its state. */
	const resetUnlocked = useCallback(() => dispatchWorkflows({ type: 'reset-unlocked', locked: [...lockedMarkets] }), [])
	const invalidateWalletContext = useCallback((message: string) => dispatchWorkflows({ type: 'wallet-context-invalidated', message, locked: [...lockedMarkets], current: currentMarketRef.current }), [])

	useEffect(() => {
		if (!resetOnIdentityChange || activeMarkets.has(currentMarket) || workflowState.kind === 'uncertain') return
		if (workflowState.kind !== 'idle') dispatchWorkflow({ type: 'inputs-invalidated' })
	}, [account, chainId, market, walletClient])

	const quote = quoted !== undefined && quoteKey !== undefined && quoted.key === quoteKey ? quoted.value : undefined
	let quoteState: QuoteState = 'idle'
	if (quoteLoad !== undefined && quoteLoad.key === quoteKey) quoteState = quoteLoad.state
	else if (quote !== undefined) quoteState = 'ready'

	/** User edits clear an old failure or confirmation; nothing may disturb an active or uncertain transaction. */
	function invalidate(preserveConfirmed = false) {
		if (receiptWarning !== undefined || activeMarkets.has(currentMarket)) return false
		dispatchWorkflow({ type: 'inputs-invalidated', preserveConfirmed })
		return true
	}

	async function submit<Prepared>(plan: SubmissionPlan<Prepared>) {
		const key = currentMarket
		if (account === undefined || chainId === undefined || market === undefined || walletClient === undefined || externallyLocked || receiptWarning !== undefined || activeMarkets.has(key)) return
		activeMarkets.add(key)
		// Every event of this submission lands on its own market, whichever market is on screen by then.
		const dispatch = (event: TransactionWorkflowEvent) => dispatchWorkflows({ type: 'market', market: key, event })
		const context: TransactionContext = { account, chainId, market, requestRevision: ++revision.current }
		setMarketLock(key, true)
		dispatch({ type: 'operation-preparing', context, operation })
		let broadcastHash: Hash | undefined
		const activity = createMarketTransactionActivity(market, activityTitle ?? label)
		let receiptKnown = false
		let keepLocked = false
		let signatureRequested = false
		try {
			const prepared = await plan.prepare()
			if (!mounted.current) return
			broadcastHash = await plan.send(prepared, async write => {
				if (mounted.current && !signatureRequested) {
					signatureRequested = true
					dispatch({ type: 'signature-requested', context, operation })
				}
				return await write()
			})
			activity.broadcast(broadcastHash)
			if (!mounted.current) {
				activity.handOff()
				return
			}
			if (!signatureRequested) dispatch({ type: 'signature-requested', context, operation })
			dispatch({ type: 'broadcast', context, operation, transactionHash: broadcastHash })
			const { receipt } = await waitForSubmittedTransactionReceipt(walletClient, broadcastHash, {
				allowRevertedReceipt: true,
				onKnownReceipt: () => {
					receiptKnown = true
					knownReceiptRef.current()
				},
				onTransactionReplaced: replacementHash => {
					broadcastHash = replacementHash
					activity.replaced(replacementHash)
					if (mounted.current) dispatch({ type: 'replaced', context, replacementHash })
				},
			})
			activity.receipt(receipt.status)
			if (!mounted.current) return
			if (receipt.status === 'reverted') {
				dispatch({ type: 'reverted', context })
				return
			}
			dispatch({ type: 'confirmed', context })
			await plan.afterConfirmed?.(prepared)
		} catch (caught) {
			// A known outcome (such as a wallet cancellation) settles the activity row; otherwise the activity list keeps checking.
			activity.stopped(caught, receiptKnown)
			if (!mounted.current) return
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				dispatch({ type: 'uncertain', context, reason: broadcastUncertainMessage(label, broadcastHash) })
			} else {
				dispatch({ type: 'failed', context, operation, message: describeTransactionFailure(caught, failureFallback) })
				setFailureCount(count => count + 1)
			}
		} finally {
			activeMarkets.delete(key)
			if (!keepLocked) setMarketLock(key, false)
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
		resetUnlocked,
		invalidateWalletContext,
		invalidate,
		retryQuote() {
			if (workflowLocked || quoteKey === undefined || !invalidate()) return
			setFailureCount(count => count + 1)
		},
		submit,
	}
}
