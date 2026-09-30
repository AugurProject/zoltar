import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { registerTransactionPreparationScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { getCoordinatorInitialReportPrice } from '../../../protocol/oracleCoordinator.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { OpenOraclePriceInput } from './OpenOraclePriceInput.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider, unlockedTransactionActions } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import type { RequestPriceModalProps } from '../../security-pools/components/SecurityPoolOracleSections.js'
import * as poolCopy from '../../../copy/securityPool.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'
import { embeddedTransactionSteps } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { PriceRequestPreview } from './PriceRequestPreview.js'
import { TransactionStepsContent } from '@zoltar/ui-core-shared/components/TransactionStepsContent.js'
import { cancelTransactionReview, isTransactionStepInFlight, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { dismissGlobalTransaction, isGlobalTransactionDismissed } from '@zoltar/ui-core-shared/transactions/globalTransactionDismissal.js'
import type { FailedPricePlan } from './PriceRequestPreview.js'

async function fetchUniswapPrice(review: NonNullable<RequestPriceModalProps['review']>) {
	return await getCoordinatorInitialReportPrice(createConnectedReadClient(), review.managerAddress)
}

type PriceRequestRun = { key: string; signal: AbortSignal; cancel: () => void; submittedHash?: string; finalSubmittedHash?: string; failedHash?: string | undefined; submissionOutstanding?: boolean; steps?: NonNullable<typeof transactionSteps.value>['steps'] | undefined; plan?: FailedPricePlan }

function getRunSubmission(run: PriceRequestRun | undefined) {
	const workflow = transactionSteps.peek()
	const steps = run?.steps ?? (run !== undefined && workflow?.reviewSignal === run.signal ? workflow.steps : undefined)
	return {
		submittedHash: steps?.findLast(step => step.hash !== undefined)?.hash ?? run?.submittedHash,
		finalSubmittedHash: steps?.at(-1)?.hash ?? run?.finalSubmittedHash,
		inFlight: steps?.some(isTransactionStepInFlight) ?? false,
	}
}

export function RequestPriceModal({ review, onConfirm, onClose, canRequest, confirmationGuardMessage, confirmationWalletBlocker, closeOnSuccessKey, getReturnFocusTarget, fetchPrice = fetchUniswapPrice }: RequestPriceModalProps & { fetchPrice?: typeof fetchUniswapPrice }) {
	const [fetching, setFetching] = useState(false)
	const [quoteError, setQuoteError] = useState<string>()
	const quoteAttempt = useRef(0)
	const [price, setPrice] = useState('')
	const [retry, setRetry] = useState(0)
	const [preparationPaused, setPreparationPaused] = useState(false)
	const [failureLatched, setFailureLatched] = useState(false)
	const [failedPlan, setFailedPlan] = useState<FailedPricePlan>()
	const [running, setRunning] = useState(false)
	const [attempted, setAttempted] = useState<string>()
	const run = useRef<PriceRequestRun>()
	const previousReviewKey = useRef<string>()
	const priceControlsRef = useRef<HTMLDivElement>(null)
	const mounted = useRef(true)
	const confirm = useRef(onConfirm)
	confirm.current = onConfirm
	const presentation = useGlobalTransactionPresentation()
	const failureDismissed = presentation?.tone === 'error' && isGlobalTransactionDismissed(presentation)
	const previousFailureDismissed = useRef(failureDismissed)
	const retryPreparation = () => {
		if (!running) {
			run.current?.cancel()
			const tracked = run.current
			const { finalSubmittedHash: finalHash, inFlight } = getRunSubmission(tracked)
			const failedSubmission = finalHash !== undefined && (tracked?.failedHash === finalHash || (presentation?.tone === 'error' && presentation.hash === finalHash))
			const completedSubmission = finalHash !== undefined && (presentation?.tone === 'success' || presentation?.tone === 'warning') && presentation.hash === finalHash
			if (inFlight || (finalHash !== undefined && !failedSubmission && !completedSubmission)) {
				setPreparationPaused(true)
				return
			}
			run.current = undefined
		}
		setPreparationPaused(false)
		setFailureLatched(false)
		setFailedPlan(undefined)
		setRetry(value => value + 1)
	}
	// A quote resolves after an await; it reads the latched failure, pause, and retry of the latest render, not of the click that started it.
	const latestPreparationState = useRef({ failureLatched, preparationPaused, retryPreparation })
	latestPreparationState.current = { failureLatched, preparationPaused, retryPreparation }
	useEffect(() => {
		if (!previousFailureDismissed.current && failureDismissed && failureLatched) retryPreparation()
		previousFailureDismissed.current = failureDismissed
	}, [failureDismissed, failureLatched])
	const workflow = transactionSteps.value
	const parsed = tryParseDecimalInput(price)
	const validPrice = parsed !== undefined && parsed > 0n && parsed < 2n ** 256n
	const priceError = price !== '' && !validPrice ? poolCopy.manualInitialPriceError : undefined
	const proposedPrice = parsed
	const key = review === undefined ? undefined : `${review.managerAddress}:${review.securityPoolAddress}:${review.universeId}:${review.requestValueAttoEth}:${price}:${retry}`
	const valid = review !== undefined && canRequest && confirmationGuardMessage === undefined && validPrice && !fetching
	const ownsWorkflow = run.current !== undefined && workflow?.reviewSignal === run.current.signal
	const sending = ownsWorkflow && (workflow?.steps.some(isTransactionStepInFlight) ?? false)
	const finalReceiptConfirmed = ownsWorkflow && workflow?.steps.at(-1)?.hash !== undefined && workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	const { finalSubmittedHash, submittedHash, inFlight } = getRunSubmission(run.current)
	const canRetry = failureLatched && valid && !running && !inFlight
	const completedRequest = finalSubmittedHash !== undefined && (presentation?.tone === 'success' || presentation?.tone === 'warning') && presentation.hash === finalSubmittedHash && (closeOnSuccessKey === undefined || closeOnSuccessKey === finalSubmittedHash)
	const awaitingResult = (finalReceiptConfirmed || finalSubmittedHash !== undefined) && !completedRequest && presentation?.tone !== 'error' && run.current?.key === key && run.current?.signal.aborted === false
	const current = (valid || completedRequest || awaitingResult) && run.current?.key === key && run.current?.signal.aborted === false
	const showSteps = current && ownsWorkflow && workflow?.steps[workflow.activeIndex] !== undefined
	const failedCurrentAttempt =
		(!running && presentation?.tone === 'error' && ((key !== undefined && attempted === key) || (submittedHash !== undefined && presentation.hash === submittedHash) || (run.current?.submissionOutstanding && presentation.hash !== undefined))) || (showSteps && workflow?.steps.some(step => step.phase === 'failed'))
	useEffect(() => {
		const tracked = run.current
		if (preparationPaused && !running && !failureLatched && !failedCurrentAttempt && tracked?.steps !== undefined && finalSubmittedHash === undefined && !getRunSubmission(tracked).inFlight) retryPreparation()
	}, [preparationPaused, running, failureLatched, failedCurrentAttempt, finalSubmittedHash])
	let previewPrompt = validPrice ? priceRequestCopy.preparingPriceRequest : priceRequestCopy.enterPriceEstimate
	if (fetching) previewPrompt = priceRequestCopy.fetchingUniswapPrice
	if (preparationPaused) previewPrompt = priceRequestCopy.waitingForPriceRequest
	// Preparing and fetching progress is carried by the request and fetch buttons, so the prompt does not repeat it.
	const estimatePrompt = previewPrompt === priceRequestCopy.preparingPriceRequest || previewPrompt === priceRequestCopy.fetchingUniswapPrice ? undefined : previewPrompt

	useLayoutEffect(() => {
		if (review === undefined) return
		const reviewKey = `${review.managerAddress}:${review.securityPoolAddress}:${review.universeId}`
		if (previousReviewKey.current === reviewKey) return
		previousReviewKey.current = reviewKey
		if (run.current !== undefined) run.current.failedHash = undefined
		quoteAttempt.current += 1
		setFetching(false)
		setQuoteError(undefined)
		setPrice('')
		setAttempted(undefined)
		setPreparationPaused(false)
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
		const failedHash = presentation?.tone === 'error' ? presentation.hash : undefined
		if (run.current !== undefined && failedHash !== undefined && (failedHash === finalSubmittedHash || failedHash === submittedHash)) run.current.failedHash = failedHash
		setFailureLatched(true)
		setPreparationPaused(true)
		if (workflow !== undefined) {
			const plan = {
				funding: workflow.steps.flatMap(step => step.tokenFunding ?? []),
				totalAttoEth: workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n),
				outcome: workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome,
			}
			setFailedPlan(plan)
		} else if (run.current?.plan !== undefined) setFailedPlan(run.current.plan)
		if (!running) run.current?.cancel()
	}, [failedCurrentAttempt, running, presentation?.tone, presentation?.hash, finalSubmittedHash, submittedHash])
	useLayoutEffect(() => {
		if (finalSubmittedHash !== undefined && run.current !== undefined) run.current.finalSubmittedHash = finalSubmittedHash
	}, [finalSubmittedHash])
	useLayoutEffect(() => {
		if (!completedRequest) return
		const finishedRun = run.current
		if (ownsWorkflow) workflow?.cancel()
		if (embeddedTransactionSteps.value === finishedRun?.signal) embeddedTransactionSteps.value = undefined
		run.current = undefined
		setAttempted(undefined)
		setRunning(false)
		setRetry(value => value + 1)
		if (review !== undefined) onClose()
	}, [completedRequest, onClose, review, ownsWorkflow, workflow])
	useLayoutEffect(() => {
		if (!current && !sending && !(running && ownsWorkflow && workflow?.steps.some(step => step.hash !== undefined))) run.current?.cancel()
	}, [current, sending, running, ownsWorkflow, workflow])
	useLayoutEffect(() => {
		if (preparationPaused && !showSteps) priceControlsRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
	}, [preparationPaused, showSteps])
	useEffect(
		() => () => {
			mounted.current = false
			quoteAttempt.current += 1
			run.current?.cancel()
		},
		[],
	)
	useEffect(() => {
		if (!valid || review === undefined || key === undefined || running || attempted === key || preparationPaused || failureLatched) return
		const timer = setTimeout(() => {
			const cancellation = new AbortController()
			const releasePreparation = registerTransactionPreparationScope(cancellation.signal)
			embeddedTransactionSteps.value = cancellation.signal
			const cancel = () => {
				releasePreparation()
				const firstDetach = run.current?.signal === cancellation.signal && run.current.submissionOutstanding !== true
				const { steps: currentSteps } = cancelTransactionReview(cancellation.signal)
				const steps = currentSteps ?? (run.current?.signal === cancellation.signal ? run.current.steps : undefined)
				const submittedHash = steps?.findLast(step => step.hash !== undefined)?.hash
				const finalSubmittedHash = steps?.at(-1)?.hash
				const submissionOutstanding = (steps?.some(isTransactionStepInFlight) ?? false) || finalSubmittedHash !== undefined
				if (run.current?.signal === cancellation.signal) {
					run.current.steps = steps
					run.current.submissionOutstanding = submissionOutstanding
					if (submittedHash !== undefined) run.current.submittedHash = submittedHash
					if (finalSubmittedHash !== undefined) run.current.finalSubmittedHash = finalSubmittedHash
					if (steps !== undefined)
						run.current.plan = {
							funding: steps.flatMap(step => step.tokenFunding ?? []),
							totalAttoEth: steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n),
							outcome: steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome,
						}
					if (submissionOutstanding && firstDetach && mounted.current) setPreparationPaused(true)
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
				releasePreparation()
				if (mounted.current && run.current?.signal === cancellation.signal) setRunning(false)
				if (embeddedTransactionSteps.value === cancellation.signal) embeddedTransactionSteps.value = undefined
			})
		}, 300)
		return () => clearTimeout(timer)
	}, [valid, review, key, running, attempted, proposedPrice, preparationPaused, failureLatched])
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
		run.current?.cancel()
		try {
			const value = await fetchPrice(review)
			if (attempt !== quoteAttempt.current || !mounted.current) return
			const latest = latestPreparationState.current
			if (latest.failureLatched || latest.preparationPaused) latest.retryPreparation()
			setPrice(formatUnits(value, 18))
		} catch (error) {
			if (attempt === quoteAttempt.current && mounted.current) setQuoteError(getErrorMessage(error, priceRequestCopy.uniswapPriceFailed))
		} finally {
			if (attempt === quoteAttempt.current && mounted.current) setFetching(false)
		}
	}
	const priceControls = (
		<div className='request-price-fields' ref={priceControlsRef}>
			{quoteError === undefined ? undefined : <UserMessage placement='field' as='span' className='visually-hidden' tone='error' announcement='assertive' detail={quoteError} />}
			<OpenOraclePriceInput
				value={price}
				disabled={completedRequest}
				onInput={value => {
					if (submittedHash !== undefined || failureLatched || preparationPaused) retryPreparation()
					run.current?.cancel()
					quoteAttempt.current += 1
					setFetching(false)
					setQuoteError(undefined)
					setPrice(value)
				}}
				error={priceError ?? quoteError}
				fetching={fetching}
				onFetch={() => void fetchQuote()}
			/>
		</div>
	)

	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider lock={unlockedTransactionActions}>
				<OperationModal embedTransactionSteps={false} getReturnFocusTarget={getReturnFocusTarget} isOpen={review !== undefined} title={poolCopy.requestNewPriceTitle} onClose={close}>
					{priceControls}
					{showSteps ? (
						<GlobalTransactionPresentationProvider transaction={presentation}>
							<TransactionStepsContent contextKey={key ?? ''} onClose={close} />
						</GlobalTransactionPresentationProvider>
					) : (
						<PriceRequestPreview
							requestValue={review?.requestValueAttoEth}
							prompt={estimatePrompt}
							failedPlan={failedPlan}
							onRetry={canRetry ? retryPreparation : undefined}
							reason={confirmationGuardMessage ?? priceError ?? previewPrompt}
							error={confirmationGuardMessage}
							errorWalletBlocker={confirmationWalletBlocker}
							preparing={valid && !preparationPaused && (running || attempted !== key)}
							hideReason={!validPrice || priceError !== undefined || confirmationGuardMessage !== undefined}
							onClose={close}
						/>
					)}
				</OperationModal>
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
