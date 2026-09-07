import type { ComponentProps } from 'preact'
import { QuestionCreateSection } from '@zoltar/ui-zoltar/features/questions/components/QuestionCreateSection.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

type QuestionCreateProps = ComponentProps<typeof QuestionCreateSection>

type MarketCreateQuestionSectionProps = Omit<QuestionCreateProps, 'canUseForFork' | 'onCreateQuestion' | 'onQuestionFormChange' | 'onResetQuestion' | 'onUseQuestionForFork' | 'questionCreating' | 'questionError' | 'questionForm' | 'questionResult' | 'renderResultActions'> & {
	marketCreating: QuestionCreateProps['questionCreating']
	formDisabled?: QuestionCreateProps['formDisabled']
	marketError: QuestionCreateProps['questionError']
	marketForm: QuestionCreateProps['questionForm']
	marketResult: QuestionCreateProps['questionResult']
	onCreateMarket: QuestionCreateProps['onCreateQuestion']
	onMarketFormChange: QuestionCreateProps['onQuestionFormChange']
	onResetMarket: QuestionCreateProps['onResetQuestion']
	submitFields?: QuestionCreateProps['submitFields']
	submitActionOverride?: QuestionCreateProps['submitActionOverride']
	onUseQuestionForFork: QuestionCreateProps['onUseQuestionForFork']
	onUseQuestionForPool?: (questionId: string) => void
}

export function MarketCreateQuestionSection({ formDisabled, marketCreating, marketError, marketForm, marketResult, onCreateMarket, onMarketFormChange, onResetMarket, onUseQuestionForPool, submitActionOverride, submitFields, ...props }: MarketCreateQuestionSectionProps) {
	return (
		<QuestionCreateSection
			{...props}
			{...(submitActionOverride === undefined ? {} : { submitActionOverride })}
			{...(submitFields === undefined ? {} : { submitFields })}
			{...(formDisabled === undefined ? {} : { formDisabled })}
			allowedMarketTypes={['binary']}
			{...(onUseQuestionForPool === undefined
				? {}
				: {
						renderResultActions: ({ marketType, questionId, questionTitle }: Parameters<NonNullable<QuestionCreateProps['renderResultActions']>>[0]) => (
							<button aria-label={securityPoolCopy.formatCreatePoolFromQuestionLabel(questionTitle, questionId)} className='secondary' disabled={marketType !== 'binary'} onClick={() => onUseQuestionForPool(questionId)}>
								{securityPoolCopy.createPoolFromQuestion}
							</button>
						),
					})}
			canUseForFork={true}
			onCreateQuestion={onCreateMarket}
			onQuestionFormChange={onMarketFormChange}
			onResetQuestion={onResetMarket}
			questionCreating={marketCreating}
			questionError={marketError}
			questionForm={marketForm}
			questionResult={marketResult}
		/>
	)
}
