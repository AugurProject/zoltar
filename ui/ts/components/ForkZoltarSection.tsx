import type { Address } from '@zoltar/shared/ethereum'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { resolveLoadableValueState, type LoadableValueState } from '../lib/loadState.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '../lib/tokenApproval.js'
import { getReportPresentation, getUniversePresentation, getWalletPresentation } from '../lib/userCopy.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../types/contracts.js'
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
		const walletPresentation = getWalletPresentation({ accountAddress, isMainnet })
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (rootUniverse === undefined) return undefined
		if (hasForked) return 'Zoltar is already forked.'
		return undefined
	})()
	const forkGuardMessage =
		accountAddress === undefined
			? 'Connect a wallet before forking Zoltar.'
			: (() => {
					if (!isMainnet) return 'Switch to Ethereum mainnet before forking Zoltar.'
					if (rootUniverse === undefined) return 'Refresh universe data before forking Zoltar.'

					return (() => {
						if (hasForked) return 'Zoltar is already forked.'
						if (selectedQuestion === undefined) return 'Select a valid fork question before forking Zoltar.'

						return (() => {
							if (!hasEnoughRep) return 'Insufficient REP to meet the fork threshold.'
							if (!hasEnoughApproval) return 'Approve enough REP before forking Zoltar.'

							return undefined
						})()
					})()
				})()
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title='Fork Zoltar' />}
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}
	return (
		<>
			<DataGrid>
				<MetricField label='Fork Threshold'>
					<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThreshold} suffix='REP' />
				</MetricField>
			</DataGrid>

			<div className='form-grid'>
				{hasForked ? undefined : (
					<TokenApprovalControl
						actionLabel='forking Zoltar'
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel='Approving REP Threshold...'
						requiredAmount={rootUniverse?.forkThreshold}
						resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThreshold.toString() ?? ''}`}
						safetyId='zoltar.approveForkRep'
						tokenSymbol='REP'
						tokenUnits={18}
					/>
				)}

				<label className='field'>
					<span>Fork Question ID</span>
					<FormInput value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder='0x...' disabled={hasForked || zoltarForkPending} />
				</label>

				{selectedQuestion === undefined ? undefined : (
					<WorkflowSubsection title='Question'>
						<Question question={selectedQuestion} />
					</WorkflowSubsection>
				)}
				{selectedQuestionPresentation === undefined ? undefined : <StateHint presentation={selectedQuestionPresentation} />}

				<div className='actions'>
					<TransactionActionButton
						safetyId='zoltar.forkZoltar'
						idleLabel='Fork Zoltar'
						pendingLabel='Forking Zoltar...'
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
