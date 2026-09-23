import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { useId, useEffect, useRef } from 'preact/hooks'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionPresentationNotice } from '@zoltar/ui-core-shared/components/TransactionPresentationNotice.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import * as priceRequestCopy from '@zoltar/ui-statoblast-shared/copy/priceRequest.js'
import { EthAmount, TransactionFundingSummary } from '@zoltar/ui-core-shared/components/TransactionFundingSummary.js'
import type { GlobalTransactionPresentation, GlobalTransactionRow } from '@zoltar/ui-core-shared/types/components.js'

export type FailedPricePlan = {
	funding: readonly { amount: string }[]
	totalAttoEth: bigint
	outcome: { returnToWallet: boolean; settlerRewardAttoEth: bigint | undefined } | undefined
	technicalRows: GlobalTransactionRow[] | undefined
}

export function PriceRequestPreview({
	requestValue,
	reason,
	error,
	failureNotice,
	preparing,
	hideReason,
	onClose,
	onReview,
	failedPlan,
}: {
	requestValue: bigint | undefined
	reason: string
	error: string | undefined
	failureNotice: GlobalTransactionPresentation | undefined
	preparing: boolean
	hideReason: boolean
	onClose: () => void
	onReview?: (() => void) | undefined
	failedPlan?: FailedPricePlan | undefined
}) {
	const reasonId = useId()
	const errorRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (error !== undefined || failureNotice !== undefined) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
	}, [error, failureNotice?.detail])
	// While preparing, the primary action carries the busy state so the feedback slot stays empty and the actions do not move.
	const reasonHidden = hideReason || preparing
	let visibleFeedback = undefined
	if (failureNotice !== undefined) {
		visibleFeedback = (
			<>
				<TransactionPresentationNotice transaction={failureNotice} />
				{error === undefined ? undefined : <InlineHint id={reasonId} message={error} role='alert' />}
			</>
		)
	} else if (error !== undefined) {
		visibleFeedback = <InlineHint id={reasonId} message={error} role='alert' />
	} else if (!reasonHidden) {
		visibleFeedback = <InlineHint id={reasonId} message={reason} />
	}
	return (
		<>
			<div className='transaction-step-content'>
				<TransactionFundingSummary funding={failedPlan?.funding ?? [commonCopy.rep, commonCopy.weth].map(symbol => ({ amount: `${commonCopy.metricUnavailablePlaceholder} ${symbol}` }))} totalAttoEth={failedPlan?.totalAttoEth} outcome={failedPlan?.outcome ?? { returnToWallet: true, settlerRewardAttoEth: undefined }} />
				<p className='detail transaction-funding-note'>{copy.fundingDetail}</p>
			</div>
			<div className='transaction-step-actions transaction-approval-editor price-request-preview'>
				<div className='tx-action-group'>
					{/* A hidden reason lives outside the feedback container so the empty container collapses instead of reserving space. */}
					{error === undefined && reasonHidden ? (
						<div className='visually-hidden'>
							<InlineHint id={reasonId} message={reason} />
						</div>
					) : undefined}
					<div className='actions'>
						{[commonCopy.rep, commonCopy.weth].map(symbol => (
							<div className='transaction-plan-action' key={symbol}>
								<TokenApprovalControl
									compact
									showRequirementNotice={false}
									actionLabel={copy.fundReport}
									allowanceError={undefined}
									allowanceLoading={false}
									approvedAmount={undefined}
									requiredAmount={undefined}
									disabled
									guardMessage={reason}
									guardMessageElementId={reasonId}
									onApprove={() => undefined}
									pending={false}
									pendingLabel={commonCopy.formatApprovingToken(symbol)}
									resetKey='price-estimate'
									tokenSymbol={symbol}
									tokenUnits={18}
								/>
								<div className='transaction-step-hash' />
							</div>
						))}
						<div className='transaction-plan-action transaction-plan-action-wide transaction-plan-action-final'>
							{visibleFeedback === undefined ? undefined : (
								<div className='tx-action-feedback' ref={errorRef} aria-live={failureNotice === undefined ? 'polite' : undefined}>
									{visibleFeedback}
								</div>
							)}
							<TransactionActionButton
								idleLabel={
									<>
										{priceRequestCopy.requestPrice} · <EthAmount value={requestValue} />
									</>
								}
								pending={preparing}
								pendingLabel={priceRequestCopy.preparingPriceRequest}
								onClick={onReview ?? (() => undefined)}
								availability={{ disabled: onReview === undefined, reason }}
								disabledReasonElementId={reasonId}
								showDisabledReason={false}
								tone='primary'
							/>
							<div className='actions transaction-step-close'>
								<button className='secondary' type='button' onClick={onClose}>
									{commonCopy.cancel}
								</button>
							</div>
							<div className='transaction-step-hash' />
						</div>
					</div>
				</div>
			</div>
		</>
	)
}
