import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address } from 'viem'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { Question, getQuestionTitle } from './Question.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { MetricField } from './MetricField.js'
import { validateMarketForm } from '../lib/marketCreation.js'
import { clampScalarTickIndex, parseScalarFormInputs } from '../lib/scalarOutcome.js'
import type { MarketFormState } from '../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'

const MARKET_TYPE_OPTIONS: EnumDropdownOption<MarketFormState['marketType']>[] = [
	{ value: 'binary', label: 'Binary' },
	{ value: 'categorical', label: 'Categorical' },
	{ value: 'scalar', label: 'Scalar' },
]

type MarketCreateQuestionSectionProps = {
	accountAddress: Address | undefined
	hasForked: boolean
	isMainnet: boolean
	marketCreating: boolean
	marketError: string | undefined
	marketForm: MarketFormState
	marketResult: MarketCreationResult | undefined
	loadingZoltarQuestions: boolean
	onCreateMarket: () => void
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onOpenForkTab: () => void
	onResetMarket: () => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	zoltarQuestions: MarketDetails[]
}

function getScalarCreatePreviewDetails(marketForm: MarketFormState): ScalarCreatePreviewDetails | undefined {
	if (marketForm.marketType !== 'scalar') return undefined
	try {
		return {
			answerUnit: marketForm.answerUnit.trim(),
			...parseScalarFormInputs(marketForm),
		}
	} catch {
		return undefined
	}
}

export function MarketCreateQuestionSection({
	accountAddress,
	hasForked,
	isMainnet,
	loadingZoltarQuestions,
	marketCreating,
	marketError,
	marketForm,
	marketResult,
	onCreateMarket,
	onMarketFormChange,
	onOpenForkTab,
	onResetMarket,
	onUseQuestionForFork,
	onUseQuestionForPool,
	zoltarQuestions,
}: MarketCreateQuestionSectionProps) {
	const [scalarCreatePreviewTick, setScalarCreatePreviewTick] = useState('0')
	const selectedQuestionDetails = useMemo(() => (marketResult === undefined ? undefined : zoltarQuestions.find(question => question.questionId === marketResult.questionId)), [marketResult?.questionId, zoltarQuestions])
	const scalarCreatePreviewDetails = getScalarCreatePreviewDetails(marketForm)
	const marketFormValidation = validateMarketForm(marketForm)
	const selectedQuestionTitle = selectedQuestionDetails === undefined ? 'Question' : getQuestionTitle(selectedQuestionDetails)

	useEffect(() => {
		if (scalarCreatePreviewDetails === undefined) return
		const clampedTick = clampScalarTickIndex(BigInt(scalarCreatePreviewTick), scalarCreatePreviewDetails.numTicks).toString()
		if (clampedTick === scalarCreatePreviewTick) return
		setScalarCreatePreviewTick(clampedTick)
	}, [scalarCreatePreviewDetails?.numTicks, scalarCreatePreviewTick])

	const updateCategoricalOutcome = (outcomeIndex: number, value: string) => {
		onMarketFormChange({
			categoricalOutcomes: marketForm.categoricalOutcomes.map((outcome, index) => (index === outcomeIndex ? value : outcome)),
		})
	}

	const addCategoricalOutcome = () => {
		onMarketFormChange({
			categoricalOutcomes: [...marketForm.categoricalOutcomes, ''],
		})
	}

	const removeCategoricalOutcome = (outcomeIndex: number) => {
		onMarketFormChange({
			categoricalOutcomes: marketForm.categoricalOutcomes.filter((_, index) => index !== outcomeIndex),
		})
	}

	return (
		<>
			{marketResult === undefined ? undefined : (
				<EntityCard
					title={selectedQuestionTitle}
					actions={
						<div className='actions'>
							<button
								className='secondary'
								disabled={hasForked}
								onClick={() => {
									if (hasForked) return
									onUseQuestionForFork(marketResult.questionId)
									onOpenForkTab()
								}}
							>
								{hasForked ? 'Already Forked' : 'Use For Fork'}
							</button>
							<button className='secondary' onClick={() => onUseQuestionForPool(marketResult.questionId)} disabled={marketResult.marketType !== 'binary'}>
								Use For Create Pool
							</button>
							<button className='secondary' onClick={onResetMarket}>
								Create Another Question
							</button>
						</div>
					}
				>
					<div className='question-preview-body'>
						{selectedQuestionDetails === undefined ? (
							loadingZoltarQuestions ? (
								<span className='loading-value' role='status' aria-label='Loading question details'>
									<span className='spinner' aria-hidden='true' />
								</span>
							) : (
								<p className='detail'>Question details are not loaded yet.</p>
							)
						) : (
							<Question question={selectedQuestionDetails} showTitle={false} />
						)}
						<MetricField label='Creation transaction hash'>
							<TransactionHashLink hash={marketResult.createQuestionHash} />
						</MetricField>
					</div>
				</EntityCard>
			)}

			{marketResult === undefined ? (
				<EntityCard title='Create Question' badge={<span className='badge muted'>{marketForm.marketType}</span>}>
					<div className='form-grid'>
						<label className='field'>
							<span>Question Type</span>
							<EnumDropdown options={MARKET_TYPE_OPTIONS} value={marketForm.marketType} onChange={marketType => onMarketFormChange({ marketType })} />
						</label>

						<label className='field'>
							<span>Title</span>
							<FormInput invalid={marketFormValidation.fieldErrors.title !== undefined} value={marketForm.title} onInput={event => onMarketFormChange({ title: event.currentTarget.value })} placeholder='Will event X happen?' />
						</label>

						<label className='field'>
							<span>Description</span>
							<textarea value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder='Optional question context' />
						</label>

						<div className='field-row'>
							<label className='field'>
								<span>Start Time</span>
								<FormInput invalid={marketFormValidation.fieldErrors.startTime !== undefined} type='datetime-local' value={marketForm.startTime} onInput={event => onMarketFormChange({ startTime: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>End Time</span>
								<FormInput invalid={marketFormValidation.fieldErrors.endTime !== undefined} type='datetime-local' value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
							</label>
						</div>

						{marketForm.marketType === 'categorical' ? (
							<div className='field'>
								<span>Outcomes</span>
								<div className='categorical-outcomes'>
									{marketForm.categoricalOutcomes.map((outcome, outcomeIndex) => (
										<div className='categorical-outcome-row' key={`categorical-outcome-${outcomeIndex}`}>
											<FormInput invalid={marketFormValidation.fieldErrors.categoricalOutcomes !== undefined} value={outcome} onInput={event => updateCategoricalOutcome(outcomeIndex, event.currentTarget.value)} placeholder={`Outcome ${outcomeIndex + 1}`} />
											<button className='secondary categorical-outcome-remove' type='button' onClick={() => removeCategoricalOutcome(outcomeIndex)}>
												Remove
											</button>
										</div>
									))}
								</div>
								<button className='secondary categorical-outcome-add' type='button' onClick={addCategoricalOutcome}>
									Add Outcome
								</button>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<label className='field'>
									<span>Scalar Min</span>
									<FormInput invalid={marketFormValidation.fieldErrors.scalarMin !== undefined} value={marketForm.scalarMin} onInput={event => onMarketFormChange({ scalarMin: event.currentTarget.value })} placeholder='1' />
								</label>
								<label className='field'>
									<span>Answer Unit</span>
									<FormInput value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder='USD' />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<label className='field'>
									<span>Scalar Increment</span>
									<FormInput invalid={marketFormValidation.fieldErrors.scalarIncrement !== undefined} value={marketForm.scalarIncrement} onInput={event => onMarketFormChange({ scalarIncrement: event.currentTarget.value })} placeholder='0.1' />
								</label>
								<label className='field'>
									<span>Scalar Max</span>
									<FormInput invalid={marketFormValidation.fieldErrors.scalarMax !== undefined} value={marketForm.scalarMax} onInput={event => onMarketFormChange({ scalarMax: event.currentTarget.value })} placeholder='10' />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							scalarCreatePreviewDetails === undefined ? (
								<p className='detail'>Enter scalar min, max, and increment to preview the tick slider.</p>
							) : (
								<ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
							)
						) : undefined}

						<div className='actions'>
							<button className='primary' onClick={onCreateMarket} disabled={accountAddress === undefined || !isMainnet || marketCreating || !marketFormValidation.isValid}>
								{marketCreating ? <LoadingText>Creating Question...</LoadingText> : 'Create Question'}
							</button>
							{marketFormValidation.notice === undefined ? undefined : <p className='form-validation-inline'>{marketFormValidation.notice}</p>}
						</div>
					</div>
				</EntityCard>
			) : undefined}

			<ErrorNotice message={marketError} />
		</>
	)
}
