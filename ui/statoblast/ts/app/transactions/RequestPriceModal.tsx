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

async function fetchUniswapPrice(review: NonNullable<RequestPriceModalProps['review']>) {
	return await getCoordinatorInitialReportPrice(createConnectedReadClient(), review.managerAddress)
}

export function RequestPriceModal({ review, onConfirm, onClose, canRequest, confirmationGuardMessage, closeOnSuccessKey, fetchPrice = fetchUniswapPrice }: RequestPriceModalProps & { fetchPrice?: typeof fetchUniswapPrice }) {
	const [fetching, setFetching] = useState(false)
	const [quoteError, setQuoteError] = useState<string>()
	const quoteAttempt = useRef(0)
	const [price, setPrice] = useState('')
	const [retry, setRetry] = useState(0)
	const [running, setRunning] = useState(false)
	const [attempted, setAttempted] = useState<string>()
	const run = useRef<{ key: string; signal: AbortSignal; cancel: () => void }>()
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
	const current = valid && run.current?.key === key && run.current?.signal.aborted === false
	const showSteps = current && ownsWorkflow && workflow?.steps[workflow.activeIndex] !== undefined
	const error = attempted === key && !running && presentation?.tone === 'error' ? presentation.detail : undefined
	const estimatePrompt = validPrice ? priceRequestCopy.preparingPriceRequest : priceRequestCopy.enterPriceEstimate
	const previewPrompt = fetching ? priceRequestCopy.fetchingUniswapPrice : estimatePrompt

	useLayoutEffect(() => {
		quoteAttempt.current += 1
		setFetching(false)
		setQuoteError(undefined)
		setPrice('')
		setAttempted(undefined)
	}, [review])
	useLayoutEffect(() => {
		if (!current && !sending) run.current?.cancel()
	}, [current, sending])
	useEffect(
		() => () => {
			mounted.current = false
			quoteAttempt.current += 1
			run.current?.cancel()
		},
		[],
	)
	useEffect(() => {
		if (!valid || review === undefined || key === undefined || running || attempted === key) return
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
	}, [valid, review, key, running, attempted, proposedPrice])
	const close = () => {
		if (sending) return
		quoteAttempt.current += 1
		setFetching(false)
		run.current?.cancel()
		onClose()
	}
	useEffect(() => {
		if (closeOnSuccessKey !== undefined && presentation?.tone === 'success') close()
	}, [closeOnSuccessKey, presentation?.tone])

	const fetchQuote = async () => {
		if (review === undefined || sending || fetching) return
		const attempt = ++quoteAttempt.current
		setFetching(true)
		setQuoteError(undefined)
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
		<div className='request-price-fields'>
			{quoteError === undefined ? undefined : (
				<span className='visually-hidden' role='alert'>
					{quoteError}
				</span>
			)}
			<LookupFieldRow
				label={poolCopy.manualRepPerEth}
				value={price}
				inputMode='decimal'
				disabled={sending}
				onInput={value => {
					quoteAttempt.current += 1
					setFetching(false)
					setQuoteError(undefined)
					setPrice(value)
				}}
				error={priceError ?? quoteError}
				action={
					<button className='secondary request-price-fetch' type='button' disabled={sending || fetching} onClick={() => void fetchQuote()}>
						{fetching ? <LoadingText>{priceRequestCopy.fetchingUniswapPrice}</LoadingText> : priceRequestCopy.fetchUniswapPrice}
					</button>
				}
			/>
		</div>
	)

	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<OperationModal embedTransactionSteps={false} isOpen={review !== undefined} title={poolCopy.requestNewPriceTitle} onClose={close} closeDisabled={sending}>
					{priceControls}
					{showSteps ? (
						<GlobalTransactionPresentationProvider transaction={presentation}>
							<TransactionStepsContent contextKey={key ?? ''} onClose={close} />
						</GlobalTransactionPresentationProvider>
					) : (
						<PriceRequestPreview
							requestValue={review?.requestValueAttoEth}
							reason={confirmationGuardMessage ?? priceError ?? (typeof error === 'string' ? error : undefined) ?? previewPrompt}
							error={confirmationGuardMessage ?? (typeof error === 'string' ? error : undefined)}
							preparing={valid && (running || attempted !== key)}
							hideReason={!validPrice || priceError !== undefined || error !== undefined || confirmationGuardMessage !== undefined}
							onClose={close}
							onRetry={error === undefined ? undefined : () => setRetry(value => value + 1)}
						/>
					)}
				</OperationModal>
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
