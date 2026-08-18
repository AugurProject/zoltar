import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js';
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js';
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js';
import { getSecurityPoolStatusBadgeLabel } from '../../security-pools/lib/securityPoolLabels.js';
import { deriveSecurityPoolLifecycleState } from '../../security-pools/lib/securityPoolState.js';
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js';
import { zeroAddress } from '@zoltar/shared/ethereum';
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, QUESTION_PAGE_SIZE } from '@zoltar/ui-core-shared/lib/pagination.js';
function isCurrentQuestionPage(page, pageIndex, questionCount) {
    return page?.pageIndex === pageIndex && page.pageSize === QUESTION_PAGE_SIZE && (questionCount === undefined || page.questionCount === questionCount);
}
export function MarketQuestionsSection({ environmentRefreshKey, hasForked, hasLoadedSecurityPools, loadingSecurityPools, loadingZoltarQuestionCount, loadingZoltarQuestions, onCreateQuestion, onLoadSecurityPools, onLoadZoltarQuestions, onLoadZoltarQuestionPage, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, securityPools, securityPoolsLoadError, zoltarQuestionCount, zoltarQuestionPage, zoltarQuestionsError, }) {
    const noQuestionsAvailable = zoltarQuestionCount === 0n;
    const [pageIndex, setPageIndex] = useState(0);
    const [activePageRequestKey, setActivePageRequestKey] = useState(undefined);
    const [lastFailedPageRequestKey, setLastFailedPageRequestKey] = useState(undefined);
    const lastSeenEnvironmentRefreshKeyRef = useRef(environmentRefreshKey);
    const lastRequestedPageKeyRef = useRef(undefined);
    const currentPageRequestKey = `${environmentRefreshKey}:${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount?.toString() ?? 'unknown'}`;
    const hasCurrentPageData = isCurrentQuestionPage(zoltarQuestionPage, pageIndex, zoltarQuestionCount);
    const effectiveQuestionCount = zoltarQuestionPage?.questionCount ?? zoltarQuestionCount;
    const questionPageCount = getPaginationPageCount(effectiveQuestionCount, QUESTION_PAGE_SIZE);
    const visibleQuestions = hasCurrentPageData && zoltarQuestionPage !== undefined ? zoltarQuestionPage.questions : [];
    const isWaitingForPageData = activePageRequestKey === currentPageRequestKey;
    useEffect(() => {
        setPageIndex(0);
    }, [zoltarQuestionCount]);
    useEffect(() => {
        setLastFailedPageRequestKey(undefined);
        lastRequestedPageKeyRef.current = undefined;
    }, [currentPageRequestKey]);
    useEffect(() => {
        if (loadingZoltarQuestionCount)
            return;
        if (zoltarQuestionCount === undefined || zoltarQuestionCount === 0n)
            return;
        const pageRequestKey = `${environmentRefreshKey}:${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount.toString()}`;
        const environmentChanged = lastSeenEnvironmentRefreshKeyRef.current !== environmentRefreshKey;
        const hasCurrentPageData = isCurrentQuestionPage(zoltarQuestionPage, pageIndex, zoltarQuestionCount);
        if (hasCurrentPageData && !environmentChanged) {
            if (lastFailedPageRequestKey === pageRequestKey)
                setLastFailedPageRequestKey(undefined);
            if (activePageRequestKey === pageRequestKey)
                setActivePageRequestKey(undefined);
            return;
        }
        if (lastFailedPageRequestKey === pageRequestKey)
            return;
        if (activePageRequestKey === pageRequestKey)
            return;
        if (lastRequestedPageKeyRef.current === pageRequestKey)
            return;
        lastRequestedPageKeyRef.current = pageRequestKey;
        lastSeenEnvironmentRefreshKeyRef.current = environmentRefreshKey;
        setActivePageRequestKey(pageRequestKey);
        void Promise.resolve(onLoadZoltarQuestionPage(pageIndex, QUESTION_PAGE_SIZE))
            .catch(() => {
            setLastFailedPageRequestKey(current => (current === undefined ? pageRequestKey : current));
        })
            .finally(() => {
            setActivePageRequestKey(current => (current === pageRequestKey ? undefined : current));
        });
    }, [activePageRequestKey, environmentRefreshKey, lastFailedPageRequestKey, loadingZoltarQuestionCount, onLoadZoltarQuestionPage, pageIndex, zoltarQuestionCount, zoltarQuestionPage]);
    const hasPreviousPage = pageIndex > 0;
    const hasNextPage = getHasNextPaginationPage(pageIndex, questionPageCount);
    const retryQuestionLoad = () => {
        if (loadingZoltarQuestionCount || loadingZoltarQuestions)
            return;
        if (zoltarQuestionCount === undefined) {
            void onLoadZoltarQuestions().catch(() => undefined);
            return;
        }
        const pageRequestKey = currentPageRequestKey;
        lastRequestedPageKeyRef.current = pageRequestKey;
        setLastFailedPageRequestKey(undefined);
        setActivePageRequestKey(pageRequestKey);
        void onLoadZoltarQuestionPage(pageIndex, QUESTION_PAGE_SIZE)
            .catch(() => {
            setLastFailedPageRequestKey(current => (current === undefined ? pageRequestKey : current));
        })
            .finally(() => {
            setActivePageRequestKey(current => (current === pageRequestKey ? undefined : current));
        });
    };
    return (_jsxs(SectionBlock, { density: 'compact', title: marketCopy.questions, variant: 'plain', actions: _jsx(PaginationControls, { hasNextPage: hasNextPage, hasPreviousPage: hasPreviousPage, loading: loadingZoltarQuestions, onNextPage: () => setPageIndex(current => current + 1), onPreviousPage: () => setPageIndex(current => Math.max(0, current - 1)), summary: zoltarQuestionPage === undefined ? undefined : formatPaginationSummary(pageIndex, questionPageCount) }), children: [zoltarQuestionsError === undefined ? undefined : (_jsxs(_Fragment, { children: [_jsx(ErrorNotice, { message: zoltarQuestionsError }), _jsx("div", { className: 'actions', children: _jsx("button", { type: 'button', className: 'secondary', disabled: loadingZoltarQuestionCount || loadingZoltarQuestions, onClick: retryQuestionLoad, children: loadingZoltarQuestionCount || loadingZoltarQuestions ? marketCopy.retryingQuestions : marketCopy.retryQuestions }) })] })), visibleQuestions.length === 0 ? ((() => {
                if (loadingZoltarQuestionCount || loadingZoltarQuestions || isWaitingForPageData)
                    return (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: marketCopy.loadingQuestions }) }));
                if (noQuestionsAvailable)
                    return (_jsx(StateHint, { presentation: {
                            key: 'empty',
                            badgeLabel: marketCopy.noQuestions,
                            badgeTone: 'muted',
                        }, title: marketCopy.noQuestions, actions: _jsx("button", { className: 'primary', type: 'button', onClick: onCreateQuestion, children: commonCopy.createQuestionAction }) }));
                if (zoltarQuestionsError === undefined && effectiveQuestionCount !== undefined && effectiveQuestionCount > 0n)
                    return _jsx("p", { className: 'detail', children: marketCopy.questionPageUnavailable });
                return undefined;
            })()) : (_jsx("div", { className: 'entity-card-list', children: visibleQuestions.map(question => (_jsxs(EntityCard, { title: getQuestionTitle(question), actions: _jsxs("div", { className: 'actions', children: [_jsx("button", { "aria-label": hasForked ? marketCopy.formatAlreadyForkedLabel(getQuestionTitle(question), question.questionId) : marketCopy.formatUseForForkLabel(getQuestionTitle(question), question.questionId), className: 'secondary', disabled: hasForked, onClick: () => {
                                    if (hasForked)
                                        return;
                                    onUseQuestionForFork(question.questionId);
                                    onOpenForkTab();
                                }, children: hasForked ? marketCopy.alreadyForked : marketCopy.useForFork }), question.marketType === 'binary' ? undefined : _jsx(Badge, { tone: 'muted', children: marketCopy.binaryPoolsOnly }), _jsx("button", { "aria-label": marketCopy.formatCreatePoolFromQuestionLabel(getQuestionTitle(question), question.questionId), className: 'secondary', onClick: () => onUseQuestionForPool(question.questionId), disabled: question.marketType !== 'binary', title: question.marketType === 'binary' ? undefined : marketCopy.binaryPoolsOnly, children: marketCopy.createPoolFromQuestion })] }), children: [_jsx(Question, { question: question, showTitle: false }), (() => {
                            const linkedPools = securityPools.filter(pool => sameCaseInsensitiveText(pool.questionId, question.questionId));
                            const linkedPoolsContent = (() => {
                                if (!hasLoadedSecurityPools) {
                                    if (securityPoolsLoadError === undefined)
                                        return (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: marketCopy.loadingLinkedPools }) }));
                                    return (_jsxs("div", { children: [_jsx("p", { className: 'error-text', role: 'alert', children: securityPoolsLoadError }), _jsx("button", { className: 'secondary', type: 'button', onClick: onLoadSecurityPools, disabled: loadingSecurityPools, children: marketCopy.retryLinkedPools })] }));
                                }
                                if (linkedPools.length === 0)
                                    return _jsx("p", { className: 'detail', children: marketCopy.noLinkedPool });
                                return (_jsx("div", { className: 'market-linked-pool-list', children: linkedPools.map(pool => {
                                        const lifecycleState = deriveSecurityPoolLifecycleState({
                                            hasForkActivity: pool.hasForkActivity,
                                            isChildPool: pool.parent !== zeroAddress,
                                            questionOutcome: pool.questionOutcome,
                                            systemState: pool.systemState,
                                            universeHasForked: pool.universeHasForked,
                                        });
                                        const statusLabel = getSecurityPoolStatusBadgeLabel({ hasForkActivity: pool.hasForkActivity, lifecycleState, questionOutcome: pool.questionOutcome });
                                        return (_jsxs("div", { className: 'market-linked-pool', children: [_jsxs("div", { className: 'market-linked-pool-summary', children: [_jsx(Badge, { tone: lifecycleState === 'operational' ? 'ok' : 'warning', children: statusLabel }), _jsxs("span", { children: [commonCopy.universe, ": ", _jsx(UniverseLink, { universeId: pool.universeId })] }), _jsxs("span", { children: [_jsx("strong", { children: marketCopy.openInterest }), ": ", _jsx(CurrencyValue, { value: pool.settlementCollateralAttoEth, suffix: commonCopy.eth, copyable: false })] }), _jsxs("span", { children: [_jsx("strong", { children: marketCopy.shareSupply }), ": ", _jsx(CurrencyValue, { className: 'market-linked-pool-share-supply', compactWhenOverflow: true, value: pool.shareTokenSupplyAttoShares, copyable: false })] })] }), _jsx("div", { className: 'market-linked-pool-participation', children: _jsx("strong", { children: marketCopy.completeSetOperations }) }), _jsxs("div", { className: 'actions', children: [_jsx(SecurityPoolLink, { ariaLabel: marketCopy.formatOpenSharesAndPositionLabel(getQuestionTitle(question), pool.universeId, pool.securityPoolAddress), className: 'button-link secondary', securityPoolAddress: pool.securityPoolAddress, selectedPoolView: 'trading', universeId: pool.universeId, children: marketCopy.openSharesAndPosition }), _jsx(SecurityPoolLink, { ariaLabel: marketCopy.formatOpenReportingLabel(getQuestionTitle(question), pool.universeId, pool.securityPoolAddress), className: 'button-link secondary', securityPoolAddress: pool.securityPoolAddress, selectedPoolView: 'reporting', universeId: pool.universeId, children: marketCopy.openReporting })] })] }, pool.securityPoolAddress));
                                    }) }));
                            })();
                            return (_jsxs("section", { className: 'market-linked-pools', "aria-label": marketCopy.linkedPools, children: [_jsx("div", { className: 'market-linked-pools-header', children: _jsx("strong", { children: marketCopy.linkedPools }) }), linkedPoolsContent] }));
                        })()] }, question.questionId))) }))] }));
}
//# sourceMappingURL=MarketQuestionsSection.js.map