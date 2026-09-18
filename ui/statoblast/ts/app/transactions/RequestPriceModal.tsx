import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import type { RequestPriceModalProps } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolOracleSections.js'
import * as poolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '../../copy/transactionSteps.js'
import { embeddedTransactionSteps, TransactionStepsContent } from './TransactionStepsModal.js'
import { transactionSteps } from './transactionSteps.js'

export function RequestPriceModal({ review, onConfirm, onClose, canRequest, confirmationGuardMessage, closeOnSuccessKey }: RequestPriceModalProps) {
	const [source, setSource] = useState<'automatic' | 'manual'>('automatic')
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
	const priceError = source === 'manual' && (parsed === undefined || parsed <= 0n || parsed >= 2n ** 256n) ? poolCopy.manualInitialPriceError : undefined
	const proposedPrice = source === 'manual' ? parsed : undefined
	const key = review === undefined ? undefined : `${review.managerAddress}:${review.securityPoolAddress}:${review.universeId}:${review.requestValueAttoEth}:${source}:${price}:${retry}`
	const valid = review !== undefined && canRequest && confirmationGuardMessage === undefined && priceError === undefined
	const ownsWorkflow = run.current !== undefined && workflow?.reviewSignal === run.current.signal
	const sending = ownsWorkflow && (workflow?.steps.some(step => step.phase === 'pending') ?? false)
	const current = valid && run.current?.key === key && run.current?.signal.aborted === false
	const showSteps = current && ownsWorkflow && workflow !== undefined
	const error = attempted === key && !running && presentation?.tone === 'error' ? presentation.detail : undefined

	useLayoutEffect(() => {
		setSource('automatic')
		setPrice('')
		setAttempted(undefined)
	}, [review])
	useLayoutEffect(() => {
		if (!current && !sending) run.current?.cancel()
	}, [current, sending])
	useEffect(
		() => () => {
			mounted.current = false
			run.current?.cancel()
		},
		[],
	)
	useEffect(() => {
		if (!valid || review === undefined || key === undefined || running || attempted === key) return
		const timer = setTimeout(
			() => {
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
			},
			source === 'manual' ? 300 : 0,
		)
		return () => clearTimeout(timer)
	}, [valid, review, key, running, attempted, proposedPrice, source])
	const close = () => {
		if (sending) return
		run.current?.cancel()
		onClose()
	}
	useEffect(() => {
		if (closeOnSuccessKey !== undefined && presentation?.tone === 'success') close()
	}, [closeOnSuccessKey, presentation?.tone])

	const priceControls = (
		<div className='request-price-fields'>
			<div>
				<ViewTabs
					ariaLabel={poolCopy.initialPriceSource}
					variant='segmented'
					value={source}
					onChange={setSource}
					options={[
						{ value: 'automatic', label: poolCopy.automaticUniswapPrice, disabled: sending },
						{ value: 'manual', label: poolCopy.manualInitialPrice, disabled: sending },
					]}
				/>
			</div>
			{source === 'manual' ? (
				<label className='field'>
					<span>{poolCopy.manualRepPerEth}</span>
					<FormInput aria-label={poolCopy.manualRepPerEth} value={price} inputMode='decimal' disabled={sending} onInput={event => setPrice(event.currentTarget.value)} error={priceError} />
				</label>
			) : undefined}
			{showSteps && source === 'automatic' ? (
				<p className='detail'>
					{poolCopy.manualRepPerEth}: <CurrencyValue precision='exact' value={workflow.steps.at(-1)?.proposedRepPerEthPrice} />
				</p>
			) : undefined}
		</div>
	)

	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<OperationModal isOpen={review !== undefined} title={poolCopy.requestNewPriceTitle} onClose={close} closeDisabled={sending}>
					{priceControls}
					{showSteps ? (
						<GlobalTransactionPresentationProvider transaction={presentation}>
							<TransactionStepsContent contextKey={key ?? ''} inline onClose={close} />
						</GlobalTransactionPresentationProvider>
					) : (
						<>
							<ErrorNotice message={confirmationGuardMessage ?? (typeof error === 'string' ? error : undefined)} />
							{valid && (running || attempted !== key) ? (
								<p role='status'>
									<LoadingText>{copy.preparingPriceRequest}</LoadingText>
								</p>
							) : undefined}
							<div className='actions'>
								<button className='secondary' type='button' onClick={close}>
									{commonCopy.cancel}
								</button>
								{error === undefined ? undefined : (
									<button className='secondary' type='button' onClick={() => setRetry(value => value + 1)}>
										{commonCopy.retry}
									</button>
								)}
							</div>
						</>
					)}
				</OperationModal>
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
