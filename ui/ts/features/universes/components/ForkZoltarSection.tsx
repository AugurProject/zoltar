import * as commonCopy from '../../../copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import type { Address } from '@zoltar/shared/ethereum'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricField } from '../../../components/MetricField.js'
import { Question } from '../../markets/components/Question.js'
import { StateHint } from '../../../components/StateHint.js'
import { TokenApprovalControl } from '../../../components/TokenApprovalControl.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { WorkflowSubsection } from '../../../components/WorkflowSubsection.js'
import { sameCaseInsensitiveText } from '../../../lib/caseInsensitive.js'
import { resolveLoadableValueState, type LoadableValueState } from '../../../lib/loadState.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '../../../lib/tokenApproval.js'
import { getReportPresentation, getUniversePresentation, getWalletPresentation } from '../../../lib/userCopy.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../../../types/contracts.js'
type ForkZoltarSectionProps = {
	accountAddress: Address | undefined
	hasLoadedZoltarQuestions: boolean
	isMainnet: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarQuestions: boolean
	onApproveZoltarForkRep: (amount?: bigint) => void
	onForkZoltar: () => void
	onZoltarForkQuestionIdChange: (questionId: string) => void
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkError: string | undefined
	zoltarForkPending: boolean
	zoltarForkQuestionId: string
	zoltarForkRepBalance: bigint | undefined
	zoltarQuestions: MarketDetails[]
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
}
export function ForkZoltarSection({
	accountAddress,
	hasLoadedZoltarQuestions,
	isMainnet,
	loadingZoltarForkAccess,
	loadingZoltarQuestions,
	onApproveZoltarForkRep,
	onForkZoltar,
	onZoltarForkQuestionIdChange,
	zoltarForkActiveAction,
	zoltarForkApproval,
	zoltarForkError,
	zoltarForkPending,
	zoltarForkQuestionId,
	zoltarForkRepBalance,
	zoltarQuestions,
	zoltarUniverse,
	zoltarUniverseState,
}: ForkZoltarSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const hasEnoughRep = rootUniverse !== undefined && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= rootUniverse.forkThreshold
	const approvalRequirement = deriveTokenApprovalRequirement(rootUniverse?.forkThreshold, zoltarForkApproval.value)
	const hasEnoughApproval = rootUniverse !== undefined && approvalRequirement.hasSufficientApproval
	const selectedQuestionId = zoltarForkQuestionId.trim()
	const hasSelectedQuestionId = selectedQuestionId !== ''
	const selectedQuestion = selectedQuestionId === '' ? undefined : zoltarQuestions.find(question => sameCaseInsensitiveText(question.questionId, selectedQuestionId))
	const selectedQuestionLookupState = resolveLoadableValueState({
		isLoading: loadingZoltarQuestions,
		isMissing: hasSelectedQuestionId && hasLoadedZoltarQuestions && selectedQuestion === undefined,
		value: selectedQuestion,
	})
	const selectedQuestionPresentation = hasSelectedQuestionId && selectedQuestionLookupState !== 'ready' ? getReportPresentation({ kind: 'question', state: selectedQuestionLookupState }) : undefined
	const canFork = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && !hasForked && !zoltarForkPending && selectedQuestion !== undefined && hasEnoughRep && hasEnoughApproval
	const approvalGuardMessage = (() => {
		const walletPresentation = getWalletPresentation({ accountAddress, isMainnet: true })
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (rootUniverse === undefined) return undefined
		if (hasForked) return zoltarCopy.alreadyForkedReason
		return undefined
	})()
	const forkGuardMessage =
		accountAddress === undefined
			? zoltarCopy.forkWalletRequiredReason
			: (() => {
					if (!isMainnet) return undefined
					if (rootUniverse === undefined) return zoltarCopy.forkDataRequiredReason

					return (() => {
						if (hasForked) return zoltarCopy.alreadyForkedReason
						if (selectedQuestion === undefined) return zoltarCopy.forkQuestionRequiredReason

						return (() => {
							if (!hasEnoughRep) return zoltarCopy.forkRepInsufficientReason
							if (!hasEnoughApproval) return zoltarCopy.forkRepApprovalRequiredReason

							return undefined
						})()
					})()
				})()
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={zoltarCopy.forkZoltar} />}
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}
	return (
		<>
			<DataGrid>
				<MetricField label={commonCopy.forkThreshold}>
					<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThreshold} suffix={commonCopy.rep} />
				</MetricField>
			</DataGrid>

			<div className='form-grid'>
				{hasForked ? undefined : (
					<TokenApprovalControl
						actionLabel={zoltarCopy.forkingActionLabel}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isMainnet}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={zoltarCopy.forkRepApprovalPending}
						requiredAmount={rootUniverse?.forkThreshold}
						resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThreshold.toString() ?? ''}`}
						tokenSymbol='REP'
						tokenUnits={18}
					/>
				)}

				<label className='field'>
					<span>{zoltarCopy.forkQuestionId}</span>
					<FormInput value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder={commonCopy.hexValuePlaceholder} disabled={hasForked || zoltarForkPending} />
				</label>

				{selectedQuestion === undefined ? undefined : (
					<WorkflowSubsection title={commonCopy.question}>
						<Question question={selectedQuestion} />
					</WorkflowSubsection>
				)}
				{selectedQuestionPresentation === undefined ? undefined : <StateHint presentation={selectedQuestionPresentation} />}

				<div className='actions'>
					<TransactionActionButton
						idleLabel={zoltarCopy.forkZoltar}
						pendingLabel={zoltarCopy.forkSubmissionPending}
						onClick={() => {
							if (selectedQuestionId === '') return
							onForkZoltar()
						}}
						pending={zoltarForkActiveAction === 'fork'}
						availability={{ disabled: !canFork, reason: forkGuardMessage }}
					/>
				</div>
			</div>

			<ErrorNotice message={zoltarForkError} />
		</>
	)
}
