import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as tradingCopy from '../../../copy/trading.js';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js';
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js';
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { clampScalarTickIndex, formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from '@zoltar/ui-core-shared/lib/scalarOutcome.js';
function getTargetOutcomeBadgeLabel(target) {
    return target.exists ? tradingCopy.childDeployed : tradingCopy.childNotDeployed;
}
function renderTargetOutcomeRow(target, selected, disabled, onToggleOutcomeIndex) {
    return {
        details: (_jsxs(_Fragment, { children: [_jsx("span", { children: _jsx("strong", { children: selected ? commonCopy.selected : tradingCopy.notSelected }) }), _jsx("span", { children: _jsx("strong", { children: getTargetOutcomeBadgeLabel(target) }) })] })),
        disabled,
        key: target.outcomeIndex.toString(),
        label: target.label,
        onSelect: () => onToggleOutcomeIndex(target.outcomeIndex),
        selected,
    };
}
function getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex, scalarQuestion, selectedOutcomeIndexes) {
    return selectedOutcomeIndexes.map(outcomeIndex => {
        const childUniverse = childUniverseByOutcomeIndex.get(outcomeIndex.toString());
        const descriptor = getScalarOutcomeIndexDescriptor(scalarQuestion, outcomeIndex);
        const label = childUniverse?.outcomeLabel ?? (descriptor.kind === 'malformed' ? tradingCopy.formatMalformedOutcomeLabel(outcomeIndex.toString()) : formatScalarOutcomeIndexLabel(scalarQuestion, outcomeIndex));
        return {
            exists: childUniverse?.exists === true,
            label,
            outcomeIndex,
        };
    });
}
function renderTargetSection(title, children, actions) {
    return (_jsx(WorkflowSubsection, { badge: actions, className: 'share-migration-targets-section', title: title, children: children }));
}
export function ShareMigrationTargetsSection({ disabled, forkUniverse, onClearOutcomeIndexes, onSelectAllOutcomeIndexes, onToggleOutcomeIndex, selectedOutcomeIndexes, selectedOutcomeIndexSet }) {
    const [scalarOutcomeTick, setScalarOutcomeTick] = useState('0');
    const [scalarOutcomeInvalid, setScalarOutcomeInvalid] = useState(false);
    const childUniverseByOutcomeIndex = useMemo(() => new Map((forkUniverse?.childUniverses ?? []).map(child => [child.outcomeIndex.toString(), child])), [forkUniverse?.childUniverses]);
    const scalarQuestion = forkUniverse?.forkQuestionDetails !== undefined && forkUniverse.forkQuestionDetails.marketType === 'scalar' ? forkUniverse.forkQuestionDetails : undefined;
    const selectedScalarTick = BigInt(scalarOutcomeTick);
    useEffect(() => {
        if (scalarQuestion === undefined)
            return;
        const nextTick = clampScalarTickIndex(selectedScalarTick, scalarQuestion.numTicks).toString();
        if (nextTick === scalarOutcomeTick)
            return;
        setScalarOutcomeTick(nextTick);
    }, [scalarOutcomeTick, scalarQuestion, selectedScalarTick]);
    if (forkUniverse === undefined)
        return renderTargetSection(tradingCopy.targetChildUniverses, _jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: tradingCopy.loadingForkTargetUniverses }) }));
    if (!forkUniverse.hasForked)
        return renderTargetSection(tradingCopy.targetChildUniverses, _jsx("p", { className: 'detail', children: tradingCopy.childTargetsLockedReason }));
    if (forkUniverse.forkQuestionDetails === undefined)
        return renderTargetSection(tradingCopy.targetChildUniverses, _jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: tradingCopy.loadingForkQuestionDetails }) }));
    if (forkUniverse.forkQuestionDetails.marketType !== 'scalar') {
        const childUniverses = forkUniverse.childUniverses.map(child => ({
            exists: child.exists,
            label: child.outcomeLabel,
            outcomeIndex: child.outcomeIndex,
        }));
        const hasSelectableTargets = childUniverses.length > 0;
        return renderTargetSection(tradingCopy.targetChildUniverses, _jsx(OutcomeSelectionList, { emptyMessage: tradingCopy.targetChildUniversesEmpty, items: childUniverses.map(target => renderTargetOutcomeRow(target, selectedOutcomeIndexSet.has(target.outcomeIndex.toString()), disabled, onToggleOutcomeIndex)) }), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'quiet', type: 'button', onClick: onSelectAllOutcomeIndexes, disabled: disabled || !hasSelectableTargets, children: tradingCopy.selectAll }), _jsx("button", { className: 'quiet', type: 'button', onClick: onClearOutcomeIndexes, disabled: disabled || selectedOutcomeIndexes.length === 0, children: tradingCopy.clear })] }));
    }
    if (scalarQuestion === undefined)
        return renderTargetSection(tradingCopy.targetChildUniverses, _jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: tradingCopy.loadingScalarForkDetails }) }));
    const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, scalarQuestion.numTicks);
    const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString();
    const candidateOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(scalarQuestion, clampedSelectedScalarTick);
    const candidateOutcomeLabel = scalarOutcomeInvalid ? commonCopy.invalid : formatScalarOutcomeLabel(scalarQuestion, clampedSelectedScalarTick);
    const candidateSelected = selectedOutcomeIndexSet.has(candidateOutcomeIndex.toString());
    const selectedTargetOutcomes = getScalarSelectedTargetOutcomes(childUniverseByOutcomeIndex, scalarQuestion, selectedOutcomeIndexes);
    return renderTargetSection(tradingCopy.targetChildUniverses, _jsxs(_Fragment, { children: [_jsx(OutcomeSelectionList, { emptyMessage: tradingCopy.scalarTargetSelectionRequired, items: selectedTargetOutcomes.map(target => renderTargetOutcomeRow(target, true, disabled, onToggleOutcomeIndex)) }), _jsx(ScalarOutcomePicker, { action: _jsx("button", { className: 'secondary', type: 'button', onClick: () => onToggleOutcomeIndex(candidateOutcomeIndex), disabled: disabled, children: candidateSelected ? tradingCopy.removeTarget : tradingCopy.addTarget }), details: {
                    maxValueLabel: formatScalarOutcomeLabel(scalarQuestion, scalarQuestion.numTicks),
                    minValueLabel: formatScalarOutcomeLabel(scalarQuestion, 0n),
                    numTicks: scalarQuestion.numTicks,
                }, disabled: disabled, isInvalid: scalarOutcomeInvalid, label: tradingCopy.selectScalarTarget, onInvalidChange: setScalarOutcomeInvalid, onSelectedTickChange: setScalarOutcomeTick, selectedOutcomeLabel: candidateOutcomeLabel, selectedTick: clampedScalarOutcomeTick, selectedTickLabel: scalarOutcomeInvalid ? commonCopy.invalid : commonCopy.formatSelectedTickLabel(clampedScalarOutcomeTick, scalarQuestion.numTicks.toString()) })] }), _jsx("button", { className: 'quiet', type: 'button', onClick: onClearOutcomeIndexes, disabled: disabled || selectedOutcomeIndexes.length === 0, children: tradingCopy.clear }));
}
//# sourceMappingURL=ShareMigrationTargetsSection.js.map