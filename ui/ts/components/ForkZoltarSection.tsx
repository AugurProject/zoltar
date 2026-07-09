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
import { TSX_STRINGS } from '../lib/uiStrings.js'
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
		if (hasForked) return TSX_STRINGS.componentsForkZoltarSection.copy001
		return undefined
	})()
	const forkGuardMessage =
		accountAddress === undefined
			? TSX_STRINGS.componentsForkZoltarSection.copy002
			: (() => {
					if (!isMainnet) return undefined
					if (rootUniverse === undefined) return TSX_STRINGS.componentsForkZoltarSection.copy003

					return (() => {
						if (hasForked) return TSX_STRINGS.componentsForkZoltarSection.copy004
						if (selectedQuestion === undefined) return TSX_STRINGS.componentsForkZoltarSection.copy005

						return (() => {
							if (!hasEnoughRep) return TSX_STRINGS.componentsForkZoltarSection.copy006
							if (!hasEnoughApproval) return TSX_STRINGS.componentsForkZoltarSection.copy007

							return undefined
						})()
					})()
				})()
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={TSX_STRINGS.componentsForkZoltarSection.copy008} />}
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}
	return (
		<>
			<DataGrid>
				<MetricField label={TSX_STRINGS.componentsForkZoltarSection.copy009}>
					<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThreshold} suffix={TSX_STRINGS.componentsForkZoltarSection.copy010} />
				</MetricField>
			</DataGrid>

			<div className='form-grid'>
				{hasForked ? undefined : (
					<TokenApprovalControl
						actionLabel={TSX_STRINGS.componentsForkZoltarSection.copy011}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isMainnet}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={TSX_STRINGS.componentsForkZoltarSection.copy012}
						requiredAmount={rootUniverse?.forkThreshold}
						resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThreshold.toString() ?? ''}`}
						safetyId='zoltar.approveForkRep'
						tokenSymbol='REP'
						tokenUnits={18}
					/>
				)}

				<label className='field'>
					<span>{TSX_STRINGS.componentsForkZoltarSection.copy013}</span>
					<FormInput value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder={TSX_STRINGS.componentsForkZoltarSection.copy014} disabled={hasForked || zoltarForkPending} />
				</label>

				{selectedQuestion === undefined ? undefined : (
					<WorkflowSubsection title={TSX_STRINGS.componentsForkZoltarSection.copy015}>
						<Question question={selectedQuestion} />
					</WorkflowSubsection>
				)}
				{selectedQuestionPresentation === undefined ? undefined : <StateHint presentation={selectedQuestionPresentation} />}

				<div className='actions'>
					<TransactionActionButton
						safetyId='zoltar.forkZoltar'
						idleLabel={TSX_STRINGS.componentsForkZoltarSection.copy016}
						pendingLabel={TSX_STRINGS.componentsForkZoltarSection.copy017}
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
