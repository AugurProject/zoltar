import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionStepsCopy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import * as portfolioCopy from '../../../copy/portfolio.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import type { ComponentChildren } from 'preact'
import type { ForkAdmissionApproval } from '../../oracleTypes.js'

type Props = {
	approval: ForkAdmissionApproval | undefined
	forkButton: ComponentChildren
	forkPending: boolean
	onOpenForkWorkflow: (() => void) | undefined
	securityPoolAddress: string | undefined
}

/** The fork pulls any admission shortfall from its caller, so that approval stays in place before the fork, disabled when not needed or done. */
export function ForkTriggeredActions({ approval, forkButton, forkPending, onOpenForkWorkflow, securityPoolAddress }: Props) {
	if (approval === undefined)
		return (
			<div className='actions'>
				{forkButton}
				{onOpenForkWorkflow === undefined ? undefined : (
					<button className='secondary' type='button' onClick={onOpenForkWorkflow}>
						{reportingCopy.openForkAndMigration}
					</button>
				)}
			</div>
		)
	const { approvedAmount, requiredAmount } = approval
	let completedLabel: string | undefined
	if (requiredAmount === 0n) completedLabel = transactionStepsCopy.skipped
	else if (requiredAmount !== undefined && approvedAmount !== undefined && approvedAmount >= requiredAmount) completedLabel = commonCopy.approvalSatisfied
	return (
		<SectionBlock className='fork-admission-section' description={requiredAmount !== undefined && requiredAmount > 0n ? portfolioCopy.forkAdmissionShortfallDetail : undefined} title={portfolioCopy.forkAdmission} variant='embedded'>
			<TokenApprovalControl
				renderActions={({ button, notice, noticeId }) => (
					<>
						{notice === undefined ? undefined : <UserMessage id={noticeId} placement='field' detail={notice} />}
						<div className='actions'>
							{button}
							{forkButton}
						</div>
					</>
				)}
				completedLabel={completedLabel}
				showRequirementNotice={false}
				actionLabel={portfolioCopy.forkAdmissionActionLabel}
				allowanceError={approval.allowanceError}
				allowanceLoading={approval.loading}
				approvedAmount={approvedAmount}
				disabled={forkPending}
				guardMessage={undefined}
				onApprove={approval.onApprove}
				pending={approval.pending}
				pendingLabel={commonCopy.approvingRep}
				requiredAmount={requiredAmount}
				recommendedAmount={approval.recommendedAmount}
				resetKey={`${securityPoolAddress ?? ''}:${requiredAmount?.toString() ?? ''}`}
				tokenSymbol={commonCopy.rep}
				tokenUnits={18}
			/>
		</SectionBlock>
	)
}
