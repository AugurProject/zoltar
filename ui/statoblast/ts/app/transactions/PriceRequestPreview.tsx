import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { useId } from 'preact/hooks'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '../../copy/transactionSteps.js'
import { EthAmount, TransactionFundingSummary } from './TransactionFundingSummary.js'

export function PriceRequestPreview({ requestValue, reason, error, preparing, hideReason, onClose, onRetry }: { requestValue: bigint | undefined; reason: string; error: string | undefined; preparing: boolean; hideReason: boolean; onClose: () => void; onRetry: (() => void) | undefined }) {
	const reasonId = useId()
	return (
		<>
			<div className='transaction-step-content'>
				<TransactionFundingSummary funding={[commonCopy.rep, commonCopy.weth].map(symbol => ({ amount: `${commonCopy.metricUnavailablePlaceholder} ${symbol}` }))} totalAttoEth={undefined} outcome={{ returnToWallet: true, settlerRewardAttoEth: undefined, ethRefundAttoEth: undefined }} />
				<p className='detail transaction-funding-note'>{copy.fundingDetail}</p>
				<ErrorNotice message={error} />
			</div>
			<div className='transaction-step-actions transaction-approval-editor'>
				<div className='tx-action-group'>
					<div className={hideReason ? 'visually-hidden' : 'tx-action-feedback'} aria-live='polite'>
						<InlineHint id={reasonId} message={reason} loading={preparing} />
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
							</div>
						))}
						<div className='transaction-plan-action transaction-plan-action-wide transaction-plan-action-final'>
							<TransactionActionButton
								idleLabel={
									<>
										{copy.requestPrice} · <EthAmount value={requestValue} />
									</>
								}
								pending={false}
								pendingLabel={copy.formatPendingAction(copy.requestPrice)}
								onClick={() => undefined}
								availability={{ disabled: true, reason }}
								disabledReasonElementId={reasonId}
								showDisabledReason={false}
								tone='primary'
							/>
							<div className='actions transaction-step-close'>
								{onRetry === undefined ? undefined : (
									<button className='secondary' type='button' onClick={onRetry}>
										{commonCopy.retry}
									</button>
								)}
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
