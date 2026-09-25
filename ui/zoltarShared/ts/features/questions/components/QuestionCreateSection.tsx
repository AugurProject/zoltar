import { FormField, RequiredFieldLabel } from '@zoltar/ui-core-shared/components/FormField.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as marketCopy from '../../../copy/market.js'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { suppressPresentedTransactionError, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { getMarketCreationOutcomeLabels, hasMarketEndTimePassed, validateMarketForm } from '../lib/questionCreation.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '@zoltar/ui-core-shared/lib/outcomeLabels.js'
import { clampScalarTickIndex, parseScalarFormInputs } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import type { MarketFormState } from '../../../types/app.js'
import type { MarketCreationResult, MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import type { ComponentChildren } from 'preact'
import { QuestionDraftPreview } from './QuestionDraftPreview.js'
import { QuestionTypeOptions } from './QuestionTypeOptions.js'
import { formatTimeZoneLabel, getBrowserTimeZone } from '../lib/questionTimeZone.js'

const MARKET_TYPES: readonly MarketFormState['marketType'][] = ['binary', 'categorical', 'scalar']
type MarketFormFieldName = keyof ReturnType<typeof validateMarketForm>['fieldErrors']
type QuestionCreateSectionProps = {
	allowedMarketTypes?: readonly MarketFormState['marketType'][]
	accountAddress: Address | undefined
	canUseForFork: boolean
	formDisabled?: boolean
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
	submitFields?: ComponentChildren
	submitActionOverride?: {
		availability: {
			disabled: boolean
			reason: string | undefined
		}
		idleLabel: ComponentChildren
		onSubmit: () => void
		pending: boolean
		pendingLabel: string
		/** Replaces the submit button while the submitted transaction is being reviewed inline. */
		reviewContent?: ComponentChildren
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
	formDisabled = false,
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
	submitFields,
	submitActionOverride,
	zoltarQuestions,
}: QuestionCreateSectionProps) {
	const [scalarCreatePreviewTick, setScalarCreatePreviewTick] = useState('0')
	const currentTimestamp = useChainTimestamp()
	const transactionPresentation = useGlobalTransactionPresentation()
	const visibleQuestionError = suppressPresentedTransactionError(questionError, transactionPresentation, transactionCopy.questionCreation)
	const [touchedFields, setTouchedFields] = useState<ReadonlySet<MarketFormFieldName>>(new Set())
	const selectedQuestionDetails = useMemo(() => (questionResult === undefined ? undefined : zoltarQuestions.find(question => question.questionId === questionResult.questionId)), [questionResult?.questionId, zoltarQuestions])
	const marketTypes = useMemo(() => MARKET_TYPES.filter(marketType => allowedMarketTypes.includes(marketType)), [allowedMarketTypes])
	const timeZone = useMemo(() => getBrowserTimeZone(), [])
	const questionFormValidation = validateMarketForm(questionForm)
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
	const timeZoneHelpId = 'market-create-time-zone'
	const timingDescribedBy = timingRelationshipError === undefined ? timeZoneHelpId : `${timingRelationshipErrorId} ${timeZoneHelpId}`
	const timeZoneLabel = formatTimeZoneLabel(timeZone, new Date())
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

							return <Question question={selectedQuestionDetails} showTitle={false} abbreviateIdentifier />
						})()}
					</div>
				</EntityCard>
			)}

			{questionResult === undefined ? (
				<SectionBlock className='question-create-container' variant='plain'>
					<form
						aria-label={commonCopy.createQuestion}
						className='form-grid question-create-form'
						noValidate
						onSubmit={event => {
							event.preventDefault()
							if (submitAction.availability.disabled) return
							submitAction.onSubmit()
						}}
					>
						<fieldset className='question-create-editor' disabled={formDisabled}>
							<QuestionTypeOptions allowedMarketTypes={marketTypes} disabled={formDisabled} value={questionForm.marketType} onChange={marketType => onQuestionFormChange({ marketType })} />

							<FormField id='market-create-title' label={marketCopy.title} required>
								<FormInput
									id='market-create-title'
									aria-label={marketCopy.title}
									error={getVisibleFieldError('title')}
									value={questionForm.title}
									onBlur={() => markFieldTouched('title')}
									onInput={event => onQuestionFormChange({ title: event.currentTarget.value })}
									placeholder={marketCopy.questionTitlePlaceholder}
									required
								/>
							</FormField>

							<div className='field'>
								<label htmlFor='market-create-description'>
									<span>{marketCopy.description}</span>
								</label>
								<textarea id='market-create-description' value={questionForm.description} onInput={event => onQuestionFormChange({ description: event.currentTarget.value })} placeholder={marketCopy.optionalQuestionContext} />
								<p className='field-help'>{marketCopy.resolutionSourceHelpText}</p>
							</div>

							<div className='field-row'>
								<FormField id='market-create-startTime' label={marketCopy.startTime}>
									<FormInput
										id='market-create-startTime'
										aria-describedby={timingDescribedBy}
										invalid={startTimeError !== undefined}
										error={timingRelationshipError === undefined ? startTimeError : undefined}
										type='datetime-local'
										value={questionForm.startTime}
										onBlur={() => markFieldTouched('startTime')}
										onInput={event => onQuestionFormChange({ startTime: event.currentTarget.value })}
									/>
								</FormField>
								<FormField id='market-create-endTime' label={marketCopy.endTime} required>
									<FormInput
										id='market-create-endTime'
										aria-label={marketCopy.endTime}
										aria-describedby={timingDescribedBy}
										invalid={endTimeError !== undefined}
										error={timingRelationshipError === undefined ? endTimeError : undefined}
										type='datetime-local'
										value={questionForm.endTime}
										required
										onBlur={() => markFieldTouched('endTime')}
										onInput={event => onQuestionFormChange({ endTime: event.currentTarget.value })}
									/>
								</FormField>
							</div>
							{timingRelationshipError === undefined ? undefined : (
								<p className='field-error' id={timingRelationshipErrorId}>
									{timingRelationshipError}
								</p>
							)}
							<p className='field-help' id={timeZoneHelpId}>
								{marketCopy.formatQuestionTimingHelpText(timeZoneLabel)}
							</p>

							{questionForm.marketType === 'categorical' ? (
								<div className='field' role='group' aria-labelledby='market-create-outcomes-label'>
									<span id='market-create-outcomes-label'>
										<RequiredFieldLabel>{marketCopy.outcomes}</RequiredFieldLabel>
									</span>
									<div className='categorical-outcomes'>
										{questionForm.categoricalOutcomes.map((outcome, outcomeIndex) => (
											<div className='categorical-outcome-row' key={`categorical-outcome-${outcomeIndex}`}>
												<label className='field'>
													<span className='visually-hidden'>{`${commonCopy.outcome} ${outcomeIndex + 1}`}</span>
													<FormInput
														aria-describedby={getVisibleFieldError('categoricalOutcomes') === undefined ? undefined : 'market-create-outcomes-error'}
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
									{getVisibleFieldError('categoricalOutcomes') === undefined ? undefined : (
										<p className='field-error' id='market-create-outcomes-error'>
											{getVisibleFieldError('categoricalOutcomes')}
										</p>
									)}
									<p className='field-help'>{marketCopy.categoricalOutcomeLabelsHelpText}</p>
									<button className='secondary categorical-outcome-add' type='button' onClick={addCategoricalOutcome}>
										{marketCopy.addOutcome}
									</button>
								</div>
							) : undefined}

							{questionForm.marketType === 'scalar' ? (
								<div className='field-row'>
									<FormField id='market-create-scalarMin' label={marketCopy.scalarMin} required>
										<FormInput
											id='market-create-scalarMin'
											aria-label={marketCopy.scalarMin}
											error={getVisibleFieldError('scalarMin')}
											value={questionForm.scalarMin}
											onBlur={() => markFieldTouched('scalarMin')}
											onInput={event => onQuestionFormChange({ scalarMin: event.currentTarget.value })}
											placeholder={marketCopy.scalarMinExample}
											required
										/>
									</FormField>
									<label className='field'>
										<span>{marketCopy.answerUnit}</span>
										<FormInput value={questionForm.answerUnit} onInput={event => onQuestionFormChange({ answerUnit: event.currentTarget.value })} placeholder={marketCopy.usd} />
									</label>
								</div>
							) : undefined}

							{questionForm.marketType === 'scalar' ? (
								<div className='field-row'>
									<FormField id='market-create-scalarIncrement' label={marketCopy.scalarIncrement} required>
										<FormInput
											id='market-create-scalarIncrement'
											aria-label={marketCopy.scalarIncrement}
											error={getVisibleFieldError('scalarIncrement')}
											value={questionForm.scalarIncrement}
											onBlur={() => markFieldTouched('scalarIncrement')}
											onInput={event => onQuestionFormChange({ scalarIncrement: event.currentTarget.value })}
											placeholder={marketCopy.scalarIncrementExample}
											required
										/>
									</FormField>
									<FormField id='market-create-scalarMax' label={marketCopy.scalarMax} required>
										<FormInput
											id='market-create-scalarMax'
											aria-label={marketCopy.scalarMax}
											error={getVisibleFieldError('scalarMax')}
											value={questionForm.scalarMax}
											onBlur={() => markFieldTouched('scalarMax')}
											onInput={event => onQuestionFormChange({ scalarMax: event.currentTarget.value })}
											placeholder={marketCopy.scalarMaxExample}
											required
										/>
									</FormField>
								</div>
							) : undefined}
							{questionForm.marketType === 'scalar' ? <p className='field-help'>{marketCopy.scalarResolutionHelpText}</p> : undefined}
							{showEndedQuestionWarning ? (
								<WarningSurface ariaLive='polite' role='status' surface='flat' variant='compact'>
									<p>{marketCopy.endedQuestionWarning}</p>
								</WarningSurface>
							) : undefined}
						</fieldset>
						<QuestionDraftPreview currentTimestamp={currentTimestamp} description={draftDescription} endTime={questionForm.endTime} marketType={questionForm.marketType} outcomeItems={draftOutcomeItems} startTime={questionForm.startTime} timeZone={timeZone} title={draftTitle}>
							{(() => {
								if (questionForm.marketType !== 'scalar') return undefined
								if (scalarCreatePreviewDetails === undefined) return <p className='detail'>{marketCopy.scalarPreviewInputHint}</p>
								return <ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
							})()}
						</QuestionDraftPreview>
						<div className='question-create-submit'>
							{submitFields}
							{submitActionOverride?.reviewContent ?? (
								<div className='actions'>
									<TransactionActionButton idleLabel={submitAction.idleLabel} pendingLabel={submitAction.pendingLabel} onClick={() => undefined} pending={submitAction.pending} type='submit' availability={submitAction.availability} />
								</div>
							)}
							<ErrorNotice message={visibleQuestionError} />
						</div>
					</form>
				</SectionBlock>
			) : undefined}
			{questionResult === undefined ? undefined : <ErrorNotice message={visibleQuestionError} />}
		</>
	)
}
