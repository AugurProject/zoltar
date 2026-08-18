import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js';
import { useEffect, useState } from 'preact/hooks';
import { ChildUniversesSection, ChildUniverseStatusBadge } from '@zoltar/ui-zoltar/features/universes/components/ChildUniversesSection.js';
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js';
import { ChildUniverseDetails } from '@zoltar/ui-zoltar/features/universes/components/ChildUniverseDetails.js';
import { ChildUniverseDeploymentModal } from '@zoltar/ui-zoltar/features/universes/components/ChildUniverseDeploymentModal.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js';
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js';
import { clampScalarTickIndex, formatScalarOutcomeLabel, getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js';
import { getWrongNetworkMessage } from '@zoltar/ui-core-shared/lib/network.js';
export function ScalarDeploymentSection({ accountAddress, childUniverses, hasForked, isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex, questionDetails, zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex }) {
    const [scalarOutcomeTick, setScalarOutcomeTick] = useState('0');
    const [scalarOutcomeInvalid, setScalarOutcomeInvalid] = useState(false);
    const [scalarDeployError, setScalarDeployError] = useState(undefined);
    const [deployModalOpen, setDeployModalOpen] = useState(false);
    const questionNumTicks = questionDetails?.numTicks;
    useEffect(() => {
        if (questionNumTicks === undefined)
            return;
        const selectedScalarTick = BigInt(scalarOutcomeTick);
        const nextTick = clampScalarTickIndex(selectedScalarTick, questionNumTicks).toString();
        if (nextTick === scalarOutcomeTick)
            return;
        setScalarOutcomeTick(nextTick);
    }, [questionNumTicks, scalarOutcomeTick]);
    if (questionDetails === undefined)
        return (_jsx(WorkflowSubsection, { title: marketCopy.childUniverses, children: _jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: marketCopy.loadingScalarRange }) }) }));
    const selectedScalarTick = BigInt(scalarOutcomeTick);
    const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks);
    const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString();
    const selectedScalarOutcomeLabel = scalarOutcomeInvalid ? commonCopy.invalid : formatScalarOutcomeLabel(questionDetails, clampedSelectedScalarTick);
    const selectedScalarOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(questionDetails, clampedSelectedScalarTick);
    const selectedScalarChild = childUniverses.find(child => child.outcomeIndex === selectedScalarOutcomeIndex);
    const selectedScalarChildExists = selectedScalarChild?.exists === true;
    const canDeployScalarChild = accountAddress !== undefined && isOnActiveAppChain && hasForked && !selectedScalarChildExists;
    const deployReason = (() => {
        if (accountAddress === undefined)
            return marketCopy.childDeploymentWalletRequiredReason;
        if (!isOnActiveAppChain)
            return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
        return (() => {
            if (!hasForked)
                return marketCopy.childUniversesNotForkedReason;
            if (selectedScalarChildExists)
                return marketCopy.childUniverseDeployedReason;
            return scalarDeployError;
        })();
    })();
    const scalarDeployPending = zoltarChildUniversePendingOutcomeIndex === selectedScalarOutcomeIndex;
    const scalarDeployRequirements = [
        { key: 'forked', label: marketCopy.universeIsForked, resolved: hasForked, ...(hasForked ? {} : { detail: marketCopy.childUniversesNotForkedReason }) },
        { key: 'wallet', label: marketCopy.walletConnected, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: marketCopy.childDeploymentWalletRequiredReason }) },
        { key: 'exists', label: marketCopy.childUniverseNotAlreadyDeployed, resolved: !selectedScalarChildExists, ...(selectedScalarChildExists ? { detail: marketCopy.childUniverseDeployedReason } : {}) },
    ];
    return (_jsxs(WorkflowSubsection, { badge: _jsx("span", { className: 'detail', children: marketCopy.scalarChildDeploymentHint }), title: marketCopy.childUniverses, children: [_jsx(ChildUniversesSection, { childUniverses: childUniverses, emptyMessage: marketCopy.deployedChildUniversesEmpty, headerTitle: marketCopy.existingChildUniverses, renderBadge: child => _jsx(ChildUniverseStatusBadge, { child: child }), renderBody: child => _jsx(ChildUniverseDetails, { accountAddress: accountAddress, child: child, isSupportedChain: isOnActiveAppChain }), surface: 'flat' }), _jsx(ScalarOutcomePicker, { action: _jsx(ActionLauncherButton, { idleLabel: (() => {
                        if (selectedScalarChildExists)
                            return commonCopy.deployed;
                        if (scalarOutcomeInvalid)
                            return marketCopy.createInvalidUniverse;
                        return marketCopy.createChildUniverse;
                    })(), pendingLabel: commonCopy.opening, onClick: () => {
                        try {
                            setScalarDeployError(undefined);
                            setDeployModalOpen(true);
                        }
                        catch (error) {
                            setScalarDeployError(error instanceof Error ? error.message : marketCopy.selectedTickInvalidError);
                        }
                    }, pending: false, tone: 'secondary', availability: { disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }, showDisabledReason: true }), details: {
                    maxValueLabel: formatScalarOutcomeLabel(questionDetails, questionDetails.numTicks),
                    minValueLabel: formatScalarOutcomeLabel(questionDetails, 0n),
                    numTicks: questionDetails.numTicks,
                }, isInvalid: scalarOutcomeInvalid, label: marketCopy.selectChildUniverse, onInvalidChange: invalid => {
                    setScalarDeployError(undefined);
                    setScalarOutcomeInvalid(invalid);
                }, onSelectedTickChange: tick => {
                    setScalarDeployError(undefined);
                    setScalarOutcomeTick(tick);
                }, selectedOutcomeLabel: selectedScalarOutcomeLabel, selectedTick: clampedScalarOutcomeTick, selectedTickLabel: scalarOutcomeInvalid ? commonCopy.invalid : commonCopy.formatSelectedTickLabel(clampedScalarOutcomeTick, questionDetails.numTicks.toString()) }), _jsx(ChildUniverseDeploymentModal, { actionAvailability: { disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }, idleLabel: scalarOutcomeInvalid ? marketCopy.deployInvalidUniverse : marketCopy.deployUniverse, isOpen: deployModalOpen, onClose: () => setDeployModalOpen(false), onConfirm: () => onCreateChildUniverseForOutcomeIndex(selectedScalarOutcomeIndex), pending: scalarDeployPending, pendingLabel: marketCopy.deployingUniverse, requirements: scalarDeployRequirements, title: marketCopy.createChildUniverseTitle, children: selectedScalarChild === undefined ? undefined : (_jsx(ChildUniversesSection, { childUniverses: [selectedScalarChild], emptyMessage: marketCopy.childUniverseSelectionEmpty, headerTitle: marketCopy.selectedChildUniverse, renderBadge: child => _jsx(ChildUniverseStatusBadge, { child: child }), renderBody: child => _jsx(ChildUniverseDetails, { accountAddress: accountAddress, child: child, isSupportedChain: isOnActiveAppChain }), surface: 'flat' })) }), _jsx(ErrorNotice, { message: scalarDeployError }), _jsx(ErrorNotice, { message: zoltarChildUniverseError })] }));
}
//# sourceMappingURL=ScalarDeploymentSection.js.map