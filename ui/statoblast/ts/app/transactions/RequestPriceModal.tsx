import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { getCoordinatorInitialReportPrice } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import type { RequestPriceModalProps } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolOracleSections.js'
import * as poolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import * as priceRequestCopy from '@zoltar/ui-statoblast-shared/copy/priceRequest.js'
import { embeddedTransactionSteps } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { PriceRequestPreview } from './PriceRequestPreview.js'
import { TransactionStepsContent } from '@zoltar/ui-core-shared/components/TransactionStepsContent.js'
import { cancelTransactionReview, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { dismissGlobalTransaction, inlineTransactionStatusHash } from '@zoltar/ui-core-shared/transactions/globalTransactionDismissal.js'
import type { FailedPricePlan } from './PriceRequestPreview.js'

async function fetchUniswapPrice(review: NonNullable<RequestPriceModalProps['review']>) {
	return await getCoordinatorInitialReportPrice(createConnectedReadClient(), review.managerAddress)
}

export function RequestPriceModal({ review, onConfirm, onClose, canRequest, confirmationGuardMessage, closeOnSuccessKey, fetchPrice = fetchUniswapPrice }: RequestPriceModalProps & { fetchPrice?: typeof fetchUniswapPrice }) {
	const [fetching, setFetching] = useState(false)
	const [quoteError, setQuoteError] = useState<string>()
	const quoteAttempt = useRef(0)
	const [price, setPrice] = useState('')
	const [retry, setRetry] = useState(0)
	const [manualRequestRequired, setManualRequestRequired] = useState(false)
	const [failureLatched, setFailureLatched] = useState(false)
	const [failedPlan, setFailedPlan] = useState<FailedPricePlan>()
	const [running, setRunning] = useState(false)
	const [attempted, setAttempted] = useState<string>()
	const run = useRef<{ key: string; signal: AbortSignal; cancel: () => void; submittedHash?: string; finalSubmittedHash?: string; submissionOutstanding?: boolean; plan?: FailedPricePlan }>()
	const previousReviewKey = useRef<string>()
	const priceControlsRef = useRef<HTMLDivElement>(null)
	const mounted = useRef(true)
	const confirm = useRef(onConfirm)
	confirm.current = onConfirm
	const presentation = useGlobalTransactionPresentation()
	const workflow = transactionSteps.value
	const parsed = tryParseDecimalInput(price)
	const validPrice = parsed !== undefined && parsed > 0n && parsed < 2n ** 256n
	const priceError = price !== '' && !validPrice ? poolCopy.manualInitialPriceError : undefined
	const proposedPrice = parsed
	const key = review === undefined ? undefined : `${review.managerAddress}:${review.securityPoolAddress}:${review.universeId}:${review.requestValueAttoEth}:${price}:${retry}`
	const valid = review !== undefined && canRequest && confirmationGuardMessage === undefined && validPrice && !fetching
	const ownsWorkflow = run.current !== undefined && workflow?.reviewSignal === run.current.signal
	const sending = ownsWorkflow && (workflow?.steps.some(step => step.phase === 'pending') ?? false)
	const finalReceiptConfirmed = ownsWorkflow && workflow?.steps.at(-1)?.hash !== undefined && workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	const finalSubmittedHash = run.current?.finalSubmittedHash ?? (ownsWorkflow ? workflow?.steps.at(-1)?.hash : undefined)
	const completedRequest = finalSubmittedHash !== undefined && (presentation?.tone === 'success' || presentation?.tone === 'warning') && presentation.hash === finalSubmittedHash && (closeOnSuccessKey === undefined || closeOnSuccessKey === finalSubmittedHash)
	const awaitingResult = (finalReceiptConfirmed || finalSubmittedHash !== undefined) && !completedRequest && presentation?.tone !== 'error' && run.current?.key === key && run.current?.signal.aborted === false
	const submittedHash = run.current?.submittedHash ?? (ownsWorkflow ? workflow?.steps.findLast(step => step.hash !== undefined)?.hash : undefined)
	const current = (valid || completedRequest || awaitingResult) && run.current?.key === key && run.current?.signal.aborted === false
	const showSteps = current && ownsWorkflow && workflow?.steps[workflow.activeIndex] !== undefined
	const failedCurrentAttempt =
		(!running && presentation?.tone === 'error' && ((key !== undefined && attempted === key) || (submittedHash !== undefined && presentation.hash === submittedHash) || (run.current?.submissionOutstanding && presentation.hash !== undefined))) || (showSteps && workflow?.steps.some(step => step.phase === 'failed'))
	const finalStep = ownsWorkflow ? workflow?.steps.at(-1) : undefined
	const inlineStatusHash = review !== undefined && finalStep?.hash !== undefined && (finalStep.phase === 'pending' || finalStep.phase === 'confirmed') && presentation?.hash === finalStep.hash && presentation.tone !== 'error' ? finalStep.hash : undefined
	const estimatePrompt = validPrice ? priceRequestCopy.preparingPriceRequest : priceRequestCopy.enterPriceEstimate
	let previewPrompt = estimatePrompt
	if (fetching) previewPrompt = priceRequestCopy.fetchingUniswapPrice
	if (manualRequestRequired) previewPrompt = priceRequestCopy.checkPriceBeforeRequest

	useLayoutEffect(() => {
		if (review === undefined) return
		const reviewKey = `${review.managerAddress}:${review.securityPoolAddress}:${review.universeId}`
		if (previousReviewKey.current === reviewKey) return
		previousReviewKey.current = reviewKey
		quoteAttempt.current += 1
		setFetching(false)
		setQuoteError(undefined)
		setPrice('')
		setAttempted(undefined)
		setManualRequestRequired(false)
		setFailureLatched(false)
		setFailedPlan(undefined)
	}, [review])
	useLayoutEffect(() => {
		if (review !== undefined) return
		quoteAttempt.current += 1
		setFetching(false)
		setQuoteError(undefined)
	}, [review])
	useLayoutEffect(() => {
		if (!failedCurrentAttempt) return
		setFailureLatched(true)
		setManualRequestRequired(true)
		if (workflow !== undefined) {
			const plan = {
				funding: workflow.steps.flatMap(step => step.tokenFunding ?? []),
				totalAttoEth: workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n),
				outcome: workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome,
			}
			setFailedPlan(plan)
		} else if (run.current?.plan !== undefined) setFailedPlan(run.current.plan)
		if (!running) run.current?.cancel()
	}, [failedCurrentAttempt, running])
	useLayoutEffect(() => {
		if (finalSubmittedHash !== undefined && run.current !== undefined) run.current.finalSubmittedHash = finalSubmittedHash
	}, [finalSubmittedHash])
	useLayoutEffect(() => {
		if (completedRequest && review !== undefined) onClose()
	}, [completedRequest, onClose, review])
	useLayoutEffect(() => {
		if (!current && !sending && !(running && ownsWorkflow && workflow?.steps.some(step => step.hash !== undefined))) run.current?.cancel()
	}, [current, sending, running, ownsWorkflow, workflow])
	useLayoutEffect(() => {
		inlineTransactionStatusHash.value = inlineStatusHash
		return () => {
			if (inlineTransactionStatusHash.peek() === inlineStatusHash) inlineTransactionStatusHash.value = undefined
		}
	}, [inlineStatusHash])
	useLayoutEffect(() => {
		if (manualRequestRequired && !showSteps) priceControlsRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
	}, [manualRequestRequired, showSteps])
	useEffect(
		() => () => {
			mounted.current = false
			quoteAttempt.current += 1
			run.current?.cancel()
		},
		[],
	)
	useEffect(() => {
		if (!valid || review === undefined || key === undefined || running || attempted === key || manualRequestRequired || failureLatched) return
		const timer = setTimeout(() => {
			const cancellation = new AbortController()
			embeddedTransactionSteps.value = cancellation.signal
			const cancel = () => {
				const firstDetach = run.current?.signal === cancellation.signal && run.current.submissionOutstanding !== true
				const { trackingSubmitted, steps } = cancelTransactionReview(cancellation.signal)
				const submittedHash = steps?.findLast(step => step.hash !== undefined)?.hash
				const finalSubmittedHash = steps?.at(-1)?.hash
				const submissionOutstanding = trackingSubmitted || (run.current?.signal === cancellation.signal && run.current.submissionOutstanding === true)
				if (submissionOutstanding && run.current?.signal === cancellation.signal) {
					run.current.submissionOutstanding = true
					if (submittedHash !== undefined) run.current.submittedHash = submittedHash
					if (finalSubmittedHash !== undefined) run.current.finalSubmittedHash = finalSubmittedHash
					if (steps !== undefined)
						run.current.plan = {
							funding: steps.flatMap(step => step.tokenFunding ?? []),
							totalAttoEth: steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n),
							outcome: steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome,
						}
					if (firstDetach && mounted.current) setManualRequestRequired(true)
				}
				if (!submissionOutstanding) cancellation.abort()
				if (mounted.current && run.current?.signal === cancellation.signal) setAttempted(undefined)
				const release = () => {
					if (embeddedTransactionSteps.value === cancellation.signal) embeddedTransactionSteps.value = undefined
				}
				if (mounted.current) release()
				else queueMicrotask(release)
			}
			run.current = { key, signal: cancellation.signal, cancel }
			setAttempted(key)
			setRunning(true)
			void Promise.resolve(confirm.current({ ...review, proposedRepPerEthPrice: proposedPrice }, cancellation.signal)).finally(() => {
				if (mounted.current) setRunning(false)
				if (embeddedTransactionSteps.value === cancellation.signal) embeddedTransactionSteps.value = undefined
			})
		}, 300)
		return () => clearTimeout(timer)
	}, [valid, review, key, running, attempted, proposedPrice, manualRequestRequired, failureLatched])
	const close = () => {
		if (completedRequest) dismissGlobalTransaction(presentation)
		quoteAttempt.current += 1
		setFetching(false)
		run.current?.cancel()
		onClose()
	}
	const fetchQuote = async () => {
		if (review === undefined || completedRequest || fetching) return
		const attempt = ++quoteAttempt.current
		setFetching(true)
		setQuoteError(undefined)
		if (failureLatched) setManualRequestRequired(true)
		run.current?.cancel()
		try {
			const value = await fetchPrice(review)
			if (attempt !== quoteAttempt.current || !mounted.current) return
			setPrice(formatUnits(value, 18))
		} catch (error) {
			if (attempt === quoteAttempt.current && mounted.current) setQuoteError(getErrorMessage(error, priceRequestCopy.uniswapPriceFailed))
		} finally {
			if (attempt === quoteAttempt.current && mounted.current) setFetching(false)
		}
	}
	const priceControls = (
		<div className='request-price-fields' ref={priceControlsRef}>
			{quoteError === undefined ? undefined : (
				<span className='visually-hidden' role='alert'>
					{quoteError}
				</span>
			)}
			<LookupFieldRow
				label={poolCopy.manualRepPerEth}
				value={price}
				inputMode='decimal'
				disabled={completedRequest}
				onInput={value => {
					if (submittedHash !== undefined || failureLatched) setManualRequestRequired(true)
					run.current?.cancel()
					quoteAttempt.current += 1
					setFetching(false)
					setQuoteError(undefined)
					if (failureLatched) setManualRequestRequired(true)
					setPrice(value)
				}}
				error={priceError ?? quoteError}
				action={
					<button className='secondary request-price-fetch' type='button' disabled={completedRequest || fetching} onClick={() => void fetchQuote()}>
						{fetching ? <LoadingText>{priceRequestCopy.fetchingUniswapPrice}</LoadingText> : priceRequestCopy.fetchUniswapPrice}
					</button>
				}
			/>
		</div>
	)

	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<OperationModal embedTransactionSteps={false} isOpen={review !== undefined} title={poolCopy.requestNewPriceTitle} onClose={close}>
					{priceControls}
					{showSteps ? (
						<GlobalTransactionPresentationProvider transaction={presentation}>
							<TransactionStepsContent contextKey={key ?? ''} inlineFinalStatus onClose={close} />
						</GlobalTransactionPresentationProvider>
					) : (
						<PriceRequestPreview
							requestValue={review?.requestValueAttoEth}
							failedPlan={failedPlan}
							reason={confirmationGuardMessage ?? priceError ?? previewPrompt}
							error={confirmationGuardMessage}
							preparing={valid && !manualRequestRequired && (running || attempted !== key)}
							hideReason={!validPrice || priceError !== undefined || confirmationGuardMessage !== undefined}
							onClose={close}
							onReview={
								manualRequestRequired && valid && !running
									? () => {
											setManualRequestRequired(false)
											setFailureLatched(false)
											setFailedPlan(undefined)
											setRetry(value => value + 1)
										}
									: undefined
							}
						/>
					)}
				</OperationModal>
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
