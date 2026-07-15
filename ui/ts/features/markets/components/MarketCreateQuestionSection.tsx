import * as commonCopy from '../../../copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { EnumDropdown, type EnumDropdownOption } from '../../../components/EnumDropdown.js'
import { EntityCard } from '../../../components/EntityCard.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { OutcomeChipRow } from './OutcomeChipRow.js'
import { Question, getQuestionTitle } from './Question.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionHashLink } from '../../../components/TransactionHashLink.js'
import { MetricField } from '../../../components/MetricField.js'
import { assertNever } from '../../../lib/assert.js'
import { getMarketCreationOutcomeLabels, validateMarketForm } from '../lib/marketCreation.js'
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '../lib/outcomeLabels.js'
import { clampScalarTickIndex, parseScalarFormInputs } from '../lib/scalarOutcome.js'
import type { MarketFormState } from '../../../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../../../types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'

const MARKET_TYPE_OPTIONS: EnumDropdownOption<MarketFormState['marketType']>[] = [
	{ value: 'binary', label: marketCopy.binary },
	{ value: 'categorical', label: marketCopy.categorical },
	{ value: 'scalar', label: marketCopy.scalar },
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
	if (marketType === 'binary') return marketCopy.binaryPoolCompatibilityHint
	if (marketType === 'categorical') return marketCopy.categoricalPoolCompatibilityDetail
	return marketCopy.scalarPoolCompatibilityDetail
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
				description: marketCopy.binaryQuestionDescription,
				steps: [marketCopy.binaryTitleGuidance, marketCopy.binaryEventWindowGuidance, marketCopy.binaryResolutionGuidance],
			}
		case 'categorical':
			return {
				description: marketCopy.categoricalOutcomesGuidance,
				steps: [marketCopy.categoricalOutcomeClarityGuidance, marketCopy.categoricalExceptionsGuidance, marketCopy.categoricalVerifiabilityGuidance],
			}
		case 'scalar':
			return {
				description: marketCopy.scalarQuestionDescription,
				steps: [marketCopy.scalarRangeGuidance, marketCopy.scalarUnitGuidance, marketCopy.scalarResolutionGuidance],
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
			return normalizedOutcomes.length > 0 ? appendInvalidOutcomeLabelIfMissing(normalizedOutcomes) : [marketCopy.minimumOutcomeCountReason, commonCopy.invalid]
		}
		case 'scalar':
			return [marketCopy.scalar, commonCopy.invalid]
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
	const selectedQuestionTitle = selectedQuestionDetails === undefined ? commonCopy.question : getQuestionTitle(selectedQuestionDetails)
	const draftOutcomeItems = getDraftOutcomeLabels(marketForm, marketFormValidation.fieldErrors.categoricalOutcomes).map((outcome, outcomeIndex) => ({
		key: `${outcomeIndex}-${outcome}`,
		label: outcome,
		tone: isInvalidOutcomeLabel(outcome) ? ('warning' as const) : ('default' as const),
	}))
	const normalizedDescription = marketForm.description.trim()
	const draftDescription = normalizedDescription === '' ? marketCopy.missingResolutionNotesHelpText : marketForm.description
	const draftTitle = marketForm.title.trim() === '' ? marketCopy.questionTitleRequired : marketForm.title
	const draftQuestionContextLabel = normalizedDescription === '' ? marketCopy.needsContext : marketCopy.contextProvided
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
								{hasForked ? marketCopy.alreadyForked : marketCopy.useForFork}
							</button>
							<button className='secondary' onClick={() => onUseQuestionForPool(marketResult.questionId)} disabled={marketResult.marketType !== 'binary'}>
								{marketCopy.createPoolFromQuestion}
							</button>
							<button className='secondary' onClick={onResetMarket}>
								{marketCopy.createAnotherQuestion}
							</button>
						</div>
					}
				>
					<div className='question-preview-body'>
						{(() => {
							if (selectedQuestionDetails === undefined) {
								if (loadingZoltarQuestions)
									return (
										<span className='loading-value' role='status' aria-label={marketCopy.loadingQuestionDetails}>
											<span className='spinner' aria-hidden='true' />
										</span>
									)

								return <p className='detail'>{marketCopy.questionDetailsUnavailable}</p>
							}

							return <Question question={selectedQuestionDetails} showTitle={false} />
						})()}
						<MetricField label={marketCopy.creationTransactionHash}>
							<TransactionHashLink hash={marketResult.createQuestionHash} />
						</MetricField>
						<p className='detail'>{getPoolEligibilityMessage(marketResult.marketType)}</p>
					</div>
				</EntityCard>
			)}

			{marketResult === undefined ? (
				<SectionBlock title={commonCopy.createQuestion} variant='plain' description={marketCopy.questionCreationDescription}>
					<div className='workflow-summary-strip workflow-guide'>
						<div className='workflow-guide-intro'>
							<strong>{marketCopy.resolverQuestionGuidance}</strong>
							<p className='detail'>{marketTypeGuidance.description}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>{marketCopy.step1DefineTheEventClearly}</span>
							<span>{marketCopy.step2ExplainHowItResolves}</span>
							<span>{marketCopy.step3SetTheTimingWindow}</span>
						</div>
					</div>

					<SectionBlock headingLevel={4} title={marketCopy.questionTypeGuidance} variant='embedded'>
						<ul className='requirements-checklist'>
							{marketTypeGuidance.steps.map(step => (
								<li key={step}>{step}</li>
							))}
						</ul>
					</SectionBlock>

					<div className='form-grid'>
						<div className='field'>
							<span>{marketCopy.questionType}</span>
							<EnumDropdown ariaLabel={marketCopy.questionType} options={MARKET_TYPE_OPTIONS} value={marketForm.marketType} onChange={marketType => onMarketFormChange({ marketType })} />
							<p className='field-help'>{marketTypeGuidance.description}</p>
						</div>

						<div className='field'>
							<label>
								<span>{marketCopy.title}</span>
								<FormInput
									aria-describedby={getFieldErrorDescribedBy('title', marketFormValidation.fieldErrors.title)}
									invalid={marketFormValidation.fieldErrors.title !== undefined}
									value={marketForm.title}
									onInput={event => onMarketFormChange({ title: event.currentTarget.value })}
									placeholder={marketCopy.questionTitlePlaceholder}
								/>
							</label>
							<p className='field-help'>{marketCopy.questionTitleHelpText}</p>
							{renderFieldError('title', marketFormValidation.fieldErrors.title)}
						</div>

						<div className='field'>
							<label htmlFor='market-create-description'>
								<span>{marketCopy.description}</span>
							</label>
							<textarea id='market-create-description' value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder={marketCopy.optionalQuestionContext} />
							<p className='field-help'>{marketCopy.resolutionSourceHelpText}</p>
						</div>

						<div className='field-row'>
							<div className='field'>
								<label>
									<span>{marketCopy.startTime}</span>
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
									<span>{marketCopy.endTime}</span>
									<FormInput aria-describedby={getFieldErrorDescribedBy('endTime', marketFormValidation.fieldErrors.endTime)} invalid={marketFormValidation.fieldErrors.endTime !== undefined} type='datetime-local' value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
								</label>
								{renderFieldError('endTime', marketFormValidation.fieldErrors.endTime)}
							</div>
						</div>
						<p className='field-help'>{marketCopy.questionTimingHelpText}</p>
						<p className='field-help'>{getPoolEligibilityMessage(marketForm.marketType)}</p>

						{marketForm.marketType === 'categorical' ? (
							<div className='field'>
								<span>{marketCopy.outcomes}</span>
								<div className='categorical-outcomes'>
									{marketForm.categoricalOutcomes.map((outcome, outcomeIndex) => (
										<div className='categorical-outcome-row' key={`categorical-outcome-${outcomeIndex}`}>
											<label className='field'>
												<span className='visually-hidden'>{`${commonCopy.outcome} ${outcomeIndex + 1}`}</span>
												<FormInput
													aria-describedby={getFieldErrorDescribedBy('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
													invalid={marketFormValidation.fieldErrors.categoricalOutcomes !== undefined}
													value={outcome}
													onInput={event => updateCategoricalOutcome(outcomeIndex, event.currentTarget.value)}
													placeholder={`${commonCopy.outcome} ${outcomeIndex + 1}`}
												/>
											</label>
											<button className='secondary categorical-outcome-remove' type='button' onClick={() => removeCategoricalOutcome(outcomeIndex)}>
												{marketCopy.remove}
											</button>
										</div>
									))}
								</div>
								{renderFieldError('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
								<p className='field-help'>{marketCopy.categoricalOutcomeLabelsHelpText}</p>
								<button className='secondary categorical-outcome-add' type='button' onClick={addCategoricalOutcome}>
									{marketCopy.addOutcome}
								</button>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>{marketCopy.scalarMin}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
											invalid={marketFormValidation.fieldErrors.scalarMin !== undefined}
											value={marketForm.scalarMin}
											onInput={event => onMarketFormChange({ scalarMin: event.currentTarget.value })}
											placeholder={marketCopy.scalarMinExample}
										/>
									</label>
									{renderFieldError('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
								</div>
								<label className='field'>
									<span>{marketCopy.answerUnit}</span>
									<FormInput value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder={marketCopy.usd} />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>{marketCopy.scalarIncrement}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
											invalid={marketFormValidation.fieldErrors.scalarIncrement !== undefined}
											value={marketForm.scalarIncrement}
											onInput={event => onMarketFormChange({ scalarIncrement: event.currentTarget.value })}
											placeholder={marketCopy.scalarIncrementExample}
										/>
									</label>
									{renderFieldError('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
								</div>
								<div className='field'>
									<label>
										<span>{marketCopy.scalarMax}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
											invalid={marketFormValidation.fieldErrors.scalarMax !== undefined}
											value={marketForm.scalarMax}
											onInput={event => onMarketFormChange({ scalarMax: event.currentTarget.value })}
											placeholder={marketCopy.scalarMaxExample}
										/>
									</label>
									{renderFieldError('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
								</div>
							</div>
						) : undefined}
						{marketForm.marketType === 'scalar' ? <p className='field-help'>{marketCopy.scalarResolutionHelpText}</p> : undefined}

						{(() => {
							if (marketForm.marketType === 'scalar') {
								if (scalarCreatePreviewDetails === undefined) return <p className='detail'>{marketCopy.scalarPreviewInputHint}</p>

								return <ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
							}

							return undefined
						})()}

						<SectionBlock headingLevel={4} title={marketCopy.draftPreview} variant='embedded' description={marketCopy.draftPreviewDescription}>
							<div className='question-draft-preview'>
								<div className='question-draft-preview-header'>
									<div className='question-summary-heading'>
										<strong>{draftTitle}</strong>
										<p className='detail'>{draftDescription}</p>
									</div>
									<div className='question-draft-preview-statuses' role='list' aria-label={marketCopy.draftQuestionStatus}>
										<span className='question-draft-preview-chip' role='listitem'>
											{marketForm.marketType}
										</span>
										<span className={`question-draft-preview-chip ${normalizedDescription === '' ? 'warning' : 'ok'}`} role='listitem'>
											{draftQuestionContextLabel}
										</span>
									</div>
								</div>
								<OutcomeChipRow items={draftOutcomeItems} />
								<div className='question-draft-preview-meta' role='list' aria-label={marketCopy.draftQuestionSummary}>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{commonCopy.starts}</span>
										<strong>{marketForm.startTime.trim() === '' ? marketCopy.immediatelyAfterCreation : marketForm.startTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{commonCopy.ends}</span>
										<strong>{marketForm.endTime.trim() === '' ? marketCopy.endTimeRequired : marketForm.endTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{marketCopy.riskCue}</span>
										<strong>{normalizedDescription === '' ? marketCopy.lowTrustUntilContextIsAdded : marketCopy.contextIsPresentForReview}</strong>
									</div>
								</div>
							</div>
						</SectionBlock>

						<div className='actions'>
							<TransactionActionButton
								idleLabel={commonCopy.createQuestion}
								pendingLabel={marketCopy.createQuestionPendingLabel}
								onClick={onCreateMarket}
								pending={marketCreating}
								availability={{
									disabled: accountAddress === undefined || !isMainnet || marketCreating || !marketFormValidation.isValid,
									reason: (() => {
										if (accountAddress === undefined) return marketCopy.questionCreationWalletRequired
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
