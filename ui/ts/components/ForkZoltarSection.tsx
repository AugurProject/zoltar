import type { Address } from 'viem'
import { ApprovedAmountValue } from './ApprovedAmountValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { StateHint } from './StateHint.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { resolveLoadableValueState, type LoadableValueState } from '../lib/loadState.js'
import { getReportPresentation, getUniversePresentation } from '../lib/userCopy.js'
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
	zoltarForkAllowance: bigint | undefined
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
	zoltarForkAllowance,
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
	const hasEnoughApproval = rootUniverse !== undefined && zoltarForkAllowance !== undefined && zoltarForkAllowance >= rootUniverse.forkThreshold
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

	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				<EntityCard title='Fork Zoltar'>{presentation === undefined ? undefined : <StateHint presentation={presentation} />}</EntityCard>
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}

	return (
		<>
			<EntityCard title='Fork Zoltar' badge={hasForked ? <span className='badge blocked'>Forked</span> : undefined}>
				<div className='workflow-metric-grid'>
					<MetricField label='Fork Threshold'>
						<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThreshold} suffix='REP' />
					</MetricField>
					<MetricField label='REP Approved To Zoltar'>
						<ApprovedAmountValue loading={loadingZoltarForkAccess} value={zoltarForkAllowance} suffix='REP' />
					</MetricField>
				</div>

				<div className='form-grid'>
					<label className='field'>
						<span>Fork Question ID</span>
						<input value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder='0x...' disabled={hasForked || zoltarForkPending} />
					</label>

					{selectedQuestion === undefined ? undefined : (
						<div className='entity-card-subsection'>
							<div className='entity-card-subsection-header'>
								<h4>Question</h4>
								<span className='badge muted'>{selectedQuestion.marketType}</span>
							</div>
							<Question question={selectedQuestion} />
						</div>
					)}
					{selectedQuestionPresentation === undefined ? undefined : <StateHint presentation={selectedQuestionPresentation} />}

					<div className='actions'>
						{hasForked ? undefined : (
							<button className='secondary' onClick={() => onApproveZoltarForkRep()} disabled={accountAddress === undefined || !isMainnet || rootUniverse === undefined || zoltarForkPending || hasEnoughApproval}>
								{zoltarForkActiveAction === 'approve' ? <LoadingText>Approving REP Threshold...</LoadingText> : hasEnoughApproval ? 'Threshold Approved' : 'Approve REP Threshold'}
							</button>
						)}
						<button
							className='primary'
							onClick={() => {
								if (selectedQuestionId === '') return
								onForkZoltar()
							}}
							disabled={!canFork}
						>
							{zoltarForkActiveAction === 'fork' ? <LoadingText>Forking Zoltar...</LoadingText> : 'Fork Zoltar'}
						</button>
					</div>
				</div>
			</EntityCard>

			<ErrorNotice message={zoltarForkError} />
		</>
	)
}
