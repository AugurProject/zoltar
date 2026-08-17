import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { LoadingText } from '../components/LoadingText.js';
import { IdentifierValue } from '../components/IdentifierValue.js';
import { MetricGrid } from '../components/MetricGrid.js';
import { MetricField } from '../components/MetricField.js';
import { OutcomeChipRow } from './OutcomeChipRow.js';
import { TimestampValue } from '../components/TimestampValue.js';
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '../lib/outcomeLabels.js';
import { getMarketTypeLabel } from '../lib/marketType.js';
import * as marketTypeCopy from '../copy/marketType.js';
import { formatScalarDisplayValue } from '../lib/scalarOutcome.js';
export function getQuestionTitle(question) {
    return question.title.trim() === '' ? commonCopy.untitledQuestion : question.title;
}
function getQuestionDescription(question) {
    // Empty question descriptions are intentionally silent in the UI. These screens are read-only,
    // and users cannot add resolution notes from here.
    return question.description.trim();
}
function getDisplayedOutcomes(question) {
    const outcomes = question.outcomeLabels.length === 0 ? [marketTypeCopy.scalar] : question.outcomeLabels;
    return appendInvalidOutcomeLabelIfMissing(outcomes);
}
function getDisplayRange(question) {
    const displayRange = `${formatScalarDisplayValue(question.displayValueMin)} to ${formatScalarDisplayValue(question.displayValueMax)}`;
    return question.answerUnit === '' ? displayRange : `${displayRange} ${question.answerUnit}`;
}
export function getQuestionSummaryFields(question) {
    const fields = [
        { kind: 'text', label: commonCopy.questionType, value: getMarketTypeLabel(question.marketType) },
        { kind: 'identifier', label: commonCopy.questionId, value: question.questionId },
        { kind: 'timestamp', label: commonCopy.created, value: question.createdAt },
        { kind: 'timestamp', label: commonCopy.endTime, value: question.endTime },
        { kind: 'text', label: commonCopy.outcomes, value: getDisplayedOutcomes(question).join(', ') },
    ];
    if (question.marketType === 'scalar')
        fields.push({ kind: 'text', label: commonCopy.ticks, value: question.numTicks.toString() }, { kind: 'text', label: commonCopy.displayRange, value: getDisplayRange(question) }, { kind: 'text', label: commonCopy.answerUnit, value: question.answerUnit === '' ? commonCopy.none : question.answerUnit });
    return fields;
}
function renderQuestionSummaryField(field) {
    if (field.kind === 'identifier')
        return (_jsx(MetricField, { label: field.label, children: _jsx(IdentifierValue, { value: field.value }) }, field.label));
    if (field.kind === 'timestamp')
        return (_jsx(MetricField, { label: field.label, children: _jsx(TimestampValue, { timestamp: field.value }) }, field.label));
    return (_jsx(MetricField, { label: field.label, children: field.value }, field.label));
}
export function Question({ className = '', loading = false, question, showTitle = true, variant = 'full' }) {
    if (loading || question === undefined)
        return (_jsx("div", { className: `question-summary ${className}`, children: _jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: commonCopy.questionDetailsLoadingLabel }) }) }));
    const title = getQuestionTitle(question);
    const description = getQuestionDescription(question);
    const showHeading = showTitle || description !== '';
    const descriptionNode = description === '' ? undefined : _jsx("p", { className: 'detail', children: description });
    const summaryFields = getQuestionSummaryFields(question);
    const outcomeItems = getDisplayedOutcomes(question).map(outcome => ({
        key: outcome,
        label: outcome,
        tone: isInvalidOutcomeLabel(outcome) ? 'warning' : 'default',
    }));
    const scalarFields = question.marketType !== 'scalar'
        ? []
        : [
            {
                label: commonCopy.ticks,
                value: question.numTicks.toString(),
            },
            {
                label: commonCopy.displayRange,
                value: getDisplayRange(question),
            },
        ];
    if (variant === 'preview')
        return (_jsxs("div", { className: `question-summary question-summary-preview ${className}`.trim(), children: [!showHeading ? undefined : (_jsxs("div", { className: 'question-summary-heading', children: [showTitle ? _jsx("strong", { children: title }) : null, descriptionNode] })), _jsx(OutcomeChipRow, { items: outcomeItems }), _jsxs("div", { className: 'question-preview-timeline', role: 'list', "aria-label": commonCopy.questionTimeline, children: [_jsxs("div", { className: 'question-preview-timeline-item', role: 'listitem', children: [_jsx("span", { className: 'question-preview-timeline-label', children: commonCopy.created }), _jsx("strong", { className: 'question-preview-timeline-value', children: _jsx(TimestampValue, { timestamp: question.createdAt }) })] }), _jsxs("div", { className: 'question-preview-timeline-item', role: 'listitem', children: [_jsx("span", { className: 'question-preview-timeline-label', children: commonCopy.endTime }), _jsx("strong", { className: 'question-preview-timeline-value', children: _jsx(TimestampValue, { timestamp: question.endTime }) })] })] }), _jsxs("div", { className: 'question-preview-meta', children: [_jsxs("div", { className: 'question-preview-meta-item', children: [_jsx("span", { className: 'question-preview-meta-label', children: commonCopy.questionId }), _jsx("strong", { children: _jsx(IdentifierValue, { value: question.questionId }) })] }), scalarFields.map(field => (_jsxs("div", { className: 'question-preview-meta-item', children: [_jsx("span", { className: 'question-preview-meta-label', children: field.label }), _jsx("strong", { children: field.value })] }, field.label)))] })] }));
    return (_jsxs("div", { className: `question-summary ${className}`, children: [showTitle ? (_jsxs("div", { className: 'question-summary-heading', children: [_jsx("strong", { children: title }), descriptionNode] })) : (descriptionNode), _jsx(MetricGrid, { variant: 'question', children: summaryFields.map(renderQuestionSummaryField) })] }));
}
//# sourceMappingURL=Question.js.map