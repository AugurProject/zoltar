import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import type { MarketFormState } from '../../../types/app.js'

type MarketType = MarketFormState['marketType']
const marketTypes: readonly MarketType[] = ['binary', 'categorical', 'scalar']

type QuestionTypeOptionsProps = {
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

/** `hidden` keeps the card text visual only when a radio already names and describes it by ID, so browse mode does not read it twice. */
function QuestionTypeCopy({ marketType }: { marketType: MarketType }) {
	const { description, example } = getQuestionTypeCopy(marketType)
	const optionId = `market-create-type-${marketType}`
	return (
		<span aria-hidden='true' className='question-type-option-copy'>
			<strong id={`${optionId}-label`}>{getMarketTypeLabel(marketType)}</strong>
			<span id={`${optionId}-description`}>{description}</span>
			<em id={`${optionId}-example`}>{example}</em>
		</span>
	)
}

/** Native radio group: arrow keys move the selection, and each card names its type, then describes it with an example. */
export function QuestionTypeOptions({ disabled, onChange, value }: QuestionTypeOptionsProps) {
	return (
		<fieldset className='question-type-options' disabled={disabled}>
			<legend>{commonCopy.questionType}</legend>
			<div className='question-type-option-list'>
				{marketTypes.map(marketType => {
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
