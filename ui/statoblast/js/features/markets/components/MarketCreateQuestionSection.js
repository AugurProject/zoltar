import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js';
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { OutcomeChipRow } from '@zoltar/ui-core-shared/components/OutcomeChipRow.js';
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js';
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { getMarketCreationOutcomeLabels, hasMarketEndTimePassed, validateMarketForm } from '../lib/marketCreation.js';
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js';
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '@zoltar/ui-core-shared/lib/outcomeLabels.js';
import { clampScalarTickIndex, parseScalarFormInputs } from '@zoltar/ui-core-shared/lib/scalarOutcome.js';
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js';
import { ScalarCreatePreview } from './ScalarCreatePreview.js';
import { getWrongNetworkMessage } from '@zoltar/ui-core-shared/lib/network.js';
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js';
const MARKET_TYPE_OPTIONS = [
    { value: 'binary', label: marketCopy.binary },
    { value: 'categorical', label: marketCopy.categorical },
    { value: 'scalar', label: marketCopy.scalar },
];
function getScalarCreatePreviewDetails(marketForm, scalarInputsValid) {
    if (marketForm.marketType !== 'scalar')
        return undefined;
    if (!scalarInputsValid)
        return undefined;
    return {
        answerUnit: marketForm.answerUnit.trim(),
        ...parseScalarFormInputs(marketForm),
    };
}
function getPoolEligibilityMessage(marketType) {
    if (marketType === 'binary')
        return undefined;
    if (marketType === 'categorical')
        return marketCopy.categoricalPoolCompatibilityDetail;
    return marketCopy.scalarPoolCompatibilityDetail;
}
function getFieldErrorId(field) {
    return `market-create-${field}-error`;
}
function getFieldErrorDescribedBy(field, message) {
    return message === undefined ? undefined : getFieldErrorId(field);
}
function renderFieldError(field, message) {
    if (message === undefined)
        return undefined;
    return (_jsx("p", { className: 'field-error', id: getFieldErrorId(field), children: message }));
}
function renderRequiredFieldLabel(label) {
    return (_jsxs(_Fragment, { children: [label, ' ', _jsx("span", { className: 'required-field-indicator', "aria-hidden": 'true', children: "*" }), _jsxs("span", { className: 'visually-hidden', children: [" (", commonCopy.required, ")"] })] }));
}
function getMarketTypeGuidance(marketType) {
    switch (marketType) {
        case 'binary':
            return marketCopy.binaryQuestionDescription;
        case 'categorical':
            return marketCopy.categoricalOutcomesGuidance;
        case 'scalar':
            return marketCopy.scalarQuestionDescription;
        default:
            return assertNever(marketType);
    }
}
function getDraftOutcomeLabels(marketForm, categoricalOutcomesError) {
    switch (marketForm.marketType) {
        case 'binary':
            return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(marketForm));
        case 'categorical': {
            if (categoricalOutcomesError === undefined) {
                return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(marketForm));
            }
            const normalizedOutcomes = marketForm.categoricalOutcomes.map(outcome => outcome.trim()).filter(outcome => outcome !== '');
            return normalizedOutcomes.length > 0 ? appendInvalidOutcomeLabelIfMissing(normalizedOutcomes) : [marketCopy.minimumOutcomeCountReason, commonCopy.invalid];
        }
        case 'scalar':
            return [marketCopy.scalar, commonCopy.invalid];
        default:
            return assertNever(marketForm.marketType);
    }
}
export function MarketCreateQuestionSection({ accountAddress, hasForked, isOnActiveAppChain, loadingZoltarQuestions, marketCreating, marketError, marketForm, marketResult, onCreateMarket, onMarketFormChange, onOpenForkTab, onResetMarket, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestions, }) {
    const [scalarCreatePreviewTick, setScalarCreatePreviewTick] = useState('0');
    const [reviewingQuestion, setReviewingQuestion] = useState(false);
    const currentTimestamp = useChainTimestamp();
    const [touchedFields, setTouchedFields] = useState(new Set());
    const selectedQuestionDetails = useMemo(() => (marketResult === undefined ? undefined : zoltarQuestions.find(question => question.questionId === marketResult.questionId)), [marketResult?.questionId, zoltarQuestions]);
    const marketFormValidation = validateMarketForm(marketForm);
    const marketTypeGuidance = getMarketTypeGuidance(marketForm.marketType);
    const scalarInputsValid = marketFormValidation.fieldErrors.scalarIncrement === undefined && marketFormValidation.fieldErrors.scalarMax === undefined && marketFormValidation.fieldErrors.scalarMin === undefined;
    const scalarCreatePreviewDetails = getScalarCreatePreviewDetails(marketForm, scalarInputsValid);
    const selectedQuestionTitle = selectedQuestionDetails === undefined ? commonCopy.question : getQuestionTitle(selectedQuestionDetails);
    const draftOutcomeItems = getDraftOutcomeLabels(marketForm, marketFormValidation.fieldErrors.categoricalOutcomes).map((outcome, outcomeIndex) => ({
        key: `${outcomeIndex}-${outcome}`,
        label: outcome,
        tone: isInvalidOutcomeLabel(outcome) ? 'warning' : 'default',
    }));
    const normalizedDescription = marketForm.description.trim();
    const draftDescription = normalizedDescription === '' ? undefined : marketForm.description;
    const draftTitle = marketForm.title.trim() === '' ? marketCopy.untitledQuestion : marketForm.title;
    const markFieldTouched = (field) => setTouchedFields(current => new Set([...current, field]));
    const getVisibleFieldError = (field) => (touchedFields.has(field) ? marketFormValidation.fieldErrors[field] : undefined);
    const timingRelationshipError = marketFormValidation.fieldErrors.startTime !== undefined && marketFormValidation.fieldErrors.startTime === marketFormValidation.fieldErrors.endTime && (touchedFields.has('startTime') || touchedFields.has('endTime')) ? marketFormValidation.fieldErrors.startTime : undefined;
    const startTimeError = timingRelationshipError ?? getVisibleFieldError('startTime');
    const endTimeError = timingRelationshipError ?? getVisibleFieldError('endTime');
    const timingRelationshipErrorId = 'market-create-timing-error';
    const hasVisibleValidationError = timingRelationshipError !== undefined || Array.from(touchedFields).some(field => marketFormValidation.fieldErrors[field] !== undefined);
    const canCreateQuestion = accountAddress !== undefined && isOnActiveAppChain && !marketCreating && marketFormValidation.isValid;
    const showEndedQuestionWarning = marketFormValidation.fieldErrors.endTime === undefined && hasMarketEndTimePassed(marketForm, currentTimestamp);
    useEffect(() => {
        if (scalarCreatePreviewDetails === undefined)
            return;
        const clampedTick = clampScalarTickIndex(BigInt(scalarCreatePreviewTick), scalarCreatePreviewDetails.numTicks).toString();
        if (clampedTick === scalarCreatePreviewTick)
            return;
        setScalarCreatePreviewTick(clampedTick);
    }, [scalarCreatePreviewDetails?.numTicks, scalarCreatePreviewTick]);
    useEffect(() => {
        setReviewingQuestion(false);
    }, [marketForm]);
    const updateCategoricalOutcome = (outcomeIndex, value) => {
        onMarketFormChange({
            categoricalOutcomes: marketForm.categoricalOutcomes.map((outcome, index) => (index === outcomeIndex ? value : outcome)),
        });
    };
    const addCategoricalOutcome = () => {
        onMarketFormChange({
            categoricalOutcomes: [...marketForm.categoricalOutcomes, ''],
        });
    };
    const removeCategoricalOutcome = (outcomeIndex) => {
        onMarketFormChange({
            categoricalOutcomes: marketForm.categoricalOutcomes.filter((_, index) => index !== outcomeIndex),
        });
    };
    return (_jsxs(_Fragment, { children: [marketResult === undefined ? undefined : (_jsx(EntityCard, { title: selectedQuestionTitle, actions: _jsxs("div", { className: 'actions', children: [_jsx("button", { "aria-label": hasForked ? marketCopy.formatAlreadyForkedLabel(selectedQuestionTitle, marketResult.questionId) : marketCopy.formatUseForForkLabel(selectedQuestionTitle, marketResult.questionId), className: 'secondary', disabled: hasForked, onClick: () => {
                                if (hasForked)
                                    return;
                                onUseQuestionForFork(marketResult.questionId);
                                onOpenForkTab();
                            }, children: hasForked ? marketCopy.alreadyForked : marketCopy.useForFork }), _jsx("button", { "aria-label": marketCopy.formatCreatePoolFromQuestionLabel(selectedQuestionTitle, marketResult.questionId), className: 'secondary', onClick: () => onUseQuestionForPool(marketResult.questionId), disabled: marketResult.marketType !== 'binary', children: marketCopy.createPoolFromQuestion }), _jsx("button", { className: 'secondary', onClick: onResetMarket, children: marketCopy.createAnotherQuestion })] }), children: _jsxs("div", { className: 'question-preview-body', children: [(() => {
                            if (selectedQuestionDetails === undefined) {
                                if (loadingZoltarQuestions)
                                    return (_jsx("span", { className: 'loading-value', role: 'status', "aria-label": marketCopy.loadingQuestionDetails, children: _jsx("span", { className: 'spinner', "aria-hidden": 'true' }) }));
                                return _jsx("p", { className: 'detail', children: marketCopy.questionDetailsUnavailable });
                            }
                            return _jsx(Question, { question: selectedQuestionDetails, showTitle: false });
                        })(), _jsx(MetricField, { label: marketCopy.creationTransactionHash, children: _jsx(TransactionHashLink, { hash: marketResult.createQuestionHash }) }), getPoolEligibilityMessage(marketResult.marketType) === undefined ? undefined : _jsx("p", { className: 'detail', children: getPoolEligibilityMessage(marketResult.marketType) })] }) })), marketResult === undefined ? (_jsx(SectionBlock, { title: commonCopy.createQuestion, variant: 'plain', children: _jsxs("form", { "aria-label": commonCopy.createQuestion, className: 'form-grid', noValidate: true, onSubmit: event => {
                        event.preventDefault();
                        if (!canCreateQuestion)
                            return;
                        if (!reviewingQuestion) {
                            setReviewingQuestion(true);
                            return;
                        }
                        onCreateMarket();
                    }, children: [_jsxs("div", { className: 'question-create-editor', hidden: reviewingQuestion, children: [_jsx("p", { className: 'field-help', children: marketCopy.requiredFieldsNote }), _jsxs("div", { className: 'field', children: [_jsx("span", { children: marketCopy.questionType }), _jsx(EnumDropdown, { ariaLabel: marketCopy.questionType, options: MARKET_TYPE_OPTIONS, value: marketForm.marketType, onChange: marketType => onMarketFormChange({ marketType }) }), _jsx("p", { className: 'field-help', children: marketTypeGuidance })] }), _jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: renderRequiredFieldLabel(marketCopy.title) }), _jsx(FormInput, { "aria-label": marketCopy.title, "aria-describedby": getFieldErrorDescribedBy('title', getVisibleFieldError('title')), invalid: getVisibleFieldError('title') !== undefined, value: marketForm.title, onBlur: () => markFieldTouched('title'), onInput: event => onMarketFormChange({ title: event.currentTarget.value }), placeholder: marketCopy.questionTitlePlaceholder, required: true })] }), renderFieldError('title', getVisibleFieldError('title'))] }), _jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'market-create-description', children: _jsx("span", { children: marketCopy.description }) }), _jsx("textarea", { id: 'market-create-description', value: marketForm.description, onInput: event => onMarketFormChange({ description: event.currentTarget.value }), placeholder: marketCopy.optionalQuestionContext }), _jsx("p", { className: 'field-help', children: marketCopy.resolutionSourceHelpText })] }), _jsxs("div", { className: 'field-row', children: [_jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: marketCopy.startTime }), _jsx(FormInput, { "aria-describedby": timingRelationshipError === undefined ? getFieldErrorDescribedBy('startTime', startTimeError) : timingRelationshipErrorId, invalid: startTimeError !== undefined, type: 'datetime-local', value: marketForm.startTime, onBlur: () => markFieldTouched('startTime'), onInput: event => onMarketFormChange({ startTime: event.currentTarget.value }) })] }), timingRelationshipError === undefined ? renderFieldError('startTime', startTimeError) : undefined] }), _jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: renderRequiredFieldLabel(marketCopy.endTime) }), _jsx(FormInput, { "aria-label": marketCopy.endTime, "aria-describedby": timingRelationshipError === undefined ? getFieldErrorDescribedBy('endTime', endTimeError) : timingRelationshipErrorId, invalid: endTimeError !== undefined, type: 'datetime-local', value: marketForm.endTime, required: true, onBlur: () => markFieldTouched('endTime'), onInput: event => onMarketFormChange({ endTime: event.currentTarget.value }) })] }), timingRelationshipError === undefined ? renderFieldError('endTime', endTimeError) : undefined] })] }), timingRelationshipError === undefined ? undefined : (_jsx("p", { className: 'field-error', id: timingRelationshipErrorId, children: timingRelationshipError })), _jsx("p", { className: 'field-help', children: marketCopy.questionTimingHelpText }), getPoolEligibilityMessage(marketForm.marketType) === undefined ? undefined : _jsx("p", { className: 'field-help', children: getPoolEligibilityMessage(marketForm.marketType) }), marketForm.marketType === 'categorical' ? (_jsxs("div", { className: 'field', role: 'group', "aria-labelledby": 'market-create-outcomes-label', children: [_jsx("span", { id: 'market-create-outcomes-label', children: renderRequiredFieldLabel(marketCopy.outcomes) }), _jsx("div", { className: 'categorical-outcomes', children: marketForm.categoricalOutcomes.map((outcome, outcomeIndex) => (_jsxs("div", { className: 'categorical-outcome-row', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { className: 'visually-hidden', children: `${commonCopy.outcome} ${outcomeIndex + 1}` }), _jsx(FormInput, { "aria-describedby": getFieldErrorDescribedBy('categoricalOutcomes', getVisibleFieldError('categoricalOutcomes')), invalid: getVisibleFieldError('categoricalOutcomes') !== undefined, required: outcomeIndex < 2, value: outcome, onBlur: () => markFieldTouched('categoricalOutcomes'), onInput: event => updateCategoricalOutcome(outcomeIndex, event.currentTarget.value), placeholder: `${commonCopy.outcome} ${outcomeIndex + 1}` })] }), _jsx("button", { className: 'secondary categorical-outcome-remove', type: 'button', onClick: () => removeCategoricalOutcome(outcomeIndex), children: marketCopy.remove })] }, `categorical-outcome-${outcomeIndex}`))) }), renderFieldError('categoricalOutcomes', getVisibleFieldError('categoricalOutcomes')), _jsx("p", { className: 'field-help', children: marketCopy.categoricalOutcomeLabelsHelpText }), _jsx("button", { className: 'secondary categorical-outcome-add', type: 'button', onClick: addCategoricalOutcome, children: marketCopy.addOutcome })] })) : undefined, marketForm.marketType === 'scalar' ? (_jsxs("div", { className: 'field-row', children: [_jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: renderRequiredFieldLabel(marketCopy.scalarMin) }), _jsx(FormInput, { "aria-label": marketCopy.scalarMin, "aria-describedby": getFieldErrorDescribedBy('scalarMin', getVisibleFieldError('scalarMin')), invalid: getVisibleFieldError('scalarMin') !== undefined, value: marketForm.scalarMin, onBlur: () => markFieldTouched('scalarMin'), onInput: event => onMarketFormChange({ scalarMin: event.currentTarget.value }), placeholder: marketCopy.scalarMinExample, required: true })] }), renderFieldError('scalarMin', getVisibleFieldError('scalarMin'))] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: marketCopy.answerUnit }), _jsx(FormInput, { value: marketForm.answerUnit, onInput: event => onMarketFormChange({ answerUnit: event.currentTarget.value }), placeholder: marketCopy.usd })] })] })) : undefined, marketForm.marketType === 'scalar' ? (_jsxs("div", { className: 'field-row', children: [_jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: renderRequiredFieldLabel(marketCopy.scalarIncrement) }), _jsx(FormInput, { "aria-label": marketCopy.scalarIncrement, "aria-describedby": getFieldErrorDescribedBy('scalarIncrement', getVisibleFieldError('scalarIncrement')), invalid: getVisibleFieldError('scalarIncrement') !== undefined, value: marketForm.scalarIncrement, onBlur: () => markFieldTouched('scalarIncrement'), onInput: event => onMarketFormChange({ scalarIncrement: event.currentTarget.value }), placeholder: marketCopy.scalarIncrementExample, required: true })] }), renderFieldError('scalarIncrement', getVisibleFieldError('scalarIncrement'))] }), _jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: renderRequiredFieldLabel(marketCopy.scalarMax) }), _jsx(FormInput, { "aria-label": marketCopy.scalarMax, "aria-describedby": getFieldErrorDescribedBy('scalarMax', getVisibleFieldError('scalarMax')), invalid: getVisibleFieldError('scalarMax') !== undefined, value: marketForm.scalarMax, onBlur: () => markFieldTouched('scalarMax'), onInput: event => onMarketFormChange({ scalarMax: event.currentTarget.value }), placeholder: marketCopy.scalarMaxExample, required: true })] }), renderFieldError('scalarMax', getVisibleFieldError('scalarMax'))] })] })) : undefined, marketForm.marketType === 'scalar' ? _jsx("p", { className: 'field-help', children: marketCopy.scalarResolutionHelpText }) : undefined, showEndedQuestionWarning ? (_jsx(WarningSurface, { ariaLive: 'polite', role: 'status', surface: 'flat', variant: 'compact', children: _jsx("p", { children: marketCopy.endedQuestionWarning }) })) : undefined, (() => {
                                    if (marketForm.marketType === 'scalar') {
                                        if (scalarCreatePreviewDetails === undefined)
                                            return _jsx("p", { className: 'detail', children: marketCopy.scalarPreviewInputHint });
                                        return _jsx(ScalarCreatePreview, { details: scalarCreatePreviewDetails, selectedTick: scalarCreatePreviewTick, onSelectedTickChange: setScalarCreatePreviewTick });
                                    }
                                    return undefined;
                                })(), _jsx(SectionBlock, { headingLevel: 4, title: marketCopy.draftPreview, variant: 'embedded', children: _jsxs("div", { className: 'question-draft-preview', children: [_jsxs("div", { className: 'question-draft-preview-header', children: [_jsxs("div", { className: 'question-summary-heading', children: [_jsx("strong", { children: draftTitle }), draftDescription === undefined ? undefined : _jsx("p", { className: 'detail', children: draftDescription })] }), _jsx("span", { className: 'question-draft-preview-chip', children: getMarketTypeLabel(marketForm.marketType) })] }), _jsx(OutcomeChipRow, { items: draftOutcomeItems }), _jsxs("div", { className: 'question-draft-preview-meta', role: 'list', "aria-label": marketCopy.draftQuestionSummary, children: [_jsxs("div", { className: 'question-draft-preview-meta-item', role: 'listitem', children: [_jsx("span", { children: commonCopy.starts }), _jsx("strong", { children: marketForm.startTime.trim() === '' ? marketCopy.immediatelyAfterCreation : marketForm.startTime })] }), _jsxs("div", { className: 'question-draft-preview-meta-item', role: 'listitem', children: [_jsx("span", { children: commonCopy.ends }), _jsx("strong", { children: marketForm.endTime.trim() === '' ? marketCopy.endTimeRequired : marketForm.endTime })] })] })] }) })] }), reviewingQuestion ? (_jsx(TransactionReview, { context: [
                                { label: marketCopy.questionType, value: getMarketTypeLabel(marketForm.marketType) },
                                { label: transactionReviewCopy.network, value: _jsx(TransactionNetworkValue, {}) },
                            ], details: marketForm.marketType === 'scalar'
                                ? [
                                    { label: marketCopy.scalarMin, value: marketForm.scalarMin.trim() },
                                    { label: marketCopy.scalarMax, value: marketForm.scalarMax.trim() },
                                    { label: marketCopy.scalarIncrement, value: marketForm.scalarIncrement.trim() },
                                    { label: marketCopy.answerUnit, value: marketForm.answerUnit.trim() === '' ? commonCopy.none : marketForm.answerUnit.trim() },
                                ]
                                : [], primary: [
                                { label: commonCopy.question, value: draftTitle },
                                { label: marketCopy.outcomes, value: getDraftOutcomeLabels(marketForm, marketFormValidation.fieldErrors.categoricalOutcomes).join(' / ') },
                                { label: marketCopy.endTime, value: marketForm.endTime },
                            ], risks: [marketCopy.questionCreationConsequence, ...(showEndedQuestionWarning ? [marketCopy.endedQuestionWarning] : [])] })) : undefined, _jsxs("div", { className: 'actions', children: [reviewingQuestion ? (_jsx("button", { className: 'secondary', type: 'button', onClick: () => setReviewingQuestion(false), disabled: marketCreating, children: marketCopy.backToQuestion })) : undefined, _jsx(TransactionActionButton, { idleLabel: reviewingQuestion ? commonCopy.createQuestionAction : marketCopy.reviewQuestion, pendingLabel: marketCopy.createQuestionPendingLabel, onClick: () => undefined, pending: marketCreating, type: 'submit', availability: {
                                        disabled: !canCreateQuestion,
                                        reason: (() => {
                                            if (accountAddress === undefined)
                                                return marketCopy.questionCreationWalletRequired;
                                            if (!isOnActiveAppChain)
                                                return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
                                            if (marketFormValidation.isValid)
                                                return undefined;
                                            if (timingRelationshipError !== undefined)
                                                return marketCopy.formatInvalidQuestionFieldsReason(timingRelationshipError);
                                            return hasVisibleValidationError ? (marketFormValidation.notice ?? marketCopy.completeRequiredQuestionFields) : marketCopy.completeRequiredQuestionFields;
                                        })(),
                                    } })] })] }) })) : undefined, _jsx(ErrorNotice, { message: marketError })] }));
}
//# sourceMappingURL=MarketCreateQuestionSection.js.map