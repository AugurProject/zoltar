import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js';
import { useState } from 'preact/hooks';
import { ChildUniverseDeploymentModal } from '@zoltar/ui-zoltar/features/universes/components/ChildUniverseDeploymentModal.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { ChildUniverseDetails } from '@zoltar/ui-zoltar/features/universes/components/ChildUniverseDetails.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js';
import { ChildUniversesSection, ChildUniverseStatusBadge } from '@zoltar/ui-zoltar/features/universes/components/ChildUniversesSection.js';
import { Question } from '@zoltar/ui-core-shared/components/Question.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js';
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js';
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js';
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
import { formatUniverseCollectionLabel } from '@zoltar/ui-zoltar/features/universes/lib/universe.js';
import { getWrongNetworkMessage } from '@zoltar/ui-core-shared/lib/network.js';
export function MarketOverviewSection({ accountAddress, isOnActiveAppChain, loadingZoltarUniverse, onCreateChildUniverseForOutcomeIndex, zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex, zoltarUniverse, zoltarUniverseState }) {
    const rootUniverse = zoltarUniverse;
    const universeMissing = zoltarUniverseState === 'missing';
    const hasForked = rootUniverse?.hasForked === true;
    const currentUniverseName = rootUniverse === undefined ? undefined : formatUniverseCollectionLabel([rootUniverse.universeId]);
    const isScalarFork = rootUniverse?.forkQuestionDetails?.marketType === 'scalar';
    const scalarQuestionDetails = rootUniverse?.forkQuestionDetails;
    const [selectedChildOutcomeIndex, setSelectedChildOutcomeIndex] = useState(undefined);
    const selectedChildUniverse = rootUniverse?.childUniverses.find(child => child.outcomeIndex === selectedChildOutcomeIndex);
    const childUniverseRequirements = [
        { key: 'forked', label: marketCopy.universeIsForked, resolved: hasForked, ...(hasForked ? {} : { detail: marketCopy.childUniversesNotForkedReason }) },
        { key: 'selection', label: marketCopy.childUniverseSelected, resolved: selectedChildUniverse !== undefined, ...(selectedChildUniverse === undefined ? { detail: marketCopy.childDeploymentSelectionRequired } : {}) },
        { key: 'wallet', label: marketCopy.walletConnected, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: marketCopy.childDeploymentWalletRequiredReason }) },
        { key: 'exists', label: marketCopy.childUniverseNotAlreadyDeployed, resolved: selectedChildUniverse?.exists !== true, ...(selectedChildUniverse?.exists === true ? { detail: marketCopy.childUniverseDeployedReason } : {}) },
    ];
    if (universeMissing) {
        const presentation = getUniversePresentation(zoltarUniverseState);
        return presentation === undefined ? undefined : _jsx(StateHint, { presentation: presentation });
    }
    return (_jsx(_Fragment, { children: rootUniverse === undefined ? (_jsx(StateHint, { presentation: getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails } })) : (_jsxs(_Fragment, { children: [_jsxs(DataGrid, { className: 'market-overview-grid', children: [_jsx(MetricField, { label: commonCopy.universe, children: currentUniverseName ?? commonCopy.universe }), _jsx(MetricField, { label: commonCopy.status, children: hasForked ? commonCopy.forked : marketCopy.unforked }), hasForked ? (_jsxs(_Fragment, { children: [_jsx(MetricField, { label: commonCopy.forkTime, children: loadingZoltarUniverse ? commonCopy.loadingWithEllipsis : _jsx(TimestampValue, { timestamp: rootUniverse.forkTime }) }), _jsx(MetricField, { label: commonCopy.forkThresholdAttoRep, children: _jsx(CurrencyValue, { value: rootUniverse.forkThresholdAttoRep, suffix: commonCopy.rep }) })] })) : undefined, _jsx(MetricField, { label: commonCopy.reputationToken, children: _jsx(WalletAssetControl, { accountAddress: accountAddress, address: rootUniverse.reputationToken, isSupportedChain: isOnActiveAppChain, tokenLabel: `${currentUniverseName ?? commonCopy.universe} ${commonCopy.rep}` }) }), _jsx(MetricField, { label: marketCopy.totalTheoreticalSupplyAttoRep, children: _jsx(CurrencyValue, { value: rootUniverse.totalTheoreticalSupplyAttoRep, suffix: commonCopy.rep }) })] }), hasForked ? (_jsx(WorkflowSubsection, { title: marketCopy.forkQuestion, children: _jsx(EntityCard, { surface: 'flat', title: marketCopy.selectedForkQuestion, variant: 'record', children: _jsx(Question, { question: rootUniverse.forkQuestionDetails, loading: rootUniverse.forkQuestionDetails === undefined }) }) })) : undefined, isScalarFork ? (_jsx(ScalarDeploymentSection, { accountAddress: accountAddress, childUniverses: rootUniverse.childUniverses, hasForked: hasForked, isOnActiveAppChain: isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex: onCreateChildUniverseForOutcomeIndex, questionDetails: scalarQuestionDetails, zoltarChildUniverseError: zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex: zoltarChildUniversePendingOutcomeIndex })) : (_jsx(ChildUniversesSection, { childUniverses: rootUniverse.childUniverses, emptyMessage: marketCopy.noChildUniverses, headerSubtitle: hasForked ? marketCopy.childUniverseDeploymentHint : undefined, headerTitle: marketCopy.childUniverses, action: child => ({
                        availability: {
                            disabled: accountAddress === undefined || !isOnActiveAppChain || !hasForked || child.exists,
                            reason: (() => {
                                if (accountAddress === undefined)
                                    return marketCopy.childDeploymentWalletRequiredReason;
                                if (!isOnActiveAppChain)
                                    return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
                                return (() => {
                                    if (!hasForked)
                                        return marketCopy.childUniversesNotForkedReason;
                                    if (child.exists)
                                        return marketCopy.childUniverseDeployedReason;
                                    return undefined;
                                })();
                            })(),
                        },
                        label: child.exists ? commonCopy.deployed : marketCopy.createChildUniverse,
                        onClick: () => setSelectedChildOutcomeIndex(child.outcomeIndex),
                        pending: zoltarChildUniversePendingOutcomeIndex === child.outcomeIndex,
                        pendingLabel: commonCopy.opening,
                    }), renderBadge: child => _jsx(ChildUniverseStatusBadge, { child: child }), renderBody: child => _jsx(ChildUniverseDetails, { accountAddress: accountAddress, child: child, isSupportedChain: isOnActiveAppChain }), surface: 'flat' })), _jsx(ChildUniverseDeploymentModal, { actionAvailability: {
                        disabled: selectedChildUniverse === undefined || accountAddress === undefined || !isOnActiveAppChain || !hasForked || selectedChildUniverse.exists,
                        reason: selectedChildUniverse === undefined
                            ? marketCopy.childDeploymentSelectionRequired
                            : (() => {
                                if (accountAddress === undefined)
                                    return marketCopy.childDeploymentWalletRequiredReason;
                                if (!isOnActiveAppChain)
                                    return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
                                return (() => {
                                    if (!hasForked)
                                        return marketCopy.childUniversesNotForkedReason;
                                    if (selectedChildUniverse.exists)
                                        return marketCopy.childUniverseDeployedReason;
                                    return undefined;
                                })();
                            })(),
                    }, idleLabel: marketCopy.deployUniverse, isOpen: selectedChildUniverse !== undefined, onClose: () => setSelectedChildOutcomeIndex(undefined), onConfirm: () => {
                        if (selectedChildUniverse === undefined)
                            return;
                        onCreateChildUniverseForOutcomeIndex(selectedChildUniverse.outcomeIndex);
                    }, pending: selectedChildUniverse !== undefined && zoltarChildUniversePendingOutcomeIndex === selectedChildUniverse.outcomeIndex, pendingLabel: marketCopy.deployingUniverse, requirements: childUniverseRequirements, title: marketCopy.createChildUniverseTitle, children: selectedChildUniverse === undefined ? undefined : (_jsx(EntityCard, { className: 'compact', surface: 'flat', title: marketCopy.selectedChildUniverse, variant: 'compact', children: _jsx(ChildUniverseDetails, { accountAddress: accountAddress, child: selectedChildUniverse, isSupportedChain: isOnActiveAppChain }) })) })] })) }));
}
//# sourceMappingURL=MarketOverviewSection.js.map