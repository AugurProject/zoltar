import { useId } from 'preact/hooks'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { EthAmount } from '@zoltar/ui-core-shared/components/TransactionFundingSummary.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionStepsCopy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import type { VaultOperationsApprovalKind, VaultOperationsPrerequisites as Prerequisites } from '../../../protocol/vaultOperations.js'
import * as copy from '../../../copy/vaultOperations.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

type Props = {
	/** Undefined while the requirements for valid inputs load. */
	prerequisites: Prerequisites | undefined
	/** Shown on every control while the form itself blocks submission, such as invalid inputs or a missing wallet. */
	blockedReason: string | undefined
	showReportFunding: boolean
	busy: boolean
	busyAction: string | undefined
	resetKey: string
	onApprove: (kind: VaultOperationsApprovalKind, amount?: bigint) => void
	onWrap: () => void
}

/** Each transaction the bundle needs first, as its own button above Review, prepared read-only from the valid form inputs. */
export function VaultOperationsPrerequisites({ prerequisites, blockedReason, showReportFunding, busy, busyAction, resetKey, onApprove, onWrap }: Props) {
	const waitingReasonId = useId()
	const loading = prerequisites === undefined && blockedReason === undefined
	// One visible reason covers every control while the form blocks them, instead of repeating it under each button.
	const waitingReason = blockedReason ?? (loading ? copy.checking : undefined)
	const waitingReasonElementId = waitingReason === undefined ? undefined : waitingReasonId
	const approval = (kind: VaultOperationsApprovalKind, tokenSymbol: string, purpose: string) => {
		const current = prerequisites?.approvals.find(candidate => candidate.kind === kind)
		const satisfied = current !== undefined && current.approvedAmount >= current.requiredAmount
		let guardMessage = waitingReason
		if (guardMessage === undefined && current === undefined) guardMessage = transactionStepsCopy.skipped
		return (
			<TokenApprovalControl
				approvalPurpose={purpose}
				compact
				completedLabel={satisfied && busyAction !== kind ? transactionStepsCopy.formatStepCompleted(transactionStepsCopy.formatTokenApproved(tokenSymbol)) : undefined}
				customAmountDisclosureLabel={securityPoolCopy.customApprovalAmountDisclosure}
				showRequirementNotice={false}
				actionLabel={copy.approvalAction}
				allowanceError={undefined}
				allowanceLoading={loading}
				approvedAmount={current?.approvedAmount}
				guardMessage={guardMessage}
				guardMessageElementId={waitingReasonElementId}
				disabled={busy && busyAction !== kind}
				onApprove={amount => onApprove(kind, amount)}
				pending={busyAction === kind}
				pendingLabel={commonCopy.formatApprovingToken(tokenSymbol)}
				requiredAmount={current?.requiredAmount}
				recommendedAmount={current?.recommendedAmount}
				resetKey={`${resetKey}:${kind}:${current?.requiredAmount.toString() ?? ''}`}
				tokenSymbol={tokenSymbol}
				tokenUnits={18}
			/>
		)
	}
	const wrapAttoEth = prerequisites?.wrapAttoEth
	const wrapNeeded = wrapAttoEth !== undefined && wrapAttoEth > 0n
	const wrapReason = waitingReason ?? (wrapNeeded ? undefined : transactionStepsCopy.skipped)
	return (
		<WorkflowSubsection title={copy.prerequisites} className='vault-operations-prerequisites'>
			{waitingReason === undefined ? undefined : <UserMessage placement='field' id={waitingReasonId} detail={waitingReason} />}
			<div className='vault-operations-prerequisite'>
				<p className='vault-operations-prerequisite-title'>{copy.depositApprovalPurpose}</p>
				{approval('deposit', commonCopy.rep, copy.depositApprovalPurpose)}
			</div>
			{showReportFunding ? (
				<div className='vault-operations-prerequisite'>
					<p className='vault-operations-prerequisite-title'>{copy.reportApprovalPurpose}</p>
					<div className='actions'>
						<TransactionActionButton
							tone='secondary'
							idleLabel={
								wrapNeeded ? (
									<>
										{transactionStepsCopy.wrapEthIntoWeth} · <EthAmount value={wrapAttoEth} />
									</>
								) : (
									transactionStepsCopy.wrapEthIntoWeth
								)
							}
							pendingLabel={transactionStepsCopy.formatPendingAction(transactionStepsCopy.wrapEthIntoWeth)}
							pending={busyAction === 'wrap'}
							onClick={onWrap}
							availability={{ disabled: busy || wrapReason !== undefined, reason: busy ? undefined : wrapReason }}
							disabledReasonElementId={waitingReasonElementId}
							showDisabledReason={waitingReasonElementId === undefined}
						/>
					</div>
					{approval('reportWeth', commonCopy.weth, copy.reportApprovalPurpose)}
					{approval('reportRep', commonCopy.rep, copy.reportApprovalPurpose)}
				</div>
			) : undefined}
		</WorkflowSubsection>
	)
}
