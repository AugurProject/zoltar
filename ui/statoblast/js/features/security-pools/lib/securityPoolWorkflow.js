import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js';
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { deriveHasForkActivity, getForkAuctionStageView } from '../../truth-auctions/lib/forkAuction.js';
import { resolveEnumValue } from '@zoltar/ui-core-shared/lib/viewState.js';
const FORK_WORKFLOW_SELECTION_STAGES = ['fork-triggered', 'migration', 'auction', 'settlement'];
export const SELECTED_POOL_PRIMARY_VIEWS = ['vaults', 'trading', 'reporting', 'fork-workflow'];
export const SELECTED_POOL_SECONDARY_VIEWS = ['staged-operations', 'price-oracle'];
export const SELECTED_POOL_VIEWS = [...SELECTED_POOL_PRIMARY_VIEWS, ...SELECTED_POOL_SECONDARY_VIEWS];
export function getSelectedPoolViewLabel(view) {
    switch (view) {
        case 'vaults':
            return 'Vaults';
        case 'trading':
            return 'Shares';
        case 'reporting':
            return 'Reporting';
        case 'fork-workflow':
            return 'Fork & Migration';
        case 'staged-operations':
            return 'Staged Operations';
        case 'price-oracle':
            return 'Price Oracle';
        default:
            return assertNever(view);
    }
}
export function resolveSelectedPoolView(value) {
    const normalizedValue = (() => {
        if (value === 'resolution')
            return 'reporting';
        if (value === 'withdraw-escalation-deposits')
            return 'reporting';
        if (value === 'oracle')
            return 'staged-operations';
        if (value === 'fork-migration' || value === 'fork-auction' || value === 'fork-settlement')
            return 'fork-workflow';
        return value;
    })();
    return resolveEnumValue(normalizedValue, 'vaults', SELECTED_POOL_VIEWS);
}
export function isSelectedPoolForkWorkflowView(view) {
    return view === 'fork-workflow';
}
export function getSelectedPoolViewForForkStage(stage) {
    switch (stage) {
        case 'initiate':
        case 'migration':
            return 'fork-workflow';
        case 'auction':
            return 'fork-workflow';
        case 'settlement':
            return 'fork-workflow';
        default:
            return assertNever(stage);
    }
}
export function resolveForkWorkflowSelectionStage(value) {
    switch (value) {
        case 'fork-migration':
            return 'migration';
        case 'fork-auction':
            return 'auction';
        case 'fork-settlement':
            return 'settlement';
        default:
            return undefined;
    }
}
export function getSelectedPoolViewForForkWorkflowSelectionStage(stage) {
    switch (stage) {
        case 'fork-triggered':
            return 'fork-workflow';
        case 'migration':
            return 'fork-migration';
        case 'auction':
            return 'fork-auction';
        case 'settlement':
            return 'fork-settlement';
        default:
            return assertNever(stage);
    }
}
export function normalizeForkWorkflowSelectionStage(stage) {
    return stage === 'initiate' ? 'fork-triggered' : stage;
}
export function getCurrentForkWorkflowSelectionStage({ claimingAvailable = false, currentForkStage, hasForkActivity, systemState, truthAuctionFinalized = false, }) {
    if (systemState === 'poolForked')
        return 'migration';
    if (systemState === 'operational' && hasForkActivity && truthAuctionFinalized && !claimingAvailable)
        return 'settlement';
    return normalizeForkWorkflowSelectionStage(currentForkStage);
}
export function getForkWorkflowStageSelection({ currentStageView, forkAuctionDetails, forkOutcome, previewPool, selectedStageView, stageView, systemState, }) {
    const currentStage = currentStageView ??
        (systemState === undefined
            ? 'initiate'
            : getForkAuctionStageView({
                claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
                forkOutcome: forkOutcome ?? 'none',
                migratedAttoRep: forkAuctionDetails?.migratedAttoRep ?? previewPool?.migratedAttoRep ?? 0n,
                systemState,
                truthAuction: forkAuctionDetails?.truthAuction,
                truthAuctionStartedAt: forkAuctionDetails?.truthAuctionStartedAt ?? previewPool?.truthAuctionStartedAt ?? 0n,
            }));
    const currentWorkflowStage = getCurrentForkWorkflowSelectionStage({
        claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
        currentForkStage: currentStage,
        hasForkActivity: forkAuctionDetails?.hasForkActivity ?? previewPool?.hasForkActivity ?? false,
        systemState,
        truthAuctionFinalized: forkAuctionDetails?.truthAuction?.finalized ?? false,
    });
    const selectedStage = (() => {
        if (selectedStageView !== undefined)
            return selectedStageView;
        if (stageView === undefined)
            return currentWorkflowStage;
        return normalizeForkWorkflowSelectionStage(stageView);
    })();
    return {
        currentStage,
        currentWorkflowStage,
        selectedStage,
    };
}
export function getSelectedPoolForkWorkflowView({ forkAuctionDetails, selectedPool, }) {
    const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
        forkAuctionDetails,
        selectedPool,
    });
    if (currentForkAuctionDetails !== undefined)
        return getSelectedPoolViewForForkStage(getForkAuctionStageView({
            claimingAvailable: currentForkAuctionDetails.claimingAvailable,
            forkOutcome: currentForkAuctionDetails.forkOutcome,
            migratedAttoRep: currentForkAuctionDetails.migratedAttoRep,
            systemState: currentForkAuctionDetails.systemState,
            truthAuction: currentForkAuctionDetails.truthAuction,
            truthAuctionStartedAt: currentForkAuctionDetails.truthAuctionStartedAt,
        }));
    if (selectedPool === undefined)
        return 'fork-workflow';
    return getSelectedPoolViewForForkStage(getCurrentSelectedPoolForkStage({
        forkAuctionDetails,
        selectedPool,
    }));
}
export function getCurrentSelectedPoolForkStage({ forkAuctionDetails, selectedPool, }) {
    const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
        forkAuctionDetails,
        selectedPool,
    });
    if (currentForkAuctionDetails !== undefined)
        return getForkAuctionStageView({
            claimingAvailable: currentForkAuctionDetails.claimingAvailable,
            forkOutcome: currentForkAuctionDetails.forkOutcome,
            migratedAttoRep: currentForkAuctionDetails.migratedAttoRep,
            systemState: currentForkAuctionDetails.systemState,
            truthAuction: currentForkAuctionDetails.truthAuction,
            truthAuctionStartedAt: currentForkAuctionDetails.truthAuctionStartedAt,
        });
    if (selectedPool === undefined)
        return 'migration';
    return getForkAuctionStageView({
        forkOutcome: selectedPool.forkOutcome,
        migratedAttoRep: selectedPool.migratedAttoRep,
        systemState: selectedPool.systemState,
        truthAuctionStartedAt: selectedPool.truthAuctionStartedAt,
    });
}
export function hasCurrentSelectedPoolForkActivity({ forkAuctionDetails, selectedPool, }) {
    const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
        forkAuctionDetails,
        selectedPool,
    });
    if (currentForkAuctionDetails !== undefined)
        return deriveHasForkActivity(currentForkAuctionDetails);
    return selectedPool?.hasForkActivity ?? false;
}
export function getCurrentSelectedPoolForkAuctionDetails({ forkAuctionDetails, selectedPool }) {
    if (forkAuctionDetails === undefined)
        return undefined;
    if (forkAuctionDetails.systemState === 'operational' && selectedPool !== undefined && selectedPool.systemState !== 'operational')
        return undefined;
    if (forkAuctionDetails.systemState === 'operational')
        return forkAuctionDetails;
    if (selectedPool?.systemState === 'operational' && selectedPool.hasForkActivity === true)
        return undefined;
    return forkAuctionDetails;
}
export function shouldReloadSelectedPoolDetails({ currentDetailsAvailable, lastHandledRefreshNonce, loadedDetailsAddress, refreshNonce, selectedPoolAddress, }) {
    if (selectedPoolAddress === undefined)
        return false;
    if (refreshNonce !== lastHandledRefreshNonce)
        return true;
    if (!sameAddress(loadedDetailsAddress, selectedPoolAddress))
        return true;
    return !currentDetailsAvailable;
}
export function getCurrentSelectedPoolReportingDetails({ reportingDetails, selectedPool }) {
    if (reportingDetails === undefined)
        return undefined;
    if (reportingDetails.systemState === 'operational') {
        if (selectedPool !== undefined && selectedPool.systemState !== 'operational')
            return undefined;
        if (selectedPool?.systemState === 'operational' && selectedPool.questionOutcome !== undefined && selectedPool.questionOutcome !== 'none' && reportingDetails.questionOutcome !== selectedPool.questionOutcome) {
            return undefined;
        }
        return reportingDetails;
    }
    if (selectedPool?.systemState === 'operational' && selectedPool.hasForkActivity === true)
        return undefined;
    return reportingDetails;
}
export function shouldShowSelectedPoolWorkflowDetails({ hasSelectedPoolAddress, selectedPoolExists, selectedPoolUniverseMismatch }) {
    return hasSelectedPoolAddress && selectedPoolExists && !selectedPoolUniverseMismatch;
}
export function getSelectedPoolCardTitle(questionTitle) {
    return questionTitle?.trim() === '' || questionTitle === undefined ? 'Manage Pool' : questionTitle;
}
export function applySelectedPoolWorkflowState(pool, { questionOutcome, systemState, }) {
    if (pool === undefined)
        return undefined;
    if (questionOutcome === undefined && systemState === undefined)
        return pool;
    return {
        ...pool,
        ...(questionOutcome === undefined ? {} : { questionOutcome }),
        ...(systemState === undefined ? {} : { systemState }),
    };
}
export function getSelectedPoolWorkflowGuardMessage({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }) {
    if (selectedPoolUniverseMismatch)
        return undefined;
    if (selectedPoolLookupState === 'loading')
        return securityPoolCopy.waitForPoolLoadingReason;
    if (selectedPoolLookupState === 'missing')
        return securityPoolCopy.loadValidPoolReason;
    if (!hasSelectedPoolAddress || selectedPoolLookupState === 'unknown')
        return securityPoolCopy.loadPoolReason;
    return undefined;
}
export function getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }) {
    if (selectedPoolUniverseMismatch)
        return {
            badgeLabel: commonCopy.unavailable,
            badgeTone: 'blocked',
            detail: securityPoolCopy.selectedPoolUnavailableDetail,
            key: 'unavailable',
        };
    if (selectedPoolLookupState === 'loading')
        return {
            detail: commonCopy.loadingWithEllipsis,
            detailIsLoading: true,
            key: 'loading',
        };
    if (selectedPoolLookupState === 'missing')
        return {
            badgeLabel: commonCopy.notFound,
            badgeTone: 'blocked',
            detail: securityPoolCopy.securityPoolAddressNotFoundDetail,
            key: 'not_found',
        };
    if (hasSelectedPoolAddress)
        return {
            badgeLabel: commonCopy.notFound,
            badgeTone: 'blocked',
            detail: securityPoolCopy.poolNotFoundDetail,
            key: 'not_found',
        };
    return {
        badgeLabel: securityPoolCopy.noPoolSelectedBadgeLabel,
        badgeTone: 'muted',
        detail: securityPoolCopy.noPoolSelectedDetail,
        key: 'action_needed',
    };
}
export function isForkWorkflowDisabled(selectedPoolState, selectedPoolHasForkActivity = false) {
    return selectedPoolState === undefined || (selectedPoolState === 'operational' && !selectedPoolHasForkActivity);
}
export function getCurrentPoolOracleManagerDetails({ poolOracleManagerDetails, selectedPoolManagerAddress }) {
    if (!sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress))
        return undefined;
    return poolOracleManagerDetails;
}
export function getSelectedPoolOracleMetricValues({ lastOraclePrice, lastOracleSettlementTimestamp }) {
    return {
        lastPrice: lastOraclePrice ?? 0n,
        lastSettlementTimestamp: lastOracleSettlementTimestamp,
    };
}
//# sourceMappingURL=securityPoolWorkflow.js.map