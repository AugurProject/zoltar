import { EntityCard } from './EntityCard.js'
import { LoadingText } from './LoadingText.js'
import { Question, getQuestionTitle } from './Question.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import type { MarketDetails } from '../types/contracts.js'
type MarketQuestionsSectionProps = {
	hasForked: boolean
	hasLoadedZoltarQuestions: boolean
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestions: boolean
	onLoadZoltarQuestions: () => Promise<void>
	onOpenForkTab: () => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	zoltarQuestionCount: bigint | undefined
	zoltarQuestions: MarketDetails[]
}
export function MarketQuestionsSection({ hasForked, hasLoadedZoltarQuestions, loadingZoltarQuestionCount, loadingZoltarQuestions, onLoadZoltarQuestions, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestionCount, zoltarQuestions }: MarketQuestionsSectionProps) {
	const noQuestionsAvailable = zoltarQuestionCount === 0n
	return (
		<SectionBlock
			density='compact'
			title='Questions'
			actions={
				<button
					className='secondary'
					onClick={() => {
						void onLoadZoltarQuestions()
					}}
					disabled={loadingZoltarQuestions || noQuestionsAvailable}
				>
					{loadingZoltarQuestions ? (
						<LoadingText>Loading Questions...</LoadingText>
					) : (
						(() => {
							if (noQuestionsAvailable) {
								return 'No Questions'
							}
							if (hasLoadedZoltarQuestions) {
								return 'Refresh Questions'
							}

							return 'Fetch Questions'
						})()
					)}
				</button>
			}
		>
			{zoltarQuestions.length === 0 ? (
				(() => {
					if (loadingZoltarQuestionCount || loadingZoltarQuestions) {
						return (
							<p className='detail'>
								<LoadingText>Loading questions...</LoadingText>
							</p>
						)
					}
					if (noQuestionsAvailable) {
						return (
							<StateHint
								presentation={{
									key: 'empty',
									badgeLabel: 'None yet',
									badgeTone: 'muted',
									detail: 'No questions are available in this universe yet.',
								}}
								title='No questions'
							/>
						)
					}

					return undefined
				})()
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
		</SectionBlock>
	)
}
