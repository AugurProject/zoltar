import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
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
import { UI_STRINGS } from '../lib/uiStrings.js'
import type { MarketFormState } from '../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'

const MARKET_TYPE_OPTIONS: EnumDropdownOption<MarketFormState['marketType']>[] = [
	{ value: 'binary', label: UI_STRINGS.marketCreateQuestionSection.marketTypeOptions.binaryLabel },
	{ value: 'categorical', label: UI_STRINGS.marketCreateQuestionSection.marketTypeOptions.categoricalLabel },
	{ value: 'scalar', label: UI_STRINGS.marketCreateQuestionSection.marketTypeOptions.scalarLabel },
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
	if (marketType === 'binary') return UI_STRINGS.marketCreateQuestionSection.poolEligibilityBinaryQuestionText
	if (marketType === 'categorical') return UI_STRINGS.marketCreateQuestionSection.poolEligibilityCategoricalQuestionText
	return UI_STRINGS.marketCreateQuestionSection.poolEligibilityScalarQuestionText
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
				description: UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.binary.description,
				steps: [UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.binary.stepOne, UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.binary.stepTwo, UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.binary.stepThree],
			}
		case 'categorical':
			return {
				description: UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.categorical.description,
				steps: [UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.categorical.stepOne, UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.categorical.stepTwo, UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.categorical.stepThree],
			}
		case 'scalar':
			return {
				description: UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.scalar.description,
				steps: [UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.scalar.stepOne, UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.scalar.stepTwo, UI_STRINGS.marketCreateQuestionSection.marketTypeGuidance.scalar.stepThree],
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
			return normalizedOutcomes.length > 0 ? appendInvalidOutcomeLabelIfMissing(normalizedOutcomes) : [UI_STRINGS.marketCreateQuestionSection.addAtLeastTwoOutcomesLabel, UI_STRINGS.question.invalidOutcomeLabel]
		}
		case 'scalar':
			return [UI_STRINGS.marketCreateQuestionSection.marketTypeOptions.scalarLabel, UI_STRINGS.question.invalidOutcomeLabel]
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
	const selectedQuestionTitle = selectedQuestionDetails === undefined ? UI_STRINGS.marketCreateQuestionSection.questionFallbackTitle : getQuestionTitle(selectedQuestionDetails)
	const draftOutcomeItems = getDraftOutcomeLabels(marketForm, marketFormValidation.fieldErrors.categoricalOutcomes).map((outcome, outcomeIndex) => ({
		key: `${outcomeIndex}-${outcome}`,
		label: outcome,
		tone: isInvalidOutcomeLabel(outcome) ? ('warning' as const) : ('default' as const),
	}))
	const normalizedDescription = marketForm.description.trim()
	const draftDescription = normalizedDescription === '' ? UI_STRINGS.marketCreateQuestionSection.questionDefaultDescriptionText : marketForm.description
	const draftTitle = marketForm.title.trim() === '' ? UI_STRINGS.marketCreateQuestionSection.questionDefaultTitleText : marketForm.title
	const draftQuestionContextLabel = normalizedDescription === '' ? UI_STRINGS.marketCreateQuestionSection.draftQuestionNeedsContextLabel : UI_STRINGS.marketCreateQuestionSection.draftQuestionContextProvidedLabel
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
								{hasForked ? UI_STRINGS.marketCreateQuestionSection.alreadyForkedLabel : UI_STRINGS.marketCreateQuestionSection.useForForkLabel}
							</button>
							<button className='secondary' onClick={() => onUseQuestionForPool(marketResult.questionId)} disabled={marketResult.marketType !== 'binary'}>
								{UI_STRINGS.marketCreateQuestionSection.createPoolFromQuestionLabel}
							</button>
							<button className='secondary' onClick={onResetMarket}>
								{UI_STRINGS.marketCreateQuestionSection.createAnotherQuestionLabel}
							</button>
						</div>
					}
				>
					<div className='question-preview-body'>
						{(() => {
							if (selectedQuestionDetails === undefined) {
								if (loadingZoltarQuestions)
									return (
										<span className='loading-value' role='status' aria-label={UI_STRINGS.marketCreateQuestionSection.questionDetailsLoadingAriaLabel}>
											<span className='spinner' aria-hidden='true' />
										</span>
									)

								return <p className='detail'>{UI_STRINGS.marketCreateQuestionSection.questionDetailsNotLoadedText}</p>
							}

							return <Question question={selectedQuestionDetails} showTitle={false} />
						})()}
						<MetricField label={UI_STRINGS.marketCreateQuestionSection.creationTransactionHashLabel}>
							<TransactionHashLink hash={marketResult.createQuestionHash} />
						</MetricField>
						<p className='detail'>{getPoolEligibilityMessage(marketResult.marketType)}</p>
					</div>
				</EntityCard>
			)}

			{marketResult === undefined ? (
				<SectionBlock title={UI_STRINGS.marketCreateQuestionSection.createQuestionTitle} variant='plain' description={UI_STRINGS.marketCreateQuestionSection.createQuestionDescription}>
					<div className='workflow-summary-strip workflow-guide'>
						<div className='workflow-guide-intro'>
							<strong>{UI_STRINGS.marketCreateQuestionSection.workflowIntroTitle}</strong>
							<p className='detail'>{marketTypeGuidance.description}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>{UI_STRINGS.marketCreateQuestionSection.workflowStepDefineEventLabel}</span>
							<span>{UI_STRINGS.marketCreateQuestionSection.workflowStepExplainResolutionLabel}</span>
							<span>{UI_STRINGS.marketCreateQuestionSection.workflowStepSetTimingWindowLabel}</span>
						</div>
					</div>

					<SectionBlock headingLevel={4} title={UI_STRINGS.marketCreateQuestionSection.questionTypeGuidanceTitle} variant='embedded'>
						<ul className='requirements-checklist'>
							{marketTypeGuidance.steps.map(step => (
								<li key={step}>{step}</li>
							))}
						</ul>
					</SectionBlock>

					<div className='form-grid'>
						<div className='field'>
							<span>{UI_STRINGS.marketCreateQuestionSection.questionTypeLabel}</span>
							<EnumDropdown ariaLabel={UI_STRINGS.marketCreateQuestionSection.questionTypeAriaLabel} options={MARKET_TYPE_OPTIONS} value={marketForm.marketType} onChange={marketType => onMarketFormChange({ marketType })} />
							<p className='field-help'>{marketTypeGuidance.description}</p>
						</div>

						<div className='field'>
							<label>
								<span>{UI_STRINGS.marketCreateQuestionSection.titleFieldLabel}</span>
								<FormInput
									aria-describedby={getFieldErrorDescribedBy('title', marketFormValidation.fieldErrors.title)}
									invalid={marketFormValidation.fieldErrors.title !== undefined}
									value={marketForm.title}
									onInput={event => onMarketFormChange({ title: event.currentTarget.value })}
									placeholder={UI_STRINGS.marketCreateQuestionSection.titleFieldPlaceholder}
								/>
							</label>
							<p className='field-help'>{UI_STRINGS.marketCreateQuestionSection.titleFieldHelpText}</p>
							{renderFieldError('title', marketFormValidation.fieldErrors.title)}
						</div>

						<div className='field'>
							<label htmlFor='market-create-description'>
								<span>{UI_STRINGS.marketCreateQuestionSection.descriptionFieldLabel}</span>
							</label>
							<textarea id='market-create-description' value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder={UI_STRINGS.marketCreateQuestionSection.descriptionFieldPlaceholder} />
							<p className='field-help'>{UI_STRINGS.marketCreateQuestionSection.descriptionFieldHelpText}</p>
						</div>

						<div className='field-row'>
							<div className='field'>
								<label>
									<span>{UI_STRINGS.marketCreateQuestionSection.startTimeFieldLabel}</span>
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
									<span>{UI_STRINGS.marketCreateQuestionSection.endTimeFieldLabel}</span>
									<FormInput aria-describedby={getFieldErrorDescribedBy('endTime', marketFormValidation.fieldErrors.endTime)} invalid={marketFormValidation.fieldErrors.endTime !== undefined} type='datetime-local' value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
								</label>
								{renderFieldError('endTime', marketFormValidation.fieldErrors.endTime)}
							</div>
						</div>
						<p className='field-help'>{UI_STRINGS.marketCreateQuestionSection.timingFieldHelpText}</p>
						<p className='field-help'>{getPoolEligibilityMessage(marketForm.marketType)}</p>

						{marketForm.marketType === 'categorical' ? (
							<div className='field'>
								<span>{UI_STRINGS.marketCreateQuestionSection.outcomesFieldLabel}</span>
								<div className='categorical-outcomes'>
									{marketForm.categoricalOutcomes.map((outcome, outcomeIndex) => (
										<div className='categorical-outcome-row' key={`categorical-outcome-${outcomeIndex}`}>
											<label className='field'>
												<span className='visually-hidden'>{`${UI_STRINGS.marketCreateQuestionSection.outcomeFieldLabelPrefix} ${outcomeIndex + 1}`}</span>
												<FormInput
													aria-describedby={getFieldErrorDescribedBy('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
													invalid={marketFormValidation.fieldErrors.categoricalOutcomes !== undefined}
													value={outcome}
													onInput={event => updateCategoricalOutcome(outcomeIndex, event.currentTarget.value)}
													placeholder={`${UI_STRINGS.marketCreateQuestionSection.outcomeFieldLabelPrefix} ${outcomeIndex + 1}`}
												/>
											</label>
											<button className='secondary categorical-outcome-remove' type='button' onClick={() => removeCategoricalOutcome(outcomeIndex)}>
												{UI_STRINGS.marketCreateQuestionSection.removeOutcomeLabel}
											</button>
										</div>
									))}
								</div>
								{renderFieldError('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
								<p className='field-help'>{UI_STRINGS.marketCreateQuestionSection.outcomesFieldHelpText}</p>
								<button className='secondary categorical-outcome-add' type='button' onClick={addCategoricalOutcome}>
									{UI_STRINGS.marketCreateQuestionSection.addOutcomeLabel}
								</button>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>{UI_STRINGS.marketCreateQuestionSection.scalarMinFieldLabel}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
											invalid={marketFormValidation.fieldErrors.scalarMin !== undefined}
											value={marketForm.scalarMin}
											onInput={event => onMarketFormChange({ scalarMin: event.currentTarget.value })}
											placeholder={UI_STRINGS.marketCreateQuestionSection.scalarMinFieldPlaceholder}
										/>
									</label>
									{renderFieldError('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
								</div>
								<label className='field'>
									<span>{UI_STRINGS.marketCreateQuestionSection.answerUnitFieldLabel}</span>
									<FormInput value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder={UI_STRINGS.marketCreateQuestionSection.answerUnitFieldPlaceholder} />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>{UI_STRINGS.marketCreateQuestionSection.scalarIncrementFieldLabel}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
											invalid={marketFormValidation.fieldErrors.scalarIncrement !== undefined}
											value={marketForm.scalarIncrement}
											onInput={event => onMarketFormChange({ scalarIncrement: event.currentTarget.value })}
											placeholder={UI_STRINGS.marketCreateQuestionSection.scalarIncrementFieldPlaceholder}
										/>
									</label>
									{renderFieldError('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
								</div>
								<div className='field'>
									<label>
										<span>{UI_STRINGS.marketCreateQuestionSection.scalarMaxFieldLabel}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
											invalid={marketFormValidation.fieldErrors.scalarMax !== undefined}
											value={marketForm.scalarMax}
											onInput={event => onMarketFormChange({ scalarMax: event.currentTarget.value })}
											placeholder={UI_STRINGS.marketCreateQuestionSection.scalarMaxFieldPlaceholder}
										/>
									</label>
									{renderFieldError('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
								</div>
							</div>
						) : undefined}
						{marketForm.marketType === 'scalar' ? <p className='field-help'>{UI_STRINGS.marketCreateQuestionSection.scalarFieldHelpText}</p> : undefined}

						{(() => {
							if (marketForm.marketType === 'scalar') {
								if (scalarCreatePreviewDetails === undefined) return <p className='detail'>{UI_STRINGS.marketCreateQuestionSection.scalarPreviewPromptText}</p>

								return <ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
							}

							return undefined
						})()}

						<SectionBlock headingLevel={4} title={UI_STRINGS.marketCreateQuestionSection.draftPreviewTitle} variant='embedded' description={UI_STRINGS.marketCreateQuestionSection.draftPreviewDescription}>
							<div className='question-draft-preview'>
								<div className='question-draft-preview-header'>
									<div className='question-summary-heading'>
										<strong>{draftTitle}</strong>
										<p className='detail'>{draftDescription}</p>
									</div>
									<div className='question-draft-preview-statuses' role='list' aria-label={UI_STRINGS.marketCreateQuestionSection.draftQuestionStatusAriaLabel}>
										<span className='question-draft-preview-chip' role='listitem'>
											{marketForm.marketType}
										</span>
										<span className={`question-draft-preview-chip ${normalizedDescription === '' ? 'warning' : 'ok'}`} role='listitem'>
											{draftQuestionContextLabel}
										</span>
									</div>
								</div>
								<OutcomeChipRow items={draftOutcomeItems} />
								<div className='question-draft-preview-meta' role='list' aria-label={UI_STRINGS.marketCreateQuestionSection.draftQuestionSummaryAriaLabel}>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{UI_STRINGS.marketCreateQuestionSection.startsLabel}</span>
										<strong>{marketForm.startTime.trim() === '' ? UI_STRINGS.marketCreateQuestionSection.immediatelyAfterCreationLabel : marketForm.startTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{UI_STRINGS.marketCreateQuestionSection.endsLabel}</span>
										<strong>{marketForm.endTime.trim() === '' ? UI_STRINGS.marketCreateQuestionSection.chooseEndTimeLabel : marketForm.endTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{UI_STRINGS.marketCreateQuestionSection.riskCueFieldLabel}</span>
										<strong>{normalizedDescription === '' ? UI_STRINGS.marketCreateQuestionSection.lowTrustUntilContextAddedLabel : UI_STRINGS.marketCreateQuestionSection.contextPresentForReviewLabel}</strong>
									</div>
								</div>
							</div>
						</SectionBlock>

						<div className='actions'>
							<TransactionActionButton
								safetyId='market.createQuestion'
								idleLabel={UI_STRINGS.marketCreateQuestionSection.createQuestionButtonIdleLabel}
								pendingLabel={UI_STRINGS.marketCreateQuestionSection.createQuestionButtonPendingLabel}
								onClick={onCreateMarket}
								pending={marketCreating}
								availability={{
									disabled: accountAddress === undefined || !isMainnet || marketCreating || !marketFormValidation.isValid,
									reason: (() => {
										if (accountAddress === undefined) return UI_STRINGS.marketCreateQuestionSection.walletRequiredReason
										if (!isMainnet) return undefined

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
