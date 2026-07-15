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
import {
	UI_STRING_0_1,
	UI_STRING_1,
	UI_STRING_1_DEFINE_THE_EVENT_CLEARLY,
	UI_STRING_10,
	UI_STRING_2_EXPLAIN_HOW_IT_RESOLVES,
	UI_STRING_3_SET_THE_TIMING_WINDOW,
	UI_STRING_ADD_A_CLEAR_QUESTION_TITLE,
	UI_STRING_ADD_AT_LEAST_2_OUTCOMES,
	UI_STRING_ADD_OUTCOME,
	UI_STRING_ADD_RESOLUTION_NOTES_EVIDENCE_SOURCES_AND_EDGE_CASE_HANDLING_SO_OTHER_USERS_KNOW_HOW_THIS_QUESTION_WILL_SETTLE,
	UI_STRING_ALREADY_FORKED,
	UI_STRING_ANSWER_UNIT,
	UI_STRING_ASK_A_YES_OR_NO_QUESTION_THAT_CAN_BE_RESOLVED_FROM_ONE_PUBLIC_SOURCE_OF_TRUTH,
	UI_STRING_ASK_FOR_A_MEASURABLE_NUMBER_WITH_A_UNIT_RANGE_AND_INCREMENT_THAT_USERS_CAN_UNDERSTAND,
	UI_STRING_BINARY,
	UI_STRING_CATEGORICAL,
	UI_STRING_CATEGORICAL_QUESTIONS_ARE_VALID_IN_ZOLTAR_BUT_PLACEHOLDER_ORIGIN_SECURITY_POOLS_CURRENTLY_REQUIRE_AN_EXACT_BINARY_YES_NO_QUESTION,
	UI_STRING_CHOOSE_AN_END_TIME,
	UI_STRING_CONNECT_A_WALLET_BEFORE_CREATING_A_QUESTION,
	UI_STRING_CONTEXT_IS_PRESENT_FOR_REVIEW,
	UI_STRING_CONTEXT_PROVIDED,
	UI_STRING_CREATE_ANOTHER_QUESTION,
	UI_STRING_CREATE_POOL_FROM_QUESTION,
	UI_STRING_CREATE_QUESTION,
	UI_STRING_CREATING_QUESTION_MARKET_CREATE_QUESTION_SECTION_CREATE_QUESTION_BUTTON_PENDING_LABEL,
	UI_STRING_CREATION_TRANSACTION_HASH,
	UI_STRING_DEFINE_THE_MARKET_TYPE_TIMING_AND_OUTCOMES_FOR_A_NEW_ZOLTAR_QUESTION,
	UI_STRING_DESCRIPTION,
	UI_STRING_DRAFT_PREVIEW,
	UI_STRING_DRAFT_PREVIEW_SHOWS_THE_LEVEL_OF_CLARITY_TRADERS_AND_REPORTERS_WILL_SEE_BEFORE_TRUSTING_THE_QUESTION,
	UI_STRING_DRAFT_QUESTION_STATUS,
	UI_STRING_DRAFT_QUESTION_SUMMARY,
	UI_STRING_END_TIME,
	UI_STRING_ENDS,
	UI_STRING_ENTER_SCALAR_MIN_MAX_AND_INCREMENT_TO_PREVIEW_THE_TICK_SLIDER,
	UI_STRING_IMMEDIATELY_AFTER_CREATION,
	UI_STRING_INCLUDE_THE_RESOLUTION_SOURCE_ANY_EDGE_CASES_AND_WHAT_SHOULD_MAKE_THE_QUESTION_RESOLVE_AS_INVALID,
	UI_STRING_INVALID,
	UI_STRING_KEEP_OUTCOMES_SHORT_AND_CLEARLY_DISTINCT_FROM_EACH_OTHER,
	UI_STRING_KEEP_THE_TITLE_SELF_CONTAINED_SO_USERS_CAN_UNDERSTAND_THE_EXACT_QUESTION_BEFORE_OPENING_DETAILS,
	UI_STRING_LIST_THE_MUTUALLY_EXCLUSIVE_OUTCOMES_THAT_COULD_WIN_THIS_QUESTION,
	UI_STRING_LOADING_QUESTION_DETAILS,
	UI_STRING_LOW_TRUST_UNTIL_CONTEXT_IS_ADDED,
	UI_STRING_NAME_THE_EVENT_WINDOW_CLEARLY_IN_THE_TITLE_OR_DESCRIPTION,
	UI_STRING_NEEDS_CONTEXT,
	UI_STRING_ONLY_INCLUDE_OUTCOMES_THAT_A_RESOLVER_CAN_VERIFY_FROM_A_PUBLIC_SOURCE,
	UI_STRING_OPTIONAL_QUESTION_CONTEXT,
	UI_STRING_OUTCOME,
	UI_STRING_OUTCOMES,
	UI_STRING_PICK_A_RANGE_THAT_COVERS_REALISTIC_ANSWERS_WITHOUT_BEING_OVERLY_BROAD,
	UI_STRING_PLACEHOLDER_ORIGIN_SECURITY_POOLS_SUPPORT_THIS_EXACT_YES_NO_QUESTION_SHAPE,
	UI_STRING_QUESTION,
	UI_STRING_QUESTION_DETAILS_ARE_NOT_AVAILABLE,
	UI_STRING_QUESTION_TYPE,
	UI_STRING_QUESTION_TYPE_GUIDANCE,
	UI_STRING_REMOVE,
	UI_STRING_RISK_CUE,
	UI_STRING_SCALAR,
	UI_STRING_SCALAR_INCREMENT,
	UI_STRING_SCALAR_MAX,
	UI_STRING_SCALAR_MIN,
	UI_STRING_SCALAR_QUESTIONS_ARE_VALID_IN_ZOLTAR_BUT_PLACEHOLDER_ORIGIN_SECURITY_POOLS_CURRENTLY_REQUIRE_AN_EXACT_BINARY_YES_NO_QUESTION,
	UI_STRING_SCALAR_QUESTIONS_SETTLE_TO_A_NUMERIC_RESULT_INSIDE_THE_RANGE_ABOVE_USE_A_UNIT_THAT_MATCHES_THE_PUBLIC_SOURCE_YOU_EXPECT_TO_CITE,
	UI_STRING_SET_THE_ANSWER_UNIT_SO_USERS_KNOW_WHAT_THE_NUMBER_REPRESENTS,
	UI_STRING_START_TIME,
	UI_STRING_STARTS,
	UI_STRING_TIMES_USE_YOUR_BROWSER_TIMEZONE_LEAVE_START_TIME_BLANK_TO_ALLOW_ACTIVITY_IMMEDIATELY_AFTER_CREATION,
	UI_STRING_TITLE,
	UI_STRING_USD,
	UI_STRING_USE_CONCISE_MUTUALLY_EXCLUSIVE_LABELS_USERS_SHOULD_BE_ABLE_TO_TELL_AT_A_GLANCE_WHICH_OUTCOME_WOULD_WIN,
	UI_STRING_USE_FOR_FORK,
	UI_STRING_USE_THE_DESCRIPTION_FOR_THE_EXACT_RESOLUTION_SOURCE_AND_EDGE_CASES,
	UI_STRING_USE_THE_DESCRIPTION_TO_EXPLAIN_HOW_TIES_CANCELLATIONS_OR_EXCEPTIONS_RESOLVE,
	UI_STRING_USE_THE_DESCRIPTION_TO_EXPLAIN_ROUNDING_SOURCE_DATA_AND_INVALID_CONDITIONS,
	UI_STRING_WILL_EVENT_X_HAPPEN,
	UI_STRING_WRITE_THE_QUESTION_THE_WAY_A_RESOLVER_WILL_READ_IT,
	UI_STRING_WRITE_THE_TITLE_SO_IT_CAN_BE_ANSWERED_WITH_YES_NO_OR_INVALID,
} from '../lib/uiStrings.js'
import type { MarketFormState } from '../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'

const MARKET_TYPE_OPTIONS: EnumDropdownOption<MarketFormState['marketType']>[] = [
	{ value: 'binary', label: UI_STRING_BINARY },
	{ value: 'categorical', label: UI_STRING_CATEGORICAL },
	{ value: 'scalar', label: UI_STRING_SCALAR },
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
	if (marketType === 'binary') return UI_STRING_PLACEHOLDER_ORIGIN_SECURITY_POOLS_SUPPORT_THIS_EXACT_YES_NO_QUESTION_SHAPE
	if (marketType === 'categorical') return UI_STRING_CATEGORICAL_QUESTIONS_ARE_VALID_IN_ZOLTAR_BUT_PLACEHOLDER_ORIGIN_SECURITY_POOLS_CURRENTLY_REQUIRE_AN_EXACT_BINARY_YES_NO_QUESTION
	return UI_STRING_SCALAR_QUESTIONS_ARE_VALID_IN_ZOLTAR_BUT_PLACEHOLDER_ORIGIN_SECURITY_POOLS_CURRENTLY_REQUIRE_AN_EXACT_BINARY_YES_NO_QUESTION
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
				description: UI_STRING_ASK_A_YES_OR_NO_QUESTION_THAT_CAN_BE_RESOLVED_FROM_ONE_PUBLIC_SOURCE_OF_TRUTH,
				steps: [UI_STRING_WRITE_THE_TITLE_SO_IT_CAN_BE_ANSWERED_WITH_YES_NO_OR_INVALID, UI_STRING_NAME_THE_EVENT_WINDOW_CLEARLY_IN_THE_TITLE_OR_DESCRIPTION, UI_STRING_USE_THE_DESCRIPTION_FOR_THE_EXACT_RESOLUTION_SOURCE_AND_EDGE_CASES],
			}
		case 'categorical':
			return {
				description: UI_STRING_LIST_THE_MUTUALLY_EXCLUSIVE_OUTCOMES_THAT_COULD_WIN_THIS_QUESTION,
				steps: [UI_STRING_KEEP_OUTCOMES_SHORT_AND_CLEARLY_DISTINCT_FROM_EACH_OTHER, UI_STRING_USE_THE_DESCRIPTION_TO_EXPLAIN_HOW_TIES_CANCELLATIONS_OR_EXCEPTIONS_RESOLVE, UI_STRING_ONLY_INCLUDE_OUTCOMES_THAT_A_RESOLVER_CAN_VERIFY_FROM_A_PUBLIC_SOURCE],
			}
		case 'scalar':
			return {
				description: UI_STRING_ASK_FOR_A_MEASURABLE_NUMBER_WITH_A_UNIT_RANGE_AND_INCREMENT_THAT_USERS_CAN_UNDERSTAND,
				steps: [UI_STRING_PICK_A_RANGE_THAT_COVERS_REALISTIC_ANSWERS_WITHOUT_BEING_OVERLY_BROAD, UI_STRING_SET_THE_ANSWER_UNIT_SO_USERS_KNOW_WHAT_THE_NUMBER_REPRESENTS, UI_STRING_USE_THE_DESCRIPTION_TO_EXPLAIN_ROUNDING_SOURCE_DATA_AND_INVALID_CONDITIONS],
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
			return normalizedOutcomes.length > 0 ? appendInvalidOutcomeLabelIfMissing(normalizedOutcomes) : [UI_STRING_ADD_AT_LEAST_2_OUTCOMES, UI_STRING_INVALID]
		}
		case 'scalar':
			return [UI_STRING_SCALAR, UI_STRING_INVALID]
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
	const selectedQuestionTitle = selectedQuestionDetails === undefined ? UI_STRING_QUESTION : getQuestionTitle(selectedQuestionDetails)
	const draftOutcomeItems = getDraftOutcomeLabels(marketForm, marketFormValidation.fieldErrors.categoricalOutcomes).map((outcome, outcomeIndex) => ({
		key: `${outcomeIndex}-${outcome}`,
		label: outcome,
		tone: isInvalidOutcomeLabel(outcome) ? ('warning' as const) : ('default' as const),
	}))
	const normalizedDescription = marketForm.description.trim()
	const draftDescription = normalizedDescription === '' ? UI_STRING_ADD_RESOLUTION_NOTES_EVIDENCE_SOURCES_AND_EDGE_CASE_HANDLING_SO_OTHER_USERS_KNOW_HOW_THIS_QUESTION_WILL_SETTLE : marketForm.description
	const draftTitle = marketForm.title.trim() === '' ? UI_STRING_ADD_A_CLEAR_QUESTION_TITLE : marketForm.title
	const draftQuestionContextLabel = normalizedDescription === '' ? UI_STRING_NEEDS_CONTEXT : UI_STRING_CONTEXT_PROVIDED
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
								{hasForked ? UI_STRING_ALREADY_FORKED : UI_STRING_USE_FOR_FORK}
							</button>
							<button className='secondary' onClick={() => onUseQuestionForPool(marketResult.questionId)} disabled={marketResult.marketType !== 'binary'}>
								{UI_STRING_CREATE_POOL_FROM_QUESTION}
							</button>
							<button className='secondary' onClick={onResetMarket}>
								{UI_STRING_CREATE_ANOTHER_QUESTION}
							</button>
						</div>
					}
				>
					<div className='question-preview-body'>
						{(() => {
							if (selectedQuestionDetails === undefined) {
								if (loadingZoltarQuestions)
									return (
										<span className='loading-value' role='status' aria-label={UI_STRING_LOADING_QUESTION_DETAILS}>
											<span className='spinner' aria-hidden='true' />
										</span>
									)

								return <p className='detail'>{UI_STRING_QUESTION_DETAILS_ARE_NOT_AVAILABLE}</p>
							}

							return <Question question={selectedQuestionDetails} showTitle={false} />
						})()}
						<MetricField label={UI_STRING_CREATION_TRANSACTION_HASH}>
							<TransactionHashLink hash={marketResult.createQuestionHash} />
						</MetricField>
						<p className='detail'>{getPoolEligibilityMessage(marketResult.marketType)}</p>
					</div>
				</EntityCard>
			)}

			{marketResult === undefined ? (
				<SectionBlock title={UI_STRING_CREATE_QUESTION} variant='plain' description={UI_STRING_DEFINE_THE_MARKET_TYPE_TIMING_AND_OUTCOMES_FOR_A_NEW_ZOLTAR_QUESTION}>
					<div className='workflow-summary-strip workflow-guide'>
						<div className='workflow-guide-intro'>
							<strong>{UI_STRING_WRITE_THE_QUESTION_THE_WAY_A_RESOLVER_WILL_READ_IT}</strong>
							<p className='detail'>{marketTypeGuidance.description}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>{UI_STRING_1_DEFINE_THE_EVENT_CLEARLY}</span>
							<span>{UI_STRING_2_EXPLAIN_HOW_IT_RESOLVES}</span>
							<span>{UI_STRING_3_SET_THE_TIMING_WINDOW}</span>
						</div>
					</div>

					<SectionBlock headingLevel={4} title={UI_STRING_QUESTION_TYPE_GUIDANCE} variant='embedded'>
						<ul className='requirements-checklist'>
							{marketTypeGuidance.steps.map(step => (
								<li key={step}>{step}</li>
							))}
						</ul>
					</SectionBlock>

					<div className='form-grid'>
						<div className='field'>
							<span>{UI_STRING_QUESTION_TYPE}</span>
							<EnumDropdown ariaLabel={UI_STRING_QUESTION_TYPE} options={MARKET_TYPE_OPTIONS} value={marketForm.marketType} onChange={marketType => onMarketFormChange({ marketType })} />
							<p className='field-help'>{marketTypeGuidance.description}</p>
						</div>

						<div className='field'>
							<label>
								<span>{UI_STRING_TITLE}</span>
								<FormInput
									aria-describedby={getFieldErrorDescribedBy('title', marketFormValidation.fieldErrors.title)}
									invalid={marketFormValidation.fieldErrors.title !== undefined}
									value={marketForm.title}
									onInput={event => onMarketFormChange({ title: event.currentTarget.value })}
									placeholder={UI_STRING_WILL_EVENT_X_HAPPEN}
								/>
							</label>
							<p className='field-help'>{UI_STRING_KEEP_THE_TITLE_SELF_CONTAINED_SO_USERS_CAN_UNDERSTAND_THE_EXACT_QUESTION_BEFORE_OPENING_DETAILS}</p>
							{renderFieldError('title', marketFormValidation.fieldErrors.title)}
						</div>

						<div className='field'>
							<label htmlFor='market-create-description'>
								<span>{UI_STRING_DESCRIPTION}</span>
							</label>
							<textarea id='market-create-description' value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder={UI_STRING_OPTIONAL_QUESTION_CONTEXT} />
							<p className='field-help'>{UI_STRING_INCLUDE_THE_RESOLUTION_SOURCE_ANY_EDGE_CASES_AND_WHAT_SHOULD_MAKE_THE_QUESTION_RESOLVE_AS_INVALID}</p>
						</div>

						<div className='field-row'>
							<div className='field'>
								<label>
									<span>{UI_STRING_START_TIME}</span>
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
									<span>{UI_STRING_END_TIME}</span>
									<FormInput aria-describedby={getFieldErrorDescribedBy('endTime', marketFormValidation.fieldErrors.endTime)} invalid={marketFormValidation.fieldErrors.endTime !== undefined} type='datetime-local' value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
								</label>
								{renderFieldError('endTime', marketFormValidation.fieldErrors.endTime)}
							</div>
						</div>
						<p className='field-help'>{UI_STRING_TIMES_USE_YOUR_BROWSER_TIMEZONE_LEAVE_START_TIME_BLANK_TO_ALLOW_ACTIVITY_IMMEDIATELY_AFTER_CREATION}</p>
						<p className='field-help'>{getPoolEligibilityMessage(marketForm.marketType)}</p>

						{marketForm.marketType === 'categorical' ? (
							<div className='field'>
								<span>{UI_STRING_OUTCOMES}</span>
								<div className='categorical-outcomes'>
									{marketForm.categoricalOutcomes.map((outcome, outcomeIndex) => (
										<div className='categorical-outcome-row' key={`categorical-outcome-${outcomeIndex}`}>
											<label className='field'>
												<span className='visually-hidden'>{`${UI_STRING_OUTCOME} ${outcomeIndex + 1}`}</span>
												<FormInput
													aria-describedby={getFieldErrorDescribedBy('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
													invalid={marketFormValidation.fieldErrors.categoricalOutcomes !== undefined}
													value={outcome}
													onInput={event => updateCategoricalOutcome(outcomeIndex, event.currentTarget.value)}
													placeholder={`${UI_STRING_OUTCOME} ${outcomeIndex + 1}`}
												/>
											</label>
											<button className='secondary categorical-outcome-remove' type='button' onClick={() => removeCategoricalOutcome(outcomeIndex)}>
												{UI_STRING_REMOVE}
											</button>
										</div>
									))}
								</div>
								{renderFieldError('categoricalOutcomes', marketFormValidation.fieldErrors.categoricalOutcomes)}
								<p className='field-help'>{UI_STRING_USE_CONCISE_MUTUALLY_EXCLUSIVE_LABELS_USERS_SHOULD_BE_ABLE_TO_TELL_AT_A_GLANCE_WHICH_OUTCOME_WOULD_WIN}</p>
								<button className='secondary categorical-outcome-add' type='button' onClick={addCategoricalOutcome}>
									{UI_STRING_ADD_OUTCOME}
								</button>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>{UI_STRING_SCALAR_MIN}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
											invalid={marketFormValidation.fieldErrors.scalarMin !== undefined}
											value={marketForm.scalarMin}
											onInput={event => onMarketFormChange({ scalarMin: event.currentTarget.value })}
											placeholder={UI_STRING_1}
										/>
									</label>
									{renderFieldError('scalarMin', marketFormValidation.fieldErrors.scalarMin)}
								</div>
								<label className='field'>
									<span>{UI_STRING_ANSWER_UNIT}</span>
									<FormInput value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder={UI_STRING_USD} />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<div className='field'>
									<label>
										<span>{UI_STRING_SCALAR_INCREMENT}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
											invalid={marketFormValidation.fieldErrors.scalarIncrement !== undefined}
											value={marketForm.scalarIncrement}
											onInput={event => onMarketFormChange({ scalarIncrement: event.currentTarget.value })}
											placeholder={UI_STRING_0_1}
										/>
									</label>
									{renderFieldError('scalarIncrement', marketFormValidation.fieldErrors.scalarIncrement)}
								</div>
								<div className='field'>
									<label>
										<span>{UI_STRING_SCALAR_MAX}</span>
										<FormInput
											aria-describedby={getFieldErrorDescribedBy('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
											invalid={marketFormValidation.fieldErrors.scalarMax !== undefined}
											value={marketForm.scalarMax}
											onInput={event => onMarketFormChange({ scalarMax: event.currentTarget.value })}
											placeholder={UI_STRING_10}
										/>
									</label>
									{renderFieldError('scalarMax', marketFormValidation.fieldErrors.scalarMax)}
								</div>
							</div>
						) : undefined}
						{marketForm.marketType === 'scalar' ? <p className='field-help'>{UI_STRING_SCALAR_QUESTIONS_SETTLE_TO_A_NUMERIC_RESULT_INSIDE_THE_RANGE_ABOVE_USE_A_UNIT_THAT_MATCHES_THE_PUBLIC_SOURCE_YOU_EXPECT_TO_CITE}</p> : undefined}

						{(() => {
							if (marketForm.marketType === 'scalar') {
								if (scalarCreatePreviewDetails === undefined) return <p className='detail'>{UI_STRING_ENTER_SCALAR_MIN_MAX_AND_INCREMENT_TO_PREVIEW_THE_TICK_SLIDER}</p>

								return <ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
							}

							return undefined
						})()}

						<SectionBlock headingLevel={4} title={UI_STRING_DRAFT_PREVIEW} variant='embedded' description={UI_STRING_DRAFT_PREVIEW_SHOWS_THE_LEVEL_OF_CLARITY_TRADERS_AND_REPORTERS_WILL_SEE_BEFORE_TRUSTING_THE_QUESTION}>
							<div className='question-draft-preview'>
								<div className='question-draft-preview-header'>
									<div className='question-summary-heading'>
										<strong>{draftTitle}</strong>
										<p className='detail'>{draftDescription}</p>
									</div>
									<div className='question-draft-preview-statuses' role='list' aria-label={UI_STRING_DRAFT_QUESTION_STATUS}>
										<span className='question-draft-preview-chip' role='listitem'>
											{marketForm.marketType}
										</span>
										<span className={`question-draft-preview-chip ${normalizedDescription === '' ? 'warning' : 'ok'}`} role='listitem'>
											{draftQuestionContextLabel}
										</span>
									</div>
								</div>
								<OutcomeChipRow items={draftOutcomeItems} />
								<div className='question-draft-preview-meta' role='list' aria-label={UI_STRING_DRAFT_QUESTION_SUMMARY}>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{UI_STRING_STARTS}</span>
										<strong>{marketForm.startTime.trim() === '' ? UI_STRING_IMMEDIATELY_AFTER_CREATION : marketForm.startTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{UI_STRING_ENDS}</span>
										<strong>{marketForm.endTime.trim() === '' ? UI_STRING_CHOOSE_AN_END_TIME : marketForm.endTime}</strong>
									</div>
									<div className='question-draft-preview-meta-item' role='listitem'>
										<span>{UI_STRING_RISK_CUE}</span>
										<strong>{normalizedDescription === '' ? UI_STRING_LOW_TRUST_UNTIL_CONTEXT_IS_ADDED : UI_STRING_CONTEXT_IS_PRESENT_FOR_REVIEW}</strong>
									</div>
								</div>
							</div>
						</SectionBlock>

						<div className='actions'>
							<TransactionActionButton
								idleLabel={UI_STRING_CREATE_QUESTION}
								pendingLabel={UI_STRING_CREATING_QUESTION_MARKET_CREATE_QUESTION_SECTION_CREATE_QUESTION_BUTTON_PENDING_LABEL}
								onClick={onCreateMarket}
								pending={marketCreating}
								availability={{
									disabled: accountAddress === undefined || !isMainnet || marketCreating || !marketFormValidation.isValid,
									reason: (() => {
										if (accountAddress === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_CREATING_A_QUESTION
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
