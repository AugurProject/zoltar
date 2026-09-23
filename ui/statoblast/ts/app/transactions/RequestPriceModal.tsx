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
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { dismissGlobalTransaction } from '@zoltar/ui-core-shared/transactions/globalTransactionDismissal.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import type { GlobalTransactionPresentation } from '@zoltar/ui-core-shared/types/components.js'
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
	const [failureMessage, setFailureMessage] = useState<string>()
	const [failedPrice, setFailedPrice] = useState<string>()
	const [failedPlan, setFailedPlan] = useState<FailedPricePlan>()
	const [running, setRunning] = useState(false)
	const [attempted, setAttempted] = useState<string>()
	const run = useRef<{ key: string; signal: AbortSignal; cancel: () => void }>()
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
	const completedRequest = closeOnSuccessKey !== undefined && (presentation?.tone === 'success' || presentation?.tone === 'warning') && presentation.hash === closeOnSuccessKey && finalReceiptConfirmed && workflow?.steps.at(-1)?.hash === closeOnSuccessKey
	const awaitingResult = finalReceiptConfirmed && !completedRequest && presentation?.tone !== 'error' && run.current?.key === key && run.current?.signal.aborted === false
	const current = (valid || completedRequest || awaitingResult) && run.current?.key === key && run.current?.signal.aborted === false
	const showSteps = current && ownsWorkflow && workflow?.steps[workflow.activeIndex] !== undefined
	const currentAttemptError = attempted === key && !running && presentation?.tone === 'error' ? presentation.detail : undefined
	const error = failureLatched ? failureMessage : currentAttemptError
	const failedCurrentAttempt = (key !== undefined && attempted === key && !running && presentation?.tone === 'error') || (showSteps && workflow?.steps.some(step => step.phase === 'failed'))
	const failedPresentation = presentation?.tone === 'error' ? presentation : undefined
	const technicalRows = failedPresentation?.technicalRows ?? failedPlan?.technicalRows
	const failureNotice: GlobalTransactionPresentation | undefined =
		!failureLatched || typeof error !== 'string'
			? undefined
			: {
					...failedPresentation,
					tone: 'error',
					title: failedPresentation?.title ?? transactionCopy.requestingPrice,
					detail: error,
					rows: [
						...(failedPresentation?.rows?.length || review === undefined
							? (failedPresentation?.rows ?? [])
							: [
									{ label: commonCopy.securityPoolAddress, value: <AddressValue address={review.securityPoolAddress} /> },
									{ label: commonCopy.oracleManager, value: <AddressValue address={review.managerAddress} /> },
								]),
						...(failedPrice === undefined ? [] : [{ label: priceRequestCopy.attemptedRepPerEthPrice, value: failedPrice }]),
					],
					...(technicalRows === undefined ? {} : { technicalRows }),
				}
	const estimatePrompt = validPrice ? priceRequestCopy.preparingPriceRequest : priceRequestCopy.enterPriceEstimate
	let previewPrompt = estimatePrompt
	if (fetching) previewPrompt = priceRequestCopy.fetchingUniswapPrice
	if (manualRequestRequired) previewPrompt = priceRequestCopy.checkPriceBeforeRequest

	useLayoutEffect(() => {
		quoteAttempt.current += 1
		setFetching(false)
		setQuoteError(undefined)
		setPrice('')
		setAttempted(undefined)
		setManualRequestRequired(false)
		setFailureLatched(false)
		setFailureMessage(undefined)
		setFailedPrice(undefined)
		setFailedPlan(undefined)
	}, [review])
	useLayoutEffect(() => {
		if (!failedCurrentAttempt) return
		setFailureLatched(true)
		setManualRequestRequired(true)
		setFailureMessage(workflow?.steps.find(step => step.phase === 'failed')?.error ?? (typeof presentation?.detail === 'string' ? presentation.detail : undefined))
		setFailedPrice(price)
		if (workflow !== undefined) {
			setFailedPlan({
				funding: workflow.steps.flatMap(step => step.tokenFunding ?? []),
				totalAttoEth: workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n),
				outcome: workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome,
				technicalRows: presentation?.technicalRows,
			})
		}
		run.current?.cancel()
	}, [failedCurrentAttempt])
	useLayoutEffect(() => {
		if (!current && !sending) run.current?.cancel()
	}, [current, sending])
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
				cancellation.abort()
				if (mounted.current) setAttempted(undefined)
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
				if (cancellation.signal.aborted && embeddedTransactionSteps.value === cancellation.signal) embeddedTransactionSteps.value = undefined
			})
		}, 300)
		return () => clearTimeout(timer)
	}, [valid, review, key, running, attempted, proposedPrice, manualRequestRequired, failureLatched])
	const close = () => {
		if (sending || awaitingResult) return
		if (completedRequest) dismissGlobalTransaction(presentation)
		quoteAttempt.current += 1
		setFetching(false)
		run.current?.cancel()
		onClose()
	}
	const fetchQuote = async () => {
		if (review === undefined || sending || awaitingResult || completedRequest || fetching) return
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
				disabled={sending || awaitingResult || completedRequest}
				onInput={value => {
					quoteAttempt.current += 1
					setFetching(false)
					setQuoteError(undefined)
					if (failureLatched) setManualRequestRequired(true)
					setPrice(value)
				}}
				error={priceError ?? quoteError}
				action={
					<button className='secondary request-price-fetch' type='button' disabled={sending || awaitingResult || completedRequest || fetching} onClick={() => void fetchQuote()}>
						{fetching ? <LoadingText>{priceRequestCopy.fetchingUniswapPrice}</LoadingText> : priceRequestCopy.fetchUniswapPrice}
					</button>
				}
			/>
		</div>
	)

	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<OperationModal embedTransactionSteps={false} isOpen={review !== undefined} title={poolCopy.requestNewPriceTitle} onClose={close} closeDisabled={sending || awaitingResult}>
					{priceControls}
					{showSteps ? (
						<GlobalTransactionPresentationProvider transaction={presentation}>
							<TransactionStepsContent contextKey={key ?? ''} onClose={close} showCompletedResult />
						</GlobalTransactionPresentationProvider>
					) : (
						<PriceRequestPreview
							requestValue={review?.requestValueAttoEth}
							failedPlan={failedPlan}
							failureNotice={failureNotice}
							reason={confirmationGuardMessage ?? priceError ?? (typeof error === 'string' ? error : undefined) ?? previewPrompt}
							error={confirmationGuardMessage ?? (failureNotice === undefined && typeof error === 'string' ? error : undefined)}
							preparing={valid && !manualRequestRequired && (running || attempted !== key)}
							hideReason={!validPrice || priceError !== undefined || error !== undefined || confirmationGuardMessage !== undefined}
							onClose={close}
							onReview={
								manualRequestRequired && valid
									? () => {
											setManualRequestRequired(false)
											setFailureLatched(false)
											setFailureMessage(undefined)
											setFailedPrice(undefined)
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
