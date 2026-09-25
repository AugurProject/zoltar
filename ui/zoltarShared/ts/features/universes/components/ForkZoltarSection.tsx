import { useEffect, useState } from 'preact/hooks'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { Question } from '@zoltar/ui-core-shared/components/Question.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { resolveLoadableValueState, type LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import type { TokenApprovalState } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getReportPresentation, getUniversePresentation, getWalletPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import type { MarketDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { deriveForkChecklist, type ForkChecklistStepKey, type ForkQuestionSelection } from '../lib/forkChecklist.js'
import { ForkChecklistSteps, getForkChecklistReasonId } from './ForkChecklistSteps.js'
import { ForkQuestionPicker } from './ForkQuestionPicker.js'

const FORK_QUESTION_ERROR_ID = 'fork-zoltar-question-error'
const FORK_QUESTION_STATE_ID = 'fork-zoltar-question-state'

type ForkZoltarSectionProps = {
	accountAddress: Address | undefined
	currentTimestamp?: bigint | undefined
	hasLoadedZoltarQuestions: boolean
	isOnActiveAppChain: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarQuestion?: boolean
	loadingZoltarQuestions: boolean
	onApproveZoltarForkRep: (amount?: bigint) => void
	onForkZoltar: () => void
	/** Loads every registry question so the picker can list the eligible ones; called once when they are not loaded yet. */
	onLoadZoltarQuestions?: (() => Promise<void>) | undefined
	onRetryZoltarQuestion?: (() => void) | undefined
	onZoltarForkQuestionIdChange: (questionId: string) => void
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkError: string | undefined
	zoltarForkPending: boolean
	zoltarForkQuestionId: string
	zoltarForkRepBalanceAttoRep: bigint | undefined
	zoltarQuestionLookupError?: string | undefined
	zoltarQuestionLookupId?: string | undefined
	zoltarQuestions: MarketDetails[]
	zoltarQuestionsError?: string | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
}
export function ForkZoltarSection({
	accountAddress,
	currentTimestamp,
	hasLoadedZoltarQuestions,
	isOnActiveAppChain,
	loadingZoltarForkAccess,
	loadingZoltarQuestion = false,
	loadingZoltarQuestions,
	onApproveZoltarForkRep,
	onForkZoltar,
	onLoadZoltarQuestions,
	onRetryZoltarQuestion,
	onZoltarForkQuestionIdChange,
	zoltarForkActiveAction,
	zoltarForkApproval,
	zoltarForkError,
	zoltarForkPending,
	zoltarForkQuestionId,
	zoltarForkRepBalanceAttoRep,
	zoltarQuestionLookupError,
	zoltarQuestionLookupId,
	zoltarQuestions,
	zoltarQuestionsError,
	zoltarUniverse,
	zoltarUniverseState,
}: ForkZoltarSectionProps) {
	const chainCurrentTimestamp = useChainTimestamp()
	const effectiveCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const requiresApproval = rootUniverse?.reputationTokenKind !== 'child'
	const hasForkEconomics = rootUniverse?.forkBurnDivisor !== undefined && rootUniverse.forkBurnDivisor > 1n && rootUniverse.zoltarAddress !== undefined
	const permanentRepBurn = rootUniverse?.forkBurnDivisor === undefined || rootUniverse.forkBurnDivisor <= 1n ? undefined : rootUniverse.forkThresholdAttoRep / rootUniverse.forkBurnDivisor
	const tokenSymbol = rootUniverse?.reputationTokenSymbol ?? commonCopy.rep
	const selectedQuestionId = zoltarForkQuestionId.trim()
	const hasSelectedQuestionId = selectedQuestionId !== ''
	const normalizedSelectedQuestionId = normalizeQuestionId(selectedQuestionId)
	const hasValidSelectedQuestionId = normalizedSelectedQuestionId !== undefined
	const canonicalForkQuestion = rootUniverse?.forkQuestionDetails
	const selectedQuestion =
		normalizedSelectedQuestionId === undefined
			? undefined
			: (zoltarQuestions.find(question => normalizeQuestionId(question.questionId) === normalizedSelectedQuestionId) ?? (canonicalForkQuestion !== undefined && normalizeQuestionId(canonicalForkQuestion.questionId) === normalizedSelectedQuestionId ? canonicalForkQuestion : undefined))
	const isSelectedQuestionLookup = normalizedSelectedQuestionId !== undefined && zoltarQuestionLookupId === normalizedSelectedQuestionId
	let selectedQuestionError: string | undefined
	if (hasSelectedQuestionId && !hasValidSelectedQuestionId) selectedQuestionError = zoltarCopy.forkQuestionIdInvalid
	else if (isSelectedQuestionLookup) selectedQuestionError = zoltarQuestionLookupError
	const selectedQuestionLookupState = resolveLoadableValueState({
		isLoading: hasValidSelectedQuestionId && (loadingZoltarQuestions || loadingZoltarQuestion || (hasSelectedQuestionId && selectedQuestion === undefined && !hasLoadedZoltarQuestions && !isSelectedQuestionLookup)),
		isMissing: hasSelectedQuestionId && (hasLoadedZoltarQuestions || isSelectedQuestionLookup) && selectedQuestion === undefined && selectedQuestionError === undefined,
		value: selectedQuestion,
	})
	const selectedQuestionPresentation = hasSelectedQuestionId && selectedQuestionLookupState !== 'ready' ? getReportPresentation({ kind: 'question', state: selectedQuestionLookupState }) : undefined
	let selectedQuestionDescriptionId: string | undefined
	if (selectedQuestionError !== undefined) selectedQuestionDescriptionId = FORK_QUESTION_ERROR_ID
	else if (selectedQuestionLookupState === 'missing') selectedQuestionDescriptionId = FORK_QUESTION_STATE_ID
	const questionSelection = ((): ForkQuestionSelection => {
		if (!hasSelectedQuestionId) return { kind: 'none' }
		if (selectedQuestionError !== undefined) return { kind: 'unavailable', reason: selectedQuestionError }
		if (selectedQuestion !== undefined) return { kind: 'selected', question: selectedQuestion }
		if (selectedQuestionLookupState === 'missing') return { kind: 'unavailable', reason: selectedQuestionPresentation?.detail ?? zoltarCopy.forkQuestionRequiredReason }
		return { kind: 'loading' }
	})()
	const walletPresentation = getWalletPresentation({ accountAddress, isOnActiveAppChain })
	const blockingReason = (() => {
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (rootUniverse === undefined) return getUniversePresentation(zoltarUniverseState)?.detail
		if (hasForked) return zoltarCopy.alreadyForkedReason
		return undefined
	})()
	const checklist = deriveForkChecklist({
		approvalLoading: zoltarForkApproval.loading,
		approvedAttoRep: zoltarForkApproval.value,
		blockingReason,
		currentTimestamp: effectiveCurrentTimestamp,
		forkThresholdAttoRep: rootUniverse?.forkThresholdAttoRep,
		hasForkEconomics,
		question: questionSelection,
		repBalanceAttoRep: zoltarForkRepBalanceAttoRep,
		requiresApproval,
		tokenSymbol,
	})
	const [questionStep, repStep, approvalStep, reviewStep] = checklist.steps
	const canFork = checklist.canSubmit && !zoltarForkPending
	const approvalGuard = ((): { message: string; ownerStep: ForkChecklistStepKey } | undefined => {
		if (walletPresentation !== undefined) return walletPresentation.detail === undefined ? undefined : { message: walletPresentation.detail, ownerStep: 'review' }
		if (rootUniverse === undefined) return undefined
		if (hasForked) return { message: zoltarCopy.alreadyForkedReason, ownerStep: 'review' }
		if (selectedQuestion === undefined) return { message: zoltarCopy.forkQuestionRequiredReason, ownerStep: 'question' }
		return undefined
	})()

	const [choosingQuestion, setChoosingQuestion] = useState(false)
	const hasQuestionIdProblem = selectedQuestionDescriptionId !== undefined
	const [questionIdFallbackOpen, setQuestionIdFallbackOpen] = useState(hasSelectedQuestionId && questionSelection.kind !== 'selected')
	useEffect(() => {
		if (hasLoadedZoltarQuestions || onLoadZoltarQuestions === undefined) return
		void onLoadZoltarQuestions().catch(() => undefined)
	}, [hasLoadedZoltarQuestions])

	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={zoltarCopy.forkZoltar} />}
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}

	const selectQuestion = (questionId: string) => {
		onZoltarForkQuestionIdChange(questionId)
		setChoosingQuestion(false)
	}
	const questionContent =
		selectedQuestion !== undefined && !choosingQuestion ? (
			<div className='fork-selected-question'>
				<Question question={selectedQuestion} variant='preview' />
				<div className='actions'>
					<button className='secondary' disabled={hasForked || zoltarForkPending} onClick={() => setChoosingQuestion(true)} type='button'>
						{zoltarCopy.changeQuestion}
					</button>
				</div>
			</div>
		) : (
			<>
				<ForkQuestionPicker
					currentTimestamp={effectiveCurrentTimestamp}
					disabled={hasForked || zoltarForkPending}
					loadError={zoltarQuestionsError}
					loading={loadingZoltarQuestions}
					onRetry={onLoadZoltarQuestions === undefined ? undefined : () => void onLoadZoltarQuestions().catch(() => undefined)}
					onSelect={selectQuestion}
					questions={zoltarQuestions}
					selectedQuestionId={normalizedSelectedQuestionId}
				/>
				<details className='fork-question-id-fallback' onToggle={event => setQuestionIdFallbackOpen(event.currentTarget.open)} open={questionIdFallbackOpen || hasQuestionIdProblem}>
					<summary>{zoltarCopy.enterQuestionId}</summary>
					<label className='field'>
						<span>{zoltarCopy.forkQuestionId}</span>
						<FormInput aria-describedby={selectedQuestionDescriptionId} disabled={hasForked || zoltarForkPending} invalid={hasQuestionIdProblem} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder={commonCopy.hexValuePlaceholder} value={zoltarForkQuestionId} />
					</label>
					{selectedQuestionPresentation === undefined ? undefined : <StateHint id={selectedQuestionLookupState === 'missing' ? FORK_QUESTION_STATE_ID : undefined} presentation={selectedQuestionPresentation} />}
					<ErrorNotice id={FORK_QUESTION_ERROR_ID} message={selectedQuestionError} />
					{zoltarQuestionLookupError === undefined || !isSelectedQuestionLookup || onRetryZoltarQuestion === undefined ? undefined : (
						<div className='actions'>
							<button type='button' className='secondary' disabled={loadingZoltarQuestion} onClick={onRetryZoltarQuestion}>
								{loadingZoltarQuestion ? commonCopy.retrying : commonCopy.retry}
							</button>
						</div>
					)}
				</details>
			</>
		)
	const approvalContent = requiresApproval ? (
		<TokenApprovalControl
			actionLabel={zoltarCopy.forkingActionLabel}
			showRequirementNotice={false}
			allowanceError={zoltarForkApproval.error}
			allowanceLoading={zoltarForkApproval.loading}
			approvedAmount={zoltarForkApproval.value}
			disabled={!isOnActiveAppChain}
			guardMessage={approvalGuard?.message}
			guardMessageElementId={approvalGuard === undefined ? undefined : getForkChecklistReasonId(approvalGuard.ownerStep)}
			onApprove={amount => onApproveZoltarForkRep(amount)}
			pending={zoltarForkActiveAction === 'approve'}
			pendingLabel={zoltarCopy.forkRepApprovalPending}
			requiredAmount={rootUniverse?.forkThresholdAttoRep}
			resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThresholdAttoRep.toString() ?? ''}`}
			tokenSymbol={tokenSymbol}
			tokenUnits={18}
		/>
	) : undefined
	const reviewContent = (
		<>
			<DataGrid>
				<MetricField label={commonCopy.forkThresholdAttoRep}>
					<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThresholdAttoRep} suffix={tokenSymbol} />
				</MetricField>
				<MetricField label={zoltarCopy.permanentRepBurn}>
					<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={permanentRepBurn} suffix={tokenSymbol} />
				</MetricField>
			</DataGrid>
			{/* The blocker is already shown as the reason of the step that owns it, so the button references that reason instead of repeating it. */}
			<div className='actions'>
				<TransactionActionButton
					idleLabel={zoltarCopy.forkZoltar}
					pendingLabel={zoltarCopy.forkSubmissionPending}
					onClick={() => {
						if (selectedQuestionId === '') return
						onForkZoltar()
					}}
					pending={zoltarForkActiveAction === 'fork'}
					availability={{ disabled: !canFork, reason: checklist.submitBlockedReason }}
					disabledReasonElementId={checklist.blockingStepKey === undefined ? undefined : getForkChecklistReasonId(checklist.blockingStepKey)}
					showDisabledReason={false}
				/>
			</div>
		</>
	)
	return (
		<>
			<ForkChecklistSteps
				items={[
					{ content: questionContent, step: questionStep, title: zoltarCopy.forkStepQuestion },
					{ step: repStep, title: zoltarCopy.forkStepRep },
					{ content: approvalContent, step: approvalStep, title: zoltarCopy.forkStepApproval },
					{ content: hasForked ? undefined : reviewContent, statusLabel: checklist.canSubmit ? zoltarCopy.forkStepReady : undefined, step: reviewStep, title: zoltarCopy.forkStepReview },
				]}
			/>
			<ErrorNotice message={zoltarForkError} />
		</>
	)
}
