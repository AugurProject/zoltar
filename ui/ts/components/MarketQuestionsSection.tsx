import { EntityCard } from './EntityCard.js'
import { LoadingText } from './LoadingText.js'
import { Question, getQuestionTitle } from './Question.js'
import type { MarketDetails } from '../types/contracts.js'

type MarketQuestionsSectionProps = {
	hasForked: boolean
	hasLoadedZoltarQuestions: boolean
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestions: boolean
	onLoadZoltarQuestions: () => void
	onOpenForkTab: () => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	zoltarQuestionCount: bigint | undefined
	zoltarQuestions: MarketDetails[]
}

export function MarketQuestionsSection({ hasForked, hasLoadedZoltarQuestions, loadingZoltarQuestionCount, loadingZoltarQuestions, onLoadZoltarQuestions, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestionCount, zoltarQuestions }: MarketQuestionsSectionProps) {
	const questionCountBadge = zoltarQuestionCount === undefined ? undefined : `${zoltarQuestionCount.toString()} questions`
	const noQuestionsAvailable = zoltarQuestionCount === 0n

	return (
		<EntityCard
			title='Questions'
			badge={questionCountBadge === undefined ? undefined : <span className='badge muted'>{questionCountBadge}</span>}
			actions={
				<button className='secondary' onClick={onLoadZoltarQuestions} disabled={loadingZoltarQuestions || noQuestionsAvailable}>
					{loadingZoltarQuestions ? <LoadingText>Loading Questions...</LoadingText> : noQuestionsAvailable ? 'No Questions' : hasLoadedZoltarQuestions ? 'Refresh Questions' : 'Fetch Questions'}
				</button>
			}
		>
			{zoltarQuestions.length === 0 ? (
				loadingZoltarQuestionCount || loadingZoltarQuestions ? undefined : noQuestionsAvailable ? (
					<p className='detail'>No questions</p>
				) : undefined
			) : (
				<div className='entity-card-list'>
					{zoltarQuestions.map(question => (
						<EntityCard
							key={question.questionId}
							title={getQuestionTitle(question)}
							actions={
								<div className='actions'>
									<button
										className='secondary'
										disabled={hasForked}
										onClick={() => {
											if (hasForked) return
											onUseQuestionForFork(question.questionId)
											onOpenForkTab()
										}}
									>
										{hasForked ? 'Already Forked' : 'Use For Fork'}
									</button>
									<button className='secondary' onClick={() => onUseQuestionForPool(question.questionId)} disabled={question.marketType !== 'binary'}>
										Use For Create Pool
									</button>
								</div>
							}
						>
							<Question question={question} showTitle={false} />
						</EntityCard>
					))}
				</div>
			)}
		</EntityCard>
	)
}
