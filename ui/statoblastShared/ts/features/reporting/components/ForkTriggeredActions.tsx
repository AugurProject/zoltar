import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import type { ComponentChildren } from 'preact'
import type { ForkAdmissionApproval } from '../../oracleTypes.js'

type Props = {
	approval: ForkAdmissionApproval | undefined
	designedOverview: boolean
	forkButton: ComponentChildren
	forkPending: boolean
	onOpenForkWorkflow: (() => void) | undefined
	questionLedgerAddress: string | undefined
}

/** Only a nonzero admission shortfall requires a wallet approval before the fork. */
export function ForkTriggeredActions({ approval, designedOverview, forkButton, forkPending, onOpenForkWorkflow, questionLedgerAddress }: Props) {
	if (onOpenForkWorkflow !== undefined)
		return (
			<div className='actions'>
				<button className='secondary' type='button' onClick={onOpenForkWorkflow}>
					{reportingCopy.openForkAndMigration}
				</button>
			</div>
		)
	const approvedAmount = approval?.approvedAmount
	const requiredAmount = approval?.requiredAmount
	const hasCost = requiredAmount !== undefined && requiredAmount > 0n
	const allowanceCoversCost = hasCost && approvedAmount !== undefined && approvedAmount >= requiredAmount
	const triggerStep = (
		<div className='statoblast-fork-trigger'>
			{forkButton}
			<p className='detail'>{reportingCopy.forkTriggerOnce}</p>
		</div>
	)
	return (
		<SectionBlock className='statoblast-fork-danger' title={securityPoolCopy.forkAdmission} tone='critical' variant={designedOverview ? 'default' : 'embedded'}>
			<div className='statoblast-fork-danger-grid'>
				<div className='statoblast-fork-consequences'>
					<UserMessage
						tone='error'
						detail={
							<>
								<p>
									<strong>{reportingCopy.forkIrreversible}</strong> {reportingCopy.forkFreeze}
								</p>
								{hasCost && approval?.loading === false ? (
									<p>
										<strong>
											{reportingCopy.forkCostLead} <CurrencyValue value={requiredAmount} suffix={commonCopy.rep} />.
										</strong>{' '}
										{reportingCopy.forkCostDetail}
									</p>
								) : undefined}
							</>
						}
					/>
					<p className='detail'>{reportingCopy.forkStakeCarries}</p>
				</div>
				{!hasCost || approval === undefined ? (
					triggerStep
				) : (
					<TokenApprovalControl
						renderActions={({ button, notice, noticeId }) => (
							<>
								{notice === undefined ? undefined : <UserMessage id={noticeId} placement='field' detail={notice} />}
								{allowanceCoversCost ? (
									triggerStep
								) : (
									<ol className='statoblast-report-fork-steps'>
										<li>{button}</li>
										<li>{triggerStep}</li>
									</ol>
								)}
							</>
						)}
						completedLabel={allowanceCoversCost ? commonCopy.approvalSatisfied : undefined}
						showRequirementNotice={false}
						actionLabel={securityPoolCopy.forkAdmissionActionLabel}
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
						resetKey={`${questionLedgerAddress ?? ''}:${requiredAmount.toString()}`}
						tokenSymbol={commonCopy.rep}
						tokenUnits={18}
					/>
				)}
			</div>
		</SectionBlock>
	)
}
