import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { zeroAddress } from '@zoltar/shared/ethereum';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { ComparisonRecord } from '@zoltar/ui-core-shared/components/ComparisonRecord.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { OpenOraclePriceValue } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOraclePriceValue.js';
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js';
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js';
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js';
import { getWalletScopedAccountAddress } from '@zoltar/ui-core-shared/lib/network.js';
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex, SECURITY_POOL_PAGE_SIZE } from '@zoltar/ui-core-shared/lib/pagination.js';
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js';
import { formatSecurityPoolPageSummary, getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js';
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js';
import { calculateMintingCapacityAttoEth, formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js';
import { getPoolRegistryPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
export function SecurityPoolsOverviewSection({ accountState, environmentRefreshKey, hasLoadedSecurityPoolPage, loadingSecurityPoolPage, onCreateSecurityPool, onLoadSecurityPoolPage, onSelectSecurityPool, securityPoolBrowseCount, securityPoolPage, securityPoolOverviewError }) {
    const [pageIndex, setPageIndex] = useState(0);
    const [activePageRequestKey, setActivePageRequestKey] = useState(undefined);
    const [pageLoadError, setPageLoadError] = useState(undefined);
    const [searchText, setSearchText] = useState('');
    const [systemStateFilter, setSystemStateFilter] = useState('all');
    const loadSecurityPoolPageRef = useRef(onLoadSecurityPoolPage);
    loadSecurityPoolPageRef.current = onLoadSecurityPoolPage;
    const requestedPoolCount = securityPoolPage?.poolCount ?? securityPoolBrowseCount;
    const requestedPoolPageCount = getPaginationPageCount(requestedPoolCount, SECURITY_POOL_PAGE_SIZE);
    const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, requestedPoolPageCount);
    const scopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId);
    const accountRequestKey = scopedAccountAddress?.toLowerCase() ?? 'no-account';
    const currentPageRequestKey = `${environmentRefreshKey}:${resolvedPageIndex}:${SECURITY_POOL_PAGE_SIZE}:${accountRequestKey}`;
    const hasCurrentPageData = securityPoolPage?.requestKey === currentPageRequestKey && securityPoolPage.pageIndex === resolvedPageIndex && securityPoolPage.pageSize === SECURITY_POOL_PAGE_SIZE;
    const currentPoolCount = hasCurrentPageData ? securityPoolPage.poolCount : undefined;
    const poolPageCount = getPaginationPageCount(currentPoolCount, SECURITY_POOL_PAGE_SIZE);
    const pagedSecurityPools = hasCurrentPageData ? securityPoolPage.pools : [];
    const isWaitingForPageData = activePageRequestKey === currentPageRequestKey;
    const hasLoadedCurrentPage = hasLoadedSecurityPoolPage && hasCurrentPageData;
    const effectiveSecurityPoolOverviewError = securityPoolOverviewError ?? pageLoadError;
    const loadingCurrentPage = loadingSecurityPoolPage || isWaitingForPageData || (!hasLoadedCurrentPage && effectiveSecurityPoolOverviewError === undefined);
    const registryPresentation = getPoolRegistryPresentation({
        hasLoaded: hasLoadedCurrentPage,
        isLoading: loadingCurrentPage && !hasLoadedCurrentPage,
        mode: 'collection',
        poolCount: pagedSecurityPools.length,
    });
    const securityPoolsWithState = pagedSecurityPools.map(pool => ({
        pool,
        hasKnownForkActivity: pool.hasForkActivity,
        poolState: evaluateSecurityPoolState({
            lifecycleState: deriveSecurityPoolLifecycleState({
                hasForkActivity: pool.hasForkActivity,
                isChildPool: pool.parent !== zeroAddress,
                questionOutcome: pool.questionOutcome,
                systemState: pool.systemState,
                universeHasForked: pool.universeHasForked,
            }),
            universeHasForked: pool.universeHasForked,
        }),
    }));
    const normalizedSearchText = searchText.trim().toLowerCase();
    const hasPreviousPage = resolvedPageIndex > 0;
    const hasNextPage = hasCurrentPageData && getHasNextPaginationPage(resolvedPageIndex, poolPageCount);
    const retryPoolRegistryLoad = () => {
        setPageLoadError(undefined);
        setActivePageRequestKey(currentPageRequestKey);
        void Promise.resolve(onLoadSecurityPoolPage(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey))
            .catch(() => {
            setPageLoadError(securityPoolCopy.poolPageLoadError);
        })
            .finally(() => {
            setActivePageRequestKey(current => (current === currentPageRequestKey ? undefined : current));
        });
    };
    useEffect(() => {
        if (resolvedPageIndex === pageIndex)
            return;
        setPageIndex(resolvedPageIndex);
    }, [pageIndex, resolvedPageIndex]);
    useEffect(() => {
        let cancelled = false;
        setPageLoadError(undefined);
        setActivePageRequestKey(currentPageRequestKey);
        void Promise.resolve(loadSecurityPoolPageRef.current(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey))
            .catch(() => {
            if (cancelled)
                return;
            setPageLoadError(securityPoolCopy.poolPageLoadError);
        })
            .finally(() => {
            if (cancelled)
                return;
            setActivePageRequestKey(current => (current === currentPageRequestKey ? undefined : current));
        });
        return () => {
            cancelled = true;
        };
    }, [currentPageRequestKey, environmentRefreshKey, resolvedPageIndex]);
    const filteredSecurityPools = securityPoolsWithState.filter(({ pool, poolState }) => {
        const displayState = poolState.lifecycleState;
        if (systemStateFilter !== 'all' && displayState !== systemStateFilter)
            return false;
        if (normalizedSearchText === '')
            return true;
        return pool.securityPoolAddress.toLowerCase().includes(normalizedSearchText) || pool.questionId.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.title.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.description.toLowerCase().includes(normalizedSearchText);
    });
    const hasActiveFilters = normalizedSearchText !== '' || systemStateFilter !== 'all';
    return (_jsxs(SectionBlock, { density: 'compact', title: commonCopy.securityPools, variant: 'plain', actions: _jsx(PaginationControls, { hasNextPage: hasNextPage, hasPreviousPage: hasPreviousPage, loading: loadingCurrentPage, onNextPage: () => {
                setPageIndex(current => current + 1);
            }, onPreviousPage: () => {
                setPageIndex(current => Math.max(0, current - 1));
            }, summary: hasCurrentPageData ? formatPaginationSummary(resolvedPageIndex, poolPageCount) : undefined }), children: [_jsx(ErrorNotice, { message: effectiveSecurityPoolOverviewError }), effectiveSecurityPoolOverviewError === undefined ? undefined : (_jsx("div", { className: 'actions pool-registry-recovery-actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: retryPoolRegistryLoad, disabled: loadingCurrentPage, children: loadingCurrentPage ? _jsx(LoadingText, { children: securityPoolCopy.retryingSecurityPoolsTruncated }) : securityPoolCopy.retryLoadingPools }) })), _jsxs("div", { className: 'filter-toolbar', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.searchLoadedPage }), _jsx(FormInput, { value: searchText, onInput: event => setSearchText(event.currentTarget.value), placeholder: securityPoolCopy.poolSearchPlaceholder })] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.systemState }), _jsxs("select", { value: systemStateFilter, onChange: event => setSystemStateFilter(event.currentTarget.value), children: [_jsx("option", { value: 'all', children: securityPoolCopy.allStates }), _jsx("option", { value: 'operational', children: commonCopy.operational }), _jsx("option", { value: 'ended', children: securityPoolCopy.ended }), _jsx("option", { value: 'poolForked', children: securityPoolCopy.poolForked }), _jsx("option", { value: 'forkMigration', children: securityPoolCopy.forkMigration }), _jsx("option", { value: 'forkTruthAuction', children: commonCopy.truthAuction })] })] })] }), hasActiveFilters && pagedSecurityPools.length > 0 ? _jsx("p", { className: 'detail', children: formatSecurityPoolPageSummary(filteredSecurityPools.length, pagedSecurityPools.length) }) : undefined, (() => {
                if (pagedSecurityPools.length === 0) {
                    if (registryPresentation === undefined)
                        return undefined;
                    const isEmptyRegistry = registryPresentation.key === 'empty';
                    const registryActions = (() => {
                        if (isEmptyRegistry && onCreateSecurityPool !== undefined)
                            return (_jsx("button", { className: 'primary', type: 'button', onClick: onCreateSecurityPool, children: commonCopy.createSecurityPoolAction }));
                        return undefined;
                    })();
                    return _jsx(StateHint, { presentation: registryPresentation, title: isEmptyRegistry ? securityPoolCopy.noSecurityPools : undefined, actions: registryActions });
                }
                if (filteredSecurityPools.length === 0)
                    return _jsx(StateHint, { presentation: { key: 'empty', badgeLabel: commonCopy.noMatches, badgeTone: 'muted', detail: securityPoolCopy.poolFiltersEmpty } });
                return (_jsx("div", { className: 'comparison-record-list', children: filteredSecurityPools.map(({ hasKnownForkActivity, pool, poolState }) => {
                        const displayState = poolState.lifecycleState;
                        const statusBadgeLabel = getSecurityPoolStatusBadgeLabel({
                            hasForkActivity: hasKnownForkActivity,
                            questionOutcome: pool.questionOutcome,
                            lifecycleState: displayState,
                        });
                        const mintingCapacityAttoEth = calculateMintingCapacityAttoEth(pool.totalCapacityOwnershipAttoRep, pool.lastOraclePrice, pool.statoblastSecurityMultiplierBps);
                        const badgeTone = (() => {
                            if (displayState === 'operational')
                                return 'ok';
                            if (displayState === undefined)
                                return 'muted';
                            return 'warning';
                        })();
                        return (_jsx(ComparisonRecord, { title: getQuestionTitle(pool.marketDetails), badge: _jsx(Badge, { ariaLabel: statusBadgeLabel, tone: badgeTone, children: statusBadgeLabel }), action: onSelectSecurityPool === undefined ? undefined : (_jsx("button", { "aria-label": securityPoolCopy.formatOpenPoolLabel(getQuestionTitle(pool.marketDetails), pool.securityPoolAddress), className: 'primary', onClick: () => onSelectSecurityPool(pool.securityPoolAddress, pool.universeId), children: securityPoolCopy.openPool })), metrics: [
                                { label: securityPoolCopy.vaultCount, value: pool.vaultCount.toString() },
                                { label: commonCopy.statoblastSecurityMultiplierBps, value: `${formatStatoblastSecurityMultiplier(pool.statoblastSecurityMultiplierBps)}x` },
                                {
                                    label: commonCopy.openOraclePrice,
                                    value: _jsx(OpenOraclePriceValue, { currentTimestamp: undefined, lastPrice: pool.lastOraclePrice, lastSettlementTimestamp: pool.lastOracleSettlementTimestamp, priceValidUntilTimestamp: undefined }),
                                },
                                {
                                    label: securityPoolCopy.openInterestMinted,
                                    value: (_jsxs("span", { className: 'comparison-record-value-stack', children: [_jsx(CurrencyValue, { value: pool.settlementCollateralAttoEth, suffix: commonCopy.eth, copyable: false }), _jsxs("span", { className: 'detail', children: [securityPoolCopy.maxLead, mintingCapacityAttoEth === undefined ? commonCopy.unavailable : _jsx(CurrencyValue, { value: mintingCapacityAttoEth, suffix: commonCopy.eth, copyable: false })] })] })),
                                },
                            ], children: _jsx(ReadOnlyDetailAccordion, { title: commonCopy.technicalDetails, children: _jsxs("div", { className: 'comparison-record-expanded', children: [_jsx(Question, { question: pool.marketDetails, showTitle: false, variant: 'preview' }), _jsxs("div", { className: 'security-pool-detail-rail security-pool-card-inline-details', children: [_jsx(MetricField, { label: securityPoolCopy.annualFee, children: _jsx(CurrencyValue, { value: openInterestFeePerYearBigint(pool.currentRetentionRate), suffix: commonCopy.percent }) }), _jsx(MetricField, { label: securityPoolCopy.poolAddress, children: _jsx(AddressValue, { address: pool.securityPoolAddress }) }), _jsx(MetricField, { label: securityPoolCopy.managerAddress, children: _jsx(AddressValue, { address: pool.managerAddress }) }), _jsx(MetricField, { label: commonCopy.questionId, children: _jsx(IdentifierValue, { value: pool.questionId }) }), _jsx(MetricField, { label: commonCopy.universe, children: _jsx(UniverseLink, { format: 'hex', universeId: pool.universeId }) })] })] }) }) }, pool.securityPoolAddress));
                    }) }));
            })()] }));
}
//# sourceMappingURL=SecurityPoolsOverviewSection.js.map