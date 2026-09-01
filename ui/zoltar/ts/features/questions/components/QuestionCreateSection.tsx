import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { EnumDropdown, type EnumDropdownOption } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { OutcomeChipRow } from '@zoltar/ui-core-shared/components/OutcomeChipRow.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { getMarketCreationOutcomeLabels, hasMarketEndTimePassed, validateMarketForm } from '../lib/questionCreation.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '@zoltar/ui-core-shared/lib/outcomeLabels.js'
import { clampScalarTickIndex, parseScalarFormInputs } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import type { MarketFormState } from '../../../types/app.js'
import type { MarketCreationResult, MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/lib/network.js'
import { tryParseTimestampInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import type { ComponentChildren } from 'preact'

const MARKET_TYPE_OPTIONS: EnumDropdownOption<MarketFormState['marketType']>[] = [
	{ value: 'binary', label: marketCopy.binary },
	{ value: 'categorical', label: marketCopy.categorical },
	{ value: 'scalar', label: marketCopy.scalar },
]
type MarketFormFieldName = keyof ReturnType<typeof validateMarketForm>['fieldErrors']
export type QuestionCreateSectionProps = {
	allowedMarketTypes?: readonly MarketFormState['marketType'][]
	accountAddress: Address | undefined
	canUseForFork: boolean
	hasForked: boolean
	isOnActiveAppChain: boolean
	questionCreating: boolean
	questionError: string | undefined
	questionForm: MarketFormState
	questionResult: MarketCreationResult | undefined
	loadingZoltarQuestions: boolean
	onCreateQuestion: () => void
	onQuestionFormChange: (update: Partial<MarketFormState>) => void
	onOpenForkTab: () => void
	onResetQuestion: () => void
	onUseQuestionForFork: (questionId: string) => void
	renderResultActions?: (result: { marketType: MarketCreationResult['marketType']; questionId: string; questionTitle: string }) => ComponentChildren
	submitActionOverride?: {
		availability: {
			disabled: boolean
			reason: string | undefined
		}
		idleLabel: ComponentChildren
		onSubmit: () => void
		pending: boolean
		pendingLabel: string
	}
	zoltarQuestions: MarketDetails[]
}

function getScalarCreatePreviewDetails(questionForm: MarketFormState, scalarInputsValid: boolean): ScalarCreatePreviewDetails | undefined {
	if (questionForm.marketType !== 'scalar') return undefined
	if (!scalarInputsValid) return undefined
	return {
		answerUnit: questionForm.answerUnit.trim(),
		...parseScalarFormInputs(questionForm),
	}
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

function renderRequiredFieldLabel(label: string) {
	return (
		<>
			{label}{' '}
			<span className='required-field-indicator' aria-hidden='true'>
				*
			</span>
			<span className='visually-hidden'> ({commonCopy.required})</span>
		</>
	)
}

function getMarketTypeGuidance(marketType: MarketFormState['marketType']) {
	switch (marketType) {
		case 'binary':
			return marketCopy.binaryQuestionDescription
		case 'categorical':
			return marketCopy.categoricalOutcomesGuidance
		case 'scalar':
			return marketCopy.scalarQuestionDescription
		default:
			return assertNever(marketType)
	}
}

function getDraftOutcomeLabels(questionForm: MarketFormState, categoricalOutcomesError: string | undefined) {
	switch (questionForm.marketType) {
		case 'binary':
			return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(questionForm))
		case 'categorical': {
			if (categoricalOutcomesError === undefined) {
				return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(questionForm))
			}

			const normalizedOutcomes = questionForm.categoricalOutcomes.map(outcome => outcome.trim()).filter(outcome => outcome !== '')
			return normalizedOutcomes.length > 0 ? appendInvalidOutcomeLabelIfMissing(normalizedOutcomes) : [marketCopy.minimumOutcomeCountReason, commonCopy.invalid]
		}
		case 'scalar':
			return [marketCopy.scalar, commonCopy.invalid]
		default:
			return assertNever(questionForm.marketType)
	}
}

export function QuestionCreateSection({
	allowedMarketTypes = ['binary', 'categorical', 'scalar'],
	accountAddress,
	canUseForFork,
	hasForked,
	isOnActiveAppChain,
	loadingZoltarQuestions,
	questionCreating,
	questionError,
	questionForm,
	questionResult,
	onCreateQuestion,
	onQuestionFormChange,
	onOpenForkTab,
	onResetQuestion,
	onUseQuestionForFork,
	renderResultActions,
	submitActionOverride,
	zoltarQuestions,
}: QuestionCreateSectionProps) {
	const [scalarCreatePreviewTick, setScalarCreatePreviewTick] = useState('0')
	const currentTimestamp = useChainTimestamp()
	const [touchedFields, setTouchedFields] = useState<ReadonlySet<MarketFormFieldName>>(new Set())
	const selectedQuestionDetails = useMemo(() => (questionResult === undefined ? undefined : zoltarQuestions.find(question => question.questionId === questionResult.questionId)), [questionResult?.questionId, zoltarQuestions])
	const marketTypeOptions = useMemo(() => MARKET_TYPE_OPTIONS.filter(option => allowedMarketTypes.includes(option.value)), [allowedMarketTypes])
	const questionFormValidation = validateMarketForm(questionForm)
	const marketTypeGuidance = getMarketTypeGuidance(questionForm.marketType)
	const scalarInputsValid = questionFormValidation.fieldErrors.scalarIncrement === undefined && questionFormValidation.fieldErrors.scalarMax === undefined && questionFormValidation.fieldErrors.scalarMin === undefined
	const scalarCreatePreviewDetails = getScalarCreatePreviewDetails(questionForm, scalarInputsValid)
	const selectedQuestionTitle = selectedQuestionDetails === undefined ? commonCopy.question : getQuestionTitle(selectedQuestionDetails)
	const draftOutcomeItems = getDraftOutcomeLabels(questionForm, questionFormValidation.fieldErrors.categoricalOutcomes).map((outcome, outcomeIndex) => ({
		key: `${outcomeIndex}-${outcome}`,
		label: outcome,
		tone: isInvalidOutcomeLabel(outcome) ? ('warning' as const) : ('default' as const),
	}))
	const normalizedDescription = questionForm.description.trim()
	const draftDescription = normalizedDescription === '' ? undefined : questionForm.description
	const draftTitle = questionForm.title.trim() === '' ? marketCopy.untitledQuestion : questionForm.title
	const markFieldTouched = (field: MarketFormFieldName) => setTouchedFields(current => new Set([...current, field]))
	const getVisibleFieldError = (field: MarketFormFieldName) => (touchedFields.has(field) ? questionFormValidation.fieldErrors[field] : undefined)
	const timingRelationshipError = questionFormValidation.fieldErrors.startTime !== undefined && questionFormValidation.fieldErrors.startTime === questionFormValidation.fieldErrors.endTime && (touchedFields.has('startTime') || touchedFields.has('endTime')) ? questionFormValidation.fieldErrors.startTime : undefined
	const startTimeError = timingRelationshipError ?? getVisibleFieldError('startTime')
	const endTimeError = timingRelationshipError ?? getVisibleFieldError('endTime')
	const timingRelationshipErrorId = 'market-create-timing-error'
	const canCreateQuestion = accountAddress !== undefined && isOnActiveAppChain && !questionCreating && questionFormValidation.isValid
	const submitAction =
		submitActionOverride === undefined
			? {
					availability: {
						disabled: !canCreateQuestion,
						reason: (() => {
							if (accountAddress === undefined) return marketCopy.questionCreationWalletRequired
							if (!isOnActiveAppChain) return getWrongNetworkReason()
							if (questionFormValidation.isValid) return undefined
							return questionFormValidation.notice
						})(),
					},
					idleLabel: commonCopy.createQuestionAction,
					onSubmit: onCreateQuestion,
					pending: questionCreating,
					pendingLabel: marketCopy.createQuestionPendingLabel,
				}
			: submitActionOverride
	const showEndedQuestionWarning = questionFormValidation.fieldErrors.endTime === undefined && hasMarketEndTimePassed(questionForm, currentTimestamp)
	const renderDraftTimestamp = (value: string, emptyValue: string) => {
		if (value.trim() === '') return emptyValue
		const timestamp = tryParseTimestampInput(value)
		return timestamp === undefined ? value : <TimestampValue timestamp={timestamp} />
	}
	useEffect(() => {
		if (scalarCreatePreviewDetails === undefined) return
		const clampedTick = clampScalarTickIndex(BigInt(scalarCreatePreviewTick), scalarCreatePreviewDetails.numTicks).toString()
		if (clampedTick === scalarCreatePreviewTick) return
		setScalarCreatePreviewTick(clampedTick)
	}, [scalarCreatePreviewDetails?.numTicks, scalarCreatePreviewTick])
	const updateCategoricalOutcome = (outcomeIndex: number, value: string) => {
		onQuestionFormChange({
			categoricalOutcomes: questionForm.categoricalOutcomes.map((outcome, index) => (index === outcomeIndex ? value : outcome)),
		})
	}
	const addCategoricalOutcome = () => {
		onQuestionFormChange({
			categoricalOutcomes: [...questionForm.categoricalOutcomes, ''],
		})
	}
	const removeCategoricalOutcome = (outcomeIndex: number) => {
		onQuestionFormChange({
			categoricalOutcomes: questionForm.categoricalOutcomes.filter((_, index) => index !== outcomeIndex),
		})
	}
	return (
		<>
			{questionResult === undefined ? undefined : (
				<EntityCard
					title={selectedQuestionTitle}
					actions={
						<div className='actions'>
							{canUseForFork ? (
								<button
									aria-label={hasForked ? marketCopy.formatAlreadyForkedLabel(selectedQuestionTitle, questionResult.questionId) : marketCopy.formatUseForForkLabel(selectedQuestionTitle, questionResult.questionId)}
									className='secondary'
									disabled={hasForked}
									onClick={() => {
										if (hasForked) return
										onUseQuestionForFork(questionResult.questionId)
										onOpenForkTab()
									}}
								>
									{hasForked ? marketCopy.alreadyForked : marketCopy.useForFork}
								</button>
							) : undefined}
							{renderResultActions?.({ marketType: questionResult.marketType, questionId: questionResult.questionId, questionTitle: selectedQuestionTitle })}
							<button className='secondary' onClick={onResetQuestion}>
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
							<TransactionHashLink hash={questionResult.createQuestionHash} />
						</MetricField>
					</div>
				</EntityCard>
			)}

			{questionResult === undefined ? (
				<SectionBlock variant='plain'>
					<form
						aria-label={commonCopy.createQuestion}
						className='form-grid'
						noValidate
						onSubmit={event => {
							event.preventDefault()
							if (submitAction.availability.disabled) return
							submitAction.onSubmit()
						}}
					>
						<div className='question-create-editor'>
							<p className='field-help'>{marketCopy.requiredFieldsNote}</p>
							<div className='field'>
								<span>{marketCopy.questionType}</span>
								<EnumDropdown ariaLabel={marketCopy.questionType} options={marketTypeOptions} value={questionForm.marketType} onChange={marketType => onQuestionFormChange({ marketType })} />
								<p className='field-help'>{marketTypeGuidance}</p>
							</div>

							<div className='field'>
								<label>
									<span>{renderRequiredFieldLabel(marketCopy.title)}</span>
									<FormInput
										aria-label={marketCopy.title}
										aria-describedby={getFieldErrorDescribedBy('title', getVisibleFieldError('title'))}
										invalid={getVisibleFieldError('title') !== undefined}
										value={questionForm.title}
										onBlur={() => markFieldTouched('title')}
										onInput={event => onQuestionFormChange({ title: event.currentTarget.value })}
										placeholder={marketCopy.questionTitlePlaceholder}
										required
									/>
								</label>
								{renderFieldError('title', getVisibleFieldError('title'))}
							</div>

							<div className='field'>
								<label htmlFor='market-create-description'>
									<span>{marketCopy.description}</span>
								</label>
								<textarea id='market-create-description' value={questionForm.description} onInput={event => onQuestionFormChange({ description: event.currentTarget.value })} placeholder={marketCopy.optionalQuestionContext} />
								<p className='field-help'>{marketCopy.resolutionSourceHelpText}</p>
							</div>

							<div className='field-row'>
								<div className='field'>
									<label>
										<span>{marketCopy.startTime}</span>
										<FormInput
											aria-describedby={timingRelationshipError === undefined ? getFieldErrorDescribedBy('startTime', startTimeError) : timingRelationshipErrorId}
											invalid={startTimeError !== undefined}
											type='datetime-local'
											value={questionForm.startTime}
											onBlur={() => markFieldTouched('startTime')}
											onInput={event => onQuestionFormChange({ startTime: event.currentTarget.value })}
										/>
									</label>
									{timingRelationshipError === undefined ? renderFieldError('startTime', startTimeError) : undefined}
								</div>
								<div className='field'>
									<label>
										<span>{renderRequiredFieldLabel(marketCopy.endTime)}</span>
										<FormInput
											aria-label={marketCopy.endTime}
											aria-describedby={timingRelationshipError === undefined ? getFieldErrorDescribedBy('endTime', endTimeError) : timingRelationshipErrorId}
											invalid={endTimeError !== undefined}
											type='datetime-local'
											value={questionForm.endTime}
											required
											onBlur={() => markFieldTouched('endTime')}
											onInput={event => onQuestionFormChange({ endTime: event.currentTarget.value })}
										/>
									</label>
									{timingRelationshipError === undefined ? renderFieldError('endTime', endTimeError) : undefined}
								</div>
							</div>
							{timingRelationshipError === undefined ? undefined : (
								<p className='field-error' id={timingRelationshipErrorId}>
									{timingRelationshipError}
								</p>
							)}
							<p className='field-help'>{marketCopy.questionTimingHelpText}</p>

							{questionForm.marketType === 'categorical' ? (
								<div className='field' role='group' aria-labelledby='market-create-outcomes-label'>
									<span id='market-create-outcomes-label'>{renderRequiredFieldLabel(marketCopy.outcomes)}</span>
									<div className='categorical-outcomes'>
										{questionForm.categoricalOutcomes.map((outcome, outcomeIndex) => (
											<div className='categorical-outcome-row' key={`categorical-outcome-${outcomeIndex}`}>
												<label className='field'>
													<span className='visually-hidden'>{`${commonCopy.outcome} ${outcomeIndex + 1}`}</span>
													<FormInput
														aria-describedby={getFieldErrorDescribedBy('categoricalOutcomes', getVisibleFieldError('categoricalOutcomes'))}
														invalid={getVisibleFieldError('categoricalOutcomes') !== undefined}
														required={outcomeIndex < 2}
														value={outcome}
														onBlur={() => markFieldTouched('categoricalOutcomes')}
														onInput={event => updateCategoricalOutcome(outcomeIndex, event.currentTarget.value)}
														placeholder={`${commonCopy.outcome} ${outcomeIndex + 1}`}
													/>
												</label>
												<button aria-label={marketCopy.formatRemoveOutcomeLabel(outcomeIndex + 1)} className='secondary categorical-outcome-remove' type='button' onClick={() => removeCategoricalOutcome(outcomeIndex)}>
													{marketCopy.remove}
												</button>
											</div>
										))}
									</div>
									{renderFieldError('categoricalOutcomes', getVisibleFieldError('categoricalOutcomes'))}
									<p className='field-help'>{marketCopy.categoricalOutcomeLabelsHelpText}</p>
									<button className='secondary categorical-outcome-add' type='button' onClick={addCategoricalOutcome}>
										{marketCopy.addOutcome}
									</button>
								</div>
							) : undefined}

							{questionForm.marketType === 'scalar' ? (
								<div className='field-row'>
									<div className='field'>
										<label>
											<span>{renderRequiredFieldLabel(marketCopy.scalarMin)}</span>
											<FormInput
												aria-label={marketCopy.scalarMin}
												aria-describedby={getFieldErrorDescribedBy('scalarMin', getVisibleFieldError('scalarMin'))}
												invalid={getVisibleFieldError('scalarMin') !== undefined}
												value={questionForm.scalarMin}
												onBlur={() => markFieldTouched('scalarMin')}
												onInput={event => onQuestionFormChange({ scalarMin: event.currentTarget.value })}
												placeholder={marketCopy.scalarMinExample}
												required
											/>
										</label>
										{renderFieldError('scalarMin', getVisibleFieldError('scalarMin'))}
									</div>
									<label className='field'>
										<span>{marketCopy.answerUnit}</span>
										<FormInput value={questionForm.answerUnit} onInput={event => onQuestionFormChange({ answerUnit: event.currentTarget.value })} placeholder={marketCopy.usd} />
									</label>
								</div>
							) : undefined}

							{questionForm.marketType === 'scalar' ? (
								<div className='field-row'>
									<div className='field'>
										<label>
											<span>{renderRequiredFieldLabel(marketCopy.scalarIncrement)}</span>
											<FormInput
												aria-label={marketCopy.scalarIncrement}
												aria-describedby={getFieldErrorDescribedBy('scalarIncrement', getVisibleFieldError('scalarIncrement'))}
												invalid={getVisibleFieldError('scalarIncrement') !== undefined}
												value={questionForm.scalarIncrement}
												onBlur={() => markFieldTouched('scalarIncrement')}
												onInput={event => onQuestionFormChange({ scalarIncrement: event.currentTarget.value })}
												placeholder={marketCopy.scalarIncrementExample}
												required
											/>
										</label>
										{renderFieldError('scalarIncrement', getVisibleFieldError('scalarIncrement'))}
									</div>
									<div className='field'>
										<label>
											<span>{renderRequiredFieldLabel(marketCopy.scalarMax)}</span>
											<FormInput
												aria-label={marketCopy.scalarMax}
												aria-describedby={getFieldErrorDescribedBy('scalarMax', getVisibleFieldError('scalarMax'))}
												invalid={getVisibleFieldError('scalarMax') !== undefined}
												value={questionForm.scalarMax}
												onBlur={() => markFieldTouched('scalarMax')}
												onInput={event => onQuestionFormChange({ scalarMax: event.currentTarget.value })}
												placeholder={marketCopy.scalarMaxExample}
												required
											/>
										</label>
										{renderFieldError('scalarMax', getVisibleFieldError('scalarMax'))}
									</div>
								</div>
							) : undefined}
							{questionForm.marketType === 'scalar' ? <p className='field-help'>{marketCopy.scalarResolutionHelpText}</p> : undefined}
							{showEndedQuestionWarning ? (
								<WarningSurface ariaLive='polite' role='status' surface='flat' variant='compact'>
									<p>{marketCopy.endedQuestionWarning}</p>
								</WarningSurface>
							) : undefined}

							{(() => {
								if (questionForm.marketType === 'scalar') {
									if (scalarCreatePreviewDetails === undefined) return <p className='detail'>{marketCopy.scalarPreviewInputHint}</p>

									return <ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
								}

								return undefined
							})()}

							<SectionBlock headingLevel={4} title={marketCopy.draftPreview} variant='embedded'>
								<div className='question-draft-preview'>
									<div className='question-draft-preview-header'>
										<div className='question-summary-heading'>
											<strong>{draftTitle}</strong>
											{draftDescription === undefined ? undefined : <p className='detail'>{draftDescription}</p>}
										</div>
										<span className='question-draft-preview-chip'>{getMarketTypeLabel(questionForm.marketType)}</span>
									</div>
									<OutcomeChipRow items={draftOutcomeItems} />
									<div className='question-draft-preview-meta' role='list' aria-label={marketCopy.draftQuestionSummary}>
										<div className='question-draft-preview-meta-item' role='listitem'>
											<span>{commonCopy.starts}</span>
											<strong>{renderDraftTimestamp(questionForm.startTime, marketCopy.immediatelyAfterCreation)}</strong>
										</div>
										<div className='question-draft-preview-meta-item' role='listitem'>
											<span>{commonCopy.ends}</span>
											<strong>{renderDraftTimestamp(questionForm.endTime, marketCopy.endTimeRequired)}</strong>
										</div>
									</div>
								</div>
							</SectionBlock>
						</div>

						<div className='actions'>
							<TransactionActionButton idleLabel={submitAction.idleLabel} pendingLabel={submitAction.pendingLabel} onClick={() => undefined} pending={submitAction.pending} type='submit' availability={submitAction.availability} />
						</div>
					</form>
				</SectionBlock>
			) : undefined}

			<ErrorNotice message={questionError} />
		</>
	)
}
