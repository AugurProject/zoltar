import type { Address } from 'viem'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../types/contracts.js'

type ForkZoltarSectionProps = {
	accountAddress: Address | undefined
	isMainnet: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarQuestions: boolean
	loadingZoltarUniverse: boolean
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
	zoltarUniverseMissing: boolean
}

export function ForkZoltarSection({
	accountAddress,
	isMainnet,
	loadingZoltarForkAccess,
	loadingZoltarQuestions,
	loadingZoltarUniverse,
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
	zoltarUniverseMissing,
}: ForkZoltarSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = rootUniverse === undefined && zoltarUniverseMissing && !loadingZoltarUniverse
	const hasForked = rootUniverse?.hasForked === true
	const hasEnoughRep = rootUniverse !== undefined && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= rootUniverse.forkThreshold
	const hasEnoughApproval = rootUniverse !== undefined && zoltarForkAllowance !== undefined && zoltarForkAllowance >= rootUniverse.forkThreshold
	const selectedQuestionId = zoltarForkQuestionId.trim()
	const selectedQuestion = selectedQuestionId === '' ? undefined : zoltarQuestions.find(question => sameCaseInsensitiveText(question.questionId, selectedQuestionId))
	const showMissingQuestionMessage = !loadingZoltarQuestions && selectedQuestionId !== '' && selectedQuestion === undefined
	const canFork = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && !hasForked && !zoltarForkPending && selectedQuestion !== undefined && hasEnoughRep && hasEnoughApproval

	if (universeMissing) {
		return (
			<>
				<EntityCard title='Fork Zoltar' badge={<span className='badge blocked'>Missing</span>}>
					<p className='notice error'>The universe does not exist.</p>
				</EntityCard>
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
						<CurrencyValue loading={loadingZoltarForkAccess} value={zoltarForkAllowance} suffix='REP' />
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
					{showMissingQuestionMessage ? <p className='detail'>No loaded question matches this ID.</p> : undefined}

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
