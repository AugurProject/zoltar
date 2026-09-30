import { useId, useEffect, useRef } from 'preact/hooks'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import type { WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'
import { EthAmount, TransactionFundingSummary } from '@zoltar/ui-core-shared/components/TransactionFundingSummary.js'

export type FailedPricePlan = {
	funding: readonly { amount: string }[]
	totalAttoEth: bigint
	outcome: { returnToWallet: boolean; settlerRewardAttoEth: bigint | undefined } | undefined
}

export function PriceRequestPreview({
	requestValue,
	reason,
	error,
	errorWalletBlocker,
	preparing,
	hideReason,
	onClose,
	failedPlan,
	onRetry,
}: {
	requestValue: bigint | undefined
	reason: string
	error: string | undefined
	/** The wallet prerequisite, when it is the error that blocks the request. */
	errorWalletBlocker?: WalletActionBlocker | undefined
	preparing: boolean
	hideReason: boolean
	onClose: () => void
	failedPlan?: FailedPricePlan | undefined
	onRetry?: (() => void) | undefined
}) {
	const reasonId = useId()
	const errorRef = useRef<HTMLDivElement>(null)
	const actionButtonRef = useRef<HTMLButtonElement>(null)
	const availability = { disabled: onRetry === undefined, reason, walletBlocker: error === undefined ? undefined : errorWalletBlocker }
	useEffect(() => {
		if (error !== undefined) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
	}, [error])
	// While preparing, the primary action carries the busy state so the feedback slot stays empty and the actions do not move.
	const reasonHidden = hideReason || preparing || onRetry !== undefined
	let visibleFeedback = undefined
	if (error !== undefined) {
		visibleFeedback = <InlineHint id={reasonId} message={error} role='alert' />
	} else if (!reasonHidden) {
		visibleFeedback = <InlineHint id={reasonId} message={reason} />
	}
	let estimatePrompt = priceRequestCopy.enterPriceEstimate
	if (preparing) estimatePrompt = priceRequestCopy.preparingPriceRequest
	return (
		<>
			{failedPlan === undefined && onRetry === undefined ? <p className='detail price-request-estimate-prompt'>{estimatePrompt}</p> : undefined}
			{failedPlan === undefined ? undefined : (
				<div className='transaction-step-content'>
					<TransactionFundingSummary funding={failedPlan.funding} totalAttoEth={failedPlan.totalAttoEth} outcome={failedPlan.outcome ?? { returnToWallet: true, settlerRewardAttoEth: undefined }} />
					<p className='detail transaction-funding-note'>{copy.fundingDetail}</p>
				</div>
			)}
			<div className='transaction-step-actions transaction-approval-editor price-request-preview'>
				<div className='tx-action-group'>
					{/* A hidden reason lives outside the feedback container so the empty container collapses instead of reserving space. */}
					{error === undefined && reasonHidden && onRetry === undefined ? (
						<div className='visually-hidden'>
							<InlineHint id={reasonId} message={reason} />
						</div>
					) : undefined}
					<div className='actions'>
						<div className='transaction-plan-action transaction-plan-action-wide transaction-plan-action-final'>
							<WalletActionFixReason actionButtonRef={actionButtonRef} availability={availability} id={reasonId} visible={visibleFeedback !== undefined}>
								<div className='tx-action-feedback' ref={errorRef} aria-live='polite'>
									{visibleFeedback}
								</div>
							</WalletActionFixReason>
							<TransactionActionButton
								idleLabel={
									<>
										{priceRequestCopy.requestPrice} · <EthAmount value={requestValue} />
									</>
								}
								pending={preparing}
								pendingLabel={priceRequestCopy.preparingPriceRequest}
								onClick={() => onRetry?.()}
								actionButtonRef={actionButtonRef}
								availability={availability}
								disabledReasonElementId={reasonId}
								showDisabledReason={false}
								tone='primary'
							/>
							<div className='actions transaction-step-close'>
								<button className='secondary' type='button' onClick={onClose}>
									{commonCopy.cancel}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</>
	)
}
