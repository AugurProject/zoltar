import * as marketCopy from '../../../copy/market.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import type { MarketFormState } from '../../../types/app.js'

type MarketType = MarketFormState['marketType']

type QuestionTypeOptionsProps = {
	allowedMarketTypes: readonly MarketType[]
	disabled: boolean
	onChange: (marketType: MarketType) => void
	value: MarketType
}

function getQuestionTypeCopy(marketType: MarketType) {
	switch (marketType) {
		case 'binary':
			return { description: marketCopy.binaryQuestionDescription, example: marketCopy.binaryQuestionExample }
		case 'categorical':
			return { description: marketCopy.categoricalQuestionDescription, example: marketCopy.categoricalQuestionExample }
		case 'scalar':
			return { description: marketCopy.scalarQuestionDescription, example: marketCopy.scalarQuestionExample }
		default:
			return assertNever(marketType)
	}
}

function QuestionTypeCopy({ marketType }: { marketType: MarketType }) {
	const { description, example } = getQuestionTypeCopy(marketType)
	const optionId = `market-create-type-${marketType}`
	return (
		<span className='question-type-option-copy'>
			<strong id={`${optionId}-label`}>{getMarketTypeLabel(marketType)}</strong>
			<span id={`${optionId}-description`}>{description}</span>
			<em id={`${optionId}-example`}>{example}</em>
		</span>
	)
}

/** Native radio group: arrow keys move the selection, and each card names its type, then describes it with an example. */
export function QuestionTypeOptions({ allowedMarketTypes, disabled, onChange, value }: QuestionTypeOptionsProps) {
	const [onlyType] = allowedMarketTypes
	// A single permitted type is a fixed property of this form, so it is stated rather than offered as a choice.
	if (onlyType !== undefined && allowedMarketTypes.length === 1)
		return (
			<div className='question-type-options'>
				<span className='question-type-options-label'>{marketCopy.questionType}</span>
				<div className='question-type-fixed'>
					<QuestionTypeCopy marketType={onlyType} />
				</div>
			</div>
		)
	return (
		<fieldset className='question-type-options' disabled={disabled}>
			<legend>{marketCopy.questionType}</legend>
			<div className='question-type-option-list'>
				{allowedMarketTypes.map(marketType => {
					const optionId = `market-create-type-${marketType}`
					return (
						<label className='question-type-option' key={marketType}>
							<input aria-describedby={`${optionId}-description ${optionId}-example`} aria-labelledby={`${optionId}-label`} checked={value === marketType} disabled={disabled} name='market-create-type' onChange={() => onChange(marketType)} type='radio' value={marketType} />
							<QuestionTypeCopy marketType={marketType} />
						</label>
					)
				})}
			</div>
		</fieldset>
	)
}
