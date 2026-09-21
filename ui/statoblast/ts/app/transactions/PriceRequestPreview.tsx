import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { useId, useEffect, useRef } from 'preact/hooks'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import * as priceRequestCopy from '@zoltar/ui-statoblast-shared/copy/priceRequest.js'
import { EthAmount, TransactionFundingSummary } from '@zoltar/ui-core-shared/components/TransactionFundingSummary.js'

export function PriceRequestPreview({ requestValue, reason, error, preparing, hideReason, onClose, onRetry }: { requestValue: bigint | undefined; reason: string; error: string | undefined; preparing: boolean; hideReason: boolean; onClose: () => void; onRetry: (() => void) | undefined }) {
	const reasonId = useId()
	const errorRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (error !== undefined) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
	}, [error])
	return (
		<>
			<div className='transaction-step-content'>
				<TransactionFundingSummary funding={[commonCopy.rep, commonCopy.weth].map(symbol => ({ amount: `${commonCopy.metricUnavailablePlaceholder} ${symbol}` }))} totalAttoEth={undefined} outcome={{ returnToWallet: true, settlerRewardAttoEth: undefined, ethRefundAttoEth: undefined }} />
				<p className='detail transaction-funding-note'>{copy.fundingDetail}</p>
			</div>
			<div className='transaction-step-actions transaction-approval-editor'>
				<div className='tx-action-group'>
					<div className='tx-action-feedback' ref={errorRef} aria-live='polite'>
						{error === undefined ? (
							<div className={hideReason ? 'visually-hidden' : undefined}>
								<InlineHint id={reasonId} message={reason} loading={preparing} />
							</div>
						) : (
							<InlineHint id={reasonId} message={error} role='alert' />
						)}
					</div>
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
							<TransactionActionButton
								idleLabel={
									<>
										{priceRequestCopy.requestPrice} · <EthAmount value={requestValue} />
									</>
								}
								pending={false}
								pendingLabel={copy.formatPendingAction(priceRequestCopy.requestPrice)}
								onClick={() => undefined}
								availability={{ disabled: true, reason }}
								disabledReasonElementId={reasonId}
								showDisabledReason={false}
								tone='primary'
							/>
							<div className='actions transaction-step-close'>
								<button className='secondary' type='button' onClick={onRetry ?? onClose}>
									{onRetry === undefined ? commonCopy.cancel : commonCopy.retry}
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
