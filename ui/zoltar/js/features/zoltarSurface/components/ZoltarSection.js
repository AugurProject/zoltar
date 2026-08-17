import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as marketCopy from '../../../copy/market.js';
import * as zoltarCopy from '../../../copy/zoltar.js';
import { useState } from 'preact/hooks';
import { ChildUniverseDeploymentModal } from '../../universes/components/ChildUniverseDeploymentModal.js';
import { ChildUniverseDetails } from '../../universes/components/ChildUniverseDetails.js';
import { ChildUniversesSection, ChildUniverseStatusBadge } from '../../universes/components/ChildUniversesSection.js';
import { ForkZoltarSection } from '../../universes/components/ForkZoltarSection.js';
import { ZoltarMigrationSection } from '../../universes/components/ZoltarMigrationSection.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js';
import { getWrongNetworkMessage, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
import { formatUniverseCollectionLabel } from '../../universes/lib/universe.js';
function ZoltarUniverseOverview({ accountAddress, isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex, zoltarChildUniversePendingOutcomeIndex, zoltarUniverse }) {
    const hasForked = zoltarUniverse.hasForked === true;
    const currentUniverseName = formatUniverseCollectionLabel([zoltarUniverse.universeId]);
    const [selectedChildOutcomeIndex, setSelectedChildOutcomeIndex] = useState(undefined);
    const selectedChildUniverse = zoltarUniverse.childUniverses.find(child => child.outcomeIndex === selectedChildOutcomeIndex);
    const childDeploymentAvailabilityReason = (() => {
        if (accountAddress === undefined)
            return marketCopy.childDeploymentWalletRequiredReason;
        if (!isOnActiveAppChain)
            return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
        if (!hasForked)
            return marketCopy.childUniversesNotForkedReason;
        return undefined;
    })();
    const childUniverseRequirements = [
        { key: 'forked', label: marketCopy.universeIsForked, resolved: hasForked, ...(hasForked ? {} : { detail: marketCopy.childUniversesNotForkedReason }) },
        { key: 'selection', label: marketCopy.childUniverseSelected, resolved: selectedChildUniverse !== undefined, ...(selectedChildUniverse === undefined ? { detail: marketCopy.childDeploymentSelectionRequired } : {}) },
        { key: 'wallet', label: marketCopy.walletConnected, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: marketCopy.childDeploymentWalletRequiredReason }) },
        { key: 'exists', label: marketCopy.childUniverseNotAlreadyDeployed, resolved: selectedChildUniverse?.exists !== true, ...(selectedChildUniverse?.exists === true ? { detail: marketCopy.childUniverseDeployedReason } : {}) },
    ];
    return (_jsxs(_Fragment, { children: [_jsxs(DataGrid, { className: 'market-overview-grid', children: [_jsx(MetricField, { label: commonCopy.universe, children: currentUniverseName }), _jsx(MetricField, { label: commonCopy.status, children: hasForked ? commonCopy.forked : marketCopy.unforked })] }), _jsx(ChildUniversesSection, { childUniverses: zoltarUniverse.childUniverses, emptyMessage: marketCopy.noChildUniverses, headerSubtitle: hasForked ? marketCopy.childUniverseDeploymentHint : undefined, headerTitle: marketCopy.childUniverses, action: child => ({
                    availability: {
                        disabled: childDeploymentAvailabilityReason !== undefined || child.exists,
                        reason: childDeploymentAvailabilityReason ?? (child.exists ? marketCopy.childUniverseDeployedReason : undefined),
                    },
                    label: child.exists ? commonCopy.deployed : marketCopy.createChildUniverse,
                    onClick: () => setSelectedChildOutcomeIndex(child.outcomeIndex),
                    pending: zoltarChildUniversePendingOutcomeIndex === child.outcomeIndex,
                    pendingLabel: commonCopy.opening,
                }), renderBadge: child => _jsx(ChildUniverseStatusBadge, { child: child }), renderBody: child => _jsx(ChildUniverseDetails, { accountAddress: accountAddress, child: child, isSupportedChain: isOnActiveAppChain }), surface: 'flat' }), _jsx(ChildUniverseDeploymentModal, { actionAvailability: {
                    disabled: selectedChildUniverse === undefined || childDeploymentAvailabilityReason !== undefined || selectedChildUniverse.exists,
                    reason: selectedChildUniverse === undefined
                        ? marketCopy.childDeploymentSelectionRequired
                        : (childDeploymentAvailabilityReason ?? (selectedChildUniverse.exists ? marketCopy.childUniverseDeployedReason : undefined)),
                }, idleLabel: marketCopy.deployUniverse, isOpen: selectedChildUniverse !== undefined, onClose: () => setSelectedChildOutcomeIndex(undefined), onConfirm: () => {
                    if (selectedChildUniverse === undefined)
                        return;
                    onCreateChildUniverseForOutcomeIndex(selectedChildUniverse.outcomeIndex);
                }, pending: selectedChildUniverse !== undefined && zoltarChildUniversePendingOutcomeIndex === selectedChildUniverse.outcomeIndex, pendingLabel: marketCopy.deployingUniverse, requirements: childUniverseRequirements, title: marketCopy.createChildUniverseTitle, children: selectedChildUniverse === undefined ? undefined : (_jsx(EntityCard, { className: 'compact', surface: 'flat', title: marketCopy.selectedChildUniverse, variant: 'compact', children: _jsx(ChildUniverseDetails, { accountAddress: accountAddress, child: selectedChildUniverse, isSupportedChain: isOnActiveAppChain }) })) })] }));
}
export function ZoltarSection({ accountState, activeView, loadingZoltarForkAccess, loadingZoltarQuestion, loadingZoltarQuestions, loadingZoltarUniverse, hasLoadedZoltarQuestions, onApproveZoltarForkRep, onCreateChildUniverseForOutcomeIndex, onForkZoltar, onLoadZoltarQuestion, onMigrateInternalRep, onPrepareRepForMigration, onZoltarForkQuestionIdChange, onZoltarMigrationFormChange, zoltarChildUniversePendingOutcomeIndex, zoltarForkActiveAction, zoltarForkApproval, zoltarForkError, zoltarForkPending, zoltarForkQuestionId, zoltarForkRepBalanceAttoRep, zoltarMigrationActiveAction, zoltarMigrationChildRepBalancesAttoRep, zoltarMigrationError, zoltarMigrationForm, zoltarMigrationPending, zoltarMigrationPreparedRepBalanceAttoRep, zoltarQuestionLookupError, zoltarQuestionLookupId, zoltarQuestions, zoltarUniverse, zoltarUniverseState, }) {
    const isOnActiveAppChain = isActiveAppChain(accountState.chainId);
    if (zoltarUniverseState === 'missing') {
        const presentation = getUniversePresentation(zoltarUniverseState);
        return presentation === undefined ? undefined : _jsx(StateHint, { presentation: presentation });
    }
    if (zoltarUniverse === undefined) {
        return _jsx(StateHint, { presentation: getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails } });
    }
    if (activeView === 'fork') {
        return (_jsxs(_Fragment, { children: [_jsx(RouteHeader, { title: zoltarCopy.forkZoltar }), _jsx(ForkZoltarSection, { accountAddress: accountState.address, hasLoadedZoltarQuestions: hasLoadedZoltarQuestions, isOnActiveAppChain: isOnActiveAppChain, loadingZoltarForkAccess: loadingZoltarForkAccess, loadingZoltarQuestion: loadingZoltarQuestion, loadingZoltarQuestions: loadingZoltarQuestions, onApproveZoltarForkRep: amount => onApproveZoltarForkRep(amount), onForkZoltar: onForkZoltar, onRetryZoltarQuestion: zoltarForkQuestionId.trim() === '' ? undefined : () => void onLoadZoltarQuestion(zoltarForkQuestionId.trim()), onZoltarForkQuestionIdChange: onZoltarForkQuestionIdChange, zoltarForkActiveAction: zoltarForkActiveAction, zoltarForkApproval: zoltarForkApproval, zoltarForkError: zoltarForkError, zoltarForkPending: zoltarForkPending, zoltarForkQuestionId: zoltarForkQuestionId, zoltarForkRepBalanceAttoRep: zoltarForkRepBalanceAttoRep, zoltarQuestionLookupError: zoltarQuestionLookupError, zoltarQuestionLookupId: zoltarQuestionLookupId, zoltarQuestions: zoltarQuestions, zoltarUniverse: zoltarUniverse, zoltarUniverseState: zoltarUniverseState })] }));
    }
    if (activeView === 'migrate') {
        return (_jsxs(_Fragment, { children: [_jsx(RouteHeader, { title: zoltarCopy.migrateRep }), _jsx(ZoltarMigrationSection, { accountAddress: accountState.address, isOnActiveAppChain: isOnActiveAppChain, loadingZoltarForkAccess: loadingZoltarForkAccess, loadingZoltarUniverse: loadingZoltarUniverse, onApproveZoltarForkRep: amount => onApproveZoltarForkRep(amount), onMigrateInternalRep: onMigrateInternalRep, onPrepareRepForMigration: onPrepareRepForMigration, onZoltarMigrationFormChange: onZoltarMigrationFormChange, zoltarForkActiveAction: zoltarForkActiveAction, zoltarForkApproval: zoltarForkApproval, zoltarForkRepBalanceAttoRep: zoltarForkRepBalanceAttoRep, zoltarMigrationActiveAction: zoltarMigrationActiveAction, zoltarMigrationChildRepBalancesAttoRep: zoltarMigrationChildRepBalancesAttoRep, zoltarMigrationError: zoltarMigrationError, zoltarMigrationForm: zoltarMigrationForm, zoltarMigrationPending: zoltarMigrationPending, zoltarMigrationPreparedRepBalanceAttoRep: zoltarMigrationPreparedRepBalanceAttoRep, zoltarUniverse: zoltarUniverse, zoltarUniverseState: zoltarUniverseState })] }));
    }
    return (_jsx(ZoltarUniverseOverview, { accountAddress: accountState.address, isOnActiveAppChain: isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex: onCreateChildUniverseForOutcomeIndex, zoltarChildUniversePendingOutcomeIndex: zoltarChildUniversePendingOutcomeIndex, zoltarUniverse: zoltarUniverse }));
}
//# sourceMappingURL=ZoltarSection.js.map