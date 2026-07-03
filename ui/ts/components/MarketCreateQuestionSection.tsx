import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address } from 'viem'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { OutcomeChipRow } from './OutcomeChipRow.js'
import { Question, getQuestionTitle } from './Question.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { MetricField } from './MetricField.js'
import { assertNever } from '../lib/assert.js'
import { getMarketCreationOutcomeLabels, validateMarketForm } from '../lib/marketCreation.js'
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '../lib/outcomeLabels.js'
import { clampScalarTickIndex, parseScalarFormInputs } from '../lib/scalarOutcome.js'
import type { MarketFormState } from '../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'

const MARKET_TYPE_OPTIONS: EnumDropdownOption<MarketFormState['marketType']>[] = [
	{ value: 'binary', label: 'Binary' },
	{ value: 'categorical', label: 'Categorical' },
	{ value: 'scalar', label: 'Scalar' },
]
type MarketFormFieldName = keyof ReturnType<typeof validateMarketForm>['fieldErrors']
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

function getScalarCreatePreviewDetails(marketForm: MarketFormState, scalarInputsValid: boolean): ScalarCreatePreviewDetails | undefined {
	if (marketForm.marketType !== 'scalar') return undefined
	if (!scalarInputsValid) return undefined
	return {
		answerUnit: marketForm.answerUnit.trim(),
		...parseScalarFormInputs(marketForm),
	}
}

function getPoolEligibilityMessage(marketType: MarketFormState['marketType']) {
	if (marketType === 'binary') return 'Placeholder origin security pools support this exact Yes / No question shape.'
	if (marketType === 'categorical') return 'This question is valid in Zoltar, but Placeholder origin security pools currently require an exact binary Yes / No question.'
	return 'This scalar question is valid in Zoltar, but Placeholder origin security pools currently require an exact binary Yes / No question.'
}

function getFieldErrorId(field: MarketFormFieldName) {
	return `market-create-${field}-error`
}

function getFieldErrorDescribedBy(field: MarketFormFieldName, message: string | undefined) {
	return message === undefined ? undefined : getFieldErrorId(field)
}

function renderFieldError(field: MarketFormFieldName, message: string | undefined) {
	if (message === undefined) return undefined
	return (
		<p className='field-error' id={getFieldErrorId(field)}>
			{message}
		</p>
	)
}

function getMarketTypeGuidance(marketType: MarketFormState['marketType']) {
	switch (marketType) {
		case 'binary':
			return {
				description: 'Ask a yes-or-no question that can be resolved from one public source of truth.',
				steps: ['Write the title so it can be answered with Yes, No, or Invalid.', 'Name the event window clearly in the title or description.', 'Use the description for the exact resolution source and edge cases.'],
			}
		case 'categorical':
			return {
				description: 'List the mutually exclusive outcomes that could win this question.',
				steps: ['Keep outcomes short and clearly distinct from each other.', 'Use the description to explain how ties, cancellations, or exceptions resolve.', 'Only include outcomes that a resolver can verify from a public source.'],
			}
		case 'scalar':
			return {
				description: 'Ask for a measurable number with a unit, range, and increment that users can understand.',
				steps: ['Pick a range that covers realistic answers without being overly broad.', 'Set the answer unit so users know what the number represents.', 'Use the description to explain rounding, source data, and invalid conditions.'],
			}
		default:
			return assertNever(marketType)
	}
}

function getDraftOutcomeLabels(marketForm: MarketFormState, categoricalOutcomesError: string | undefined) {
	switch (marketForm.marketType) {
		case 'binary':
			return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(marketForm))
		case 'categorical': {
			if (categoricalOutcomesError === undefined) {
				return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(marketForm))
			}

			const normalizedOutcomes = marketForm.categoricalOutcomes.map(outcome => outcome.trim()).filter(outcome => outcome !== '')
			return normalizedOutcomes.length > 0 ? appendInvalidOutcomeLabelIfMissing(normalizedOutcomes) : ['Add at least 2 outcomes', 'Invalid']
		}
		case 'scalar':
			return ['Scalar', 'Invalid']
		default:
			return assertNever(marketForm.marketType)
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
	const marketFormValidation = validateMarketForm(marketForm)
	const marketTypeGuidance = getMarketTypeGuidance(marketForm.marketType)
	const scalarInputsValid = marketFormValidation.fieldErrors.scalarIncrement === undefined && marketFormValidation.fieldErrors.scalarMax === undefined && marketFormValidation.fieldErrors.scalarMin === undefined
	const scalarCreatePreviewDetails = getScalarCreatePreviewDetails(marketForm, scalarInputsValid)
	const selectedQuestionTitle = selectedQuestionDetails === undefined ? 'Question' : getQuestionTitle(selectedQuestionDetails)
	const draftOutcomeItems = getDraftOutcomeLabels(marketForm, marketFormValidation.fieldErrors.categoricalOutcomes).map((outcome, outcomeIndex) => ({
		key: `${outcomeIndex}-${outcome}`,
		label: outcome,
		tone: isInvalidOutcomeLabel(outcome) ? ('warning' as const) : ('default' as const),
	}))
	const normalizedDescription = marketForm.description.trim()
	const draftDescription = normalizedDescription === '' ? 'Add resolution notes, evidence sources, and edge-case handling so other users know how this question will settle.' : marketForm.description
	const draftTitle = marketForm.title.trim() === '' ? 'Add a clear question title' : marketForm.title
	const draftQuestionContextLabel = normalizedDescription === '' ? 'Needs context' : 'Context provided'
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
								Create Pool From Question
							</button>
							<button className='secondary' onClick={onResetMarket}>
								Create Another Question
							</button>
						</div>
					}
				>
					<div className='question-preview-body'>
						{(() => {
							if (selectedQuestionDetails === undefined) {
								if (loadingZoltarQuestions)
									return (
										<span className='loading-value' role='status' aria-label='Loading question details'>
											<span className='spinner' aria-hidden='true' />
										</span>
									)

								return <p className='detail'>Question details are not loaded yet.</p>
							}

							return <Question question={selectedQuestionDetails} showTitle={false} />
						})()}
						<MetricField label='Creation transaction hash'>
							<TransactionHashLink hash={marketResult.createQuestionHash} />
						</MetricField>
						<p className='detail'>{getPoolEligibilityMessage(marketResult.marketType)}</p>
					</div>
				</EntityCard>
			)}

			{marketResult === undefined ? (
				<SectionBlock title='Create Question' description='Define the market type, timing, and outcomes for a new Zoltar question.'>
					<div className='workflow-summary-strip workflow-guide'>
						<div className='workflow-guide-intro'>
							<strong>Write this the way a resolver will read it.</strong>
							<p className='detail'>{marketTypeGuidance.description}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>1. Define the event clearly</span>
							<span>2. Explain how it resolves</span>
							<span>3. Set the timing window</span>
						</div>
					</div>

					<SectionBlock headingLevel={4} title='Question Type Guidance' variant='embedded'>
						<ul className='requirements-checklist'>
							{marketTypeGuidance.steps.map(step => (
								<li key={step}>{step}</li>
							))}
						</ul>
					</SectionBlock>

					<div className='form-grid'>
						<div className='field'>
							<span>Question Type</span>
							<EnumDropdown ariaLabel='Question Type' options={MARKET_TYPE_OPTIONS} value={marketForm.marketType} onChange={marketType => onMarketFormChange({ marketType })} />
							<p className='field-help'>{marketTypeGuidance.description}</p>
						</div>

						<div className='field'>
							<label>
								<span>Title</span>
								<FormInput
									aria-describedby={getFieldErrorDescribedBy('title', marketFormValidation.fieldErrors.title)}
									invalid={marketFormValidation.fieldErrors.title !== undefined}
									value={marketForm.title}
									onInput={event => onMarketFormChange({ title: event.currentTarget.value })}
									placeholder='Will event X happen?'
								/>
							</label>
							<p className='field-help'>Keep the title self-contained so users can understand the exact question before opening details.</p>
							{renderFieldError('title', marketFormValidation.fieldErrors.title)}
						</div>

						<div className='field'>
							<label htmlFor='market-create-description'>
								<span>Description</span>
							</label>
							<textarea id='market-create-description' value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder='Optional question context' />
							<p className='field-help'>Include the resolution source, any edge cases, and what should make the question resolve as invalid.</p>
						</div>

						<div className='field-row'>
							<div className='field'>
								<label>
									<span>Start Time</span>
									<FormInput
										aria-describedby={getFieldErrorDescribedBy('startTime', marketFormValidation.fieldErrors.startTime)}
										invalid={marketFormValidation.fieldErrors.startTime !== undefined}
										type='datetime-local'
										value={marketForm.startTime}
										onInput={event => onMarketFormChange({ startTime: event.currentTarget.value })}
									/>
								</label>
								{renderFieldError('startTime', marketFormValidation.fieldErrors.startTime)}
							</div>
							<div className='field'>
								<label>
									<span>End Time</span>
									<FormInput aria-describedby={getFieldErrorDescribedBy('endTime', marketFormValidation.fieldErrors.endTime)} invalid={marketFormValidation.fieldErrors.endTime !== undefined} type='datetime-local' value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
								</label>
								{renderFieldError('endTime', marketFormValidation.fieldErrors.endTime)}
							</div>
						</div>
						<p className='field-help'>Times use your browser timezone. Leave start time blank to allow activity immediately after creation. Reporting and trading settlement depend on the end time.</p>
						<p className='field-help'>{getPoolEligibilityMessage(marketForm.marketType)}</p>

						{marketForm.marketType === 'categorical' ? (
							<div className='field'>
								<span>Outcomes</span>
								<div className='categorical-outcomes'>
									{marketForm.categoricalOutcomes.map((outcome, outcomeIndex) => (
										<div className='categorical-outcome-row' key={`categorical-outcome-${outcomeIndex}`}>
											<label className='field'>
												<span className='visually-hidden'>{`Outcome ${outcomeIndex + 1}`}</span>
												<FormInput
													aria-describedby={getFieldErrorDescribedBy('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
													invalid={marketFormValidation.fieldErrors.categoricalOutcomes !== undefined}
													value={outcome}
													onInput={event => updateCategoricalOutcome(outcomeIndex, event.currentTarget.value)}
													placeholder={`Outcome ${outcomeIndex + 1}`}
												/>
											</label>
											<button className='secondary categorical-outcome-remove' type='button' onClick={() => removeCategoricalOutcome(outcomeIndex)}>
												Remove
											</button>
										</div>
									))}
								</div>
								{renderFieldError('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
								<p className='field-help'>Use concise, mutually exclusive labels. Users should be able to tell at a glance which outcome would win.</p>
								<button className='secondary categorical-outcome-add' type='button' onClick={addCategoricalOutcome}>
									Add Outcome
								</button>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>Scalar Min</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
											invalid={marketFormValidation.fieldErrors.scalarMin !== undefined}
											value={marketForm.scalarMin}
											onInput={event => onMarketFormChange({ scalarMin: event.currentTarget.value })}
											placeholder='1'
										/>
									</label>
									{renderFieldError('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
								</div>
								<label className='field'>
									<span>Answer Unit</span>
									<FormInput value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder='USD' />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>Scalar Increment</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
											invalid={marketFormValidation.fieldErrors.scalarIncrement !== undefined}
											value={marketForm.scalarIncrement}
											onInput={event => onMarketFormChange({ scalarIncrement: event.currentTarget.value })}
											placeholder='0.1'
										/>
									</label>
									{renderFieldError('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
								</div>
								<div className='field'>
									<label>
										<span>Scalar Max</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
											invalid={marketFormValidation.fieldErrors.scalarMax !== undefined}
											value={marketForm.scalarMax}
											onInput={event => onMarketFormChange({ scalarMax: event.currentTarget.value })}
											placeholder='10'
										/>
									</label>
									{renderFieldError('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
								</div>
							</div>
						) : undefined}
						{marketForm.marketType === 'scalar' ? <p className='field-help'>Scalar questions settle to a numeric result inside the range above. Use a unit that matches the public source you expect to cite.</p> : undefined}

						{(() => {
							if (marketForm.marketType === 'scalar') {
								if (scalarCreatePreviewDetails === undefined) return <p className='detail'>Enter scalar min, max, and increment to preview the tick slider.</p>

								return <ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
							}

							return undefined
						})()}

						<SectionBlock headingLevel={4} title='Draft Preview' variant='embedded' description='This preview shows the level of clarity traders and reporters will see before trusting the question.'>
							<div className='question-draft-preview'>
								<div className='question-draft-preview-header'>
									<div className='question-summary-heading'>
										<strong>{draftTitle}</strong>
										<p className='detail'>{draftDescription}</p>
									</div>
									<div className='question-draft-preview-statuses' role='list' aria-label='Draft question status'>
										<span className='question-draft-preview-chip' role='listitem'>
											{marketForm.marketType}
										</span>
										<span className={`question-draft-preview-chip ${normalizedDescription === '' ? 'warning' : 'ok'}`} role='listitem'>
											{draftQuestionContextLabel}
										</span>
									</div>
								</div>
								<OutcomeChipRow items={draftOutcomeItems} />
								<div className='question-draft-preview-meta' role='list' aria-label='Draft question summary'>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>Starts</span>
										<strong>{marketForm.startTime.trim() === '' ? 'Immediately after creation' : marketForm.startTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>Ends</span>
										<strong>{marketForm.endTime.trim() === '' ? 'Choose an end time' : marketForm.endTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>Risk cue</span>
										<strong>{normalizedDescription === '' ? 'Low trust until context is added' : 'Context is present for review'}</strong>
									</div>
								</div>
							</div>
						</SectionBlock>

						<div className='actions'>
							<TransactionActionButton
								safetyId='market.createQuestion'
								idleLabel='Create Question'
								pendingLabel='Creating Question...'
								onClick={onCreateMarket}
								pending={marketCreating}
								availability={{
									disabled: accountAddress === undefined || !isMainnet || marketCreating || !marketFormValidation.isValid,
									reason: (() => {
										if (accountAddress === undefined) return 'Connect a wallet before creating a question.'
										if (!isMainnet) return 'Switch to Ethereum mainnet before creating a question.'

										return marketFormValidation.notice
									})(),
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			) : undefined}

			<ErrorNotice message={marketError} />
		</>
	)
}
