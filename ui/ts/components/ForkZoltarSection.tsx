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
import {
	UI_STRING_APPROVE_ENOUGH_REP_BEFORE_FORKING_ZOLTAR,
	UI_STRING_APPROVING_REP_THRESHOLD_TRUNCATED,
	UI_STRING_CONNECT_A_WALLET_BEFORE_FORKING_ZOLTAR,
	UI_STRING_FORKING_ZOLTAR_ACTION_LABEL,
	UI_STRING_FORKING_ZOLTAR_TRUNCATED,
	UI_STRING_FORK_QUESTION_ID,
	UI_STRING_FORK_THRESHOLD,
	UI_STRING_FORK_ZOLTAR,
	UI_STRING_HEX_VALUE_PLACEHOLDER,
	UI_STRING_INSUFFICIENT_REP_TO_MEET_THE_FORK_THRESHOLD,
	UI_STRING_QUESTION,
	UI_STRING_REFRESH_UNIVERSE_DATA_BEFORE_FORKING_ZOLTAR,
	UI_STRING_REP,
	UI_STRING_SELECT_A_VALID_FORK_QUESTION_BEFORE_FORKING_ZOLTAR,
	UI_STRING_ZOLTAR_IS_ALREADY_FORKED,
} from '../lib/uiStrings.js'
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
		if (hasForked) return UI_STRING_ZOLTAR_IS_ALREADY_FORKED
		return undefined
	})()
	const forkGuardMessage =
		accountAddress === undefined
			? UI_STRING_CONNECT_A_WALLET_BEFORE_FORKING_ZOLTAR
			: (() => {
					if (!isMainnet) return undefined
					if (rootUniverse === undefined) return UI_STRING_REFRESH_UNIVERSE_DATA_BEFORE_FORKING_ZOLTAR

					return (() => {
						if (hasForked) return UI_STRING_ZOLTAR_IS_ALREADY_FORKED
						if (selectedQuestion === undefined) return UI_STRING_SELECT_A_VALID_FORK_QUESTION_BEFORE_FORKING_ZOLTAR

						return (() => {
							if (!hasEnoughRep) return UI_STRING_INSUFFICIENT_REP_TO_MEET_THE_FORK_THRESHOLD
							if (!hasEnoughApproval) return UI_STRING_APPROVE_ENOUGH_REP_BEFORE_FORKING_ZOLTAR

							return undefined
						})()
					})()
				})()
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={UI_STRING_FORK_ZOLTAR} />}
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}
	return (
		<>
			<DataGrid>
				<MetricField label={UI_STRING_FORK_THRESHOLD}>
					<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThreshold} suffix={UI_STRING_REP} />
				</MetricField>
			</DataGrid>

			<div className='form-grid'>
				{hasForked ? undefined : (
					<TokenApprovalControl
						actionLabel={UI_STRING_FORKING_ZOLTAR_ACTION_LABEL}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isMainnet}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={UI_STRING_APPROVING_REP_THRESHOLD_TRUNCATED}
						requiredAmount={rootUniverse?.forkThreshold}
						resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThreshold.toString() ?? ''}`}
						tokenSymbol='REP'
						tokenUnits={18}
					/>
				)}

				<label className='field'>
					<span>{UI_STRING_FORK_QUESTION_ID}</span>
					<FormInput value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER} disabled={hasForked || zoltarForkPending} />
				</label>

				{selectedQuestion === undefined ? undefined : (
					<WorkflowSubsection title={UI_STRING_QUESTION}>
						<Question question={selectedQuestion} />
					</WorkflowSubsection>
				)}
				{selectedQuestionPresentation === undefined ? undefined : <StateHint presentation={selectedQuestionPresentation} />}

				<div className='actions'>
					<TransactionActionButton
						idleLabel={UI_STRING_FORK_ZOLTAR}
						pendingLabel={UI_STRING_FORKING_ZOLTAR_TRUNCATED}
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
