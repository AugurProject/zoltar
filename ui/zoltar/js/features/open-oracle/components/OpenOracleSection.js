import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as openOracleCopy from '../../../copy/openOracle.js';
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js';
import { useEffect, useState } from 'preact/hooks';
import { zeroAddress } from '@zoltar/shared/ethereum';
import { ActionLauncherCard } from '@zoltar/ui-core-shared/components/ActionLauncherCard.js';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { ComparisonRecord } from '@zoltar/ui-core-shared/components/ComparisonRecord.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js';
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js';
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js';
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js';
import { TransactionObjectContext } from '@zoltar/ui-core-shared/components/TransactionObjectContext.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js';
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { createConnectedReadClient } from '@zoltar/ui-core-shared/lib/clients.js';
import { useChainBlockNumber, useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js';
import { getOpenOracleCreateGuardMessage, getOpenOracleCreateValidation, formatOpenOracleFeePercentage, formatOpenOracleMultiplier, getOpenOracleDisputeAvailability, getOpenOracleReportStatus, getOpenOracleReportStatusTone, getOpenOracleSelectedReportActionMode, getOpenOracleSettleAvailability, OPEN_ORACLE_CREATE_FIELD_ORDER, } from '../lib/openOracle.js';
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js';
import { getOpenOracleStagePresentation } from '../lib/openOracleStage.js';
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '@zoltar/ui-core-shared/lib/pagination.js';
import { loadOpenOracleReportSummaries } from '../../../protocol/index.js';
import { getWrongNetworkMessage, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js';
import { getReportPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
import { formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js';
const BROWSE_PAGE_SIZE = 10;
const OPEN_ORACLE_PRICE_UNITS = 30;
const DISPUTE_REPORT_MODAL = 'dispute';
const SETTLE_REPORT_MODAL = 'settle';
const OPEN_ORACLE_CREATE_FIELD_ERROR_IDS = {
    disputeDelay: 'open-oracle-dispute-delay-error',
    escalationHalt: 'open-oracle-escalation-halt-error',
    ethValue: 'open-oracle-eth-value-error',
    exactToken1Report: 'open-oracle-exact-token1-report-error',
    feePercentage: 'open-oracle-fee-percentage-error',
    initialToken2Amount: 'open-oracle-initial-token2-amount-error',
    multiplier: 'open-oracle-multiplier-error',
    protocolFee: 'open-oracle-protocol-fee-error',
    settlementTime: 'open-oracle-settlement-time-error',
    settlerRewardEthAmount: 'open-oracle-settler-reward-error',
    token1Address: 'open-oracle-token1-address-error',
    token2Address: 'open-oracle-token2-address-error',
};
const OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER = ['disputeNewAmount1', 'disputeNewAmount2', 'disputeTokenToSwap'];
function getOpenOracleCreateFieldErrorId(field) {
    return OPEN_ORACLE_CREATE_FIELD_ERROR_IDS[field];
}
function getOpenOracleFieldDescribedBy(errorId, error, helpId) {
    return [helpId, error === undefined ? undefined : errorId].filter(value => value !== undefined).join(' ') || undefined;
}
function renderOpenOracleFieldError(id, message) {
    if (message === undefined)
        return undefined;
    return (_jsx("p", { className: 'field-error', id: id, role: 'alert', children: message }));
}
function formatOpenOracleReviewDuration(value) {
    const seconds = tryParseBigIntInput(value);
    if (seconds === undefined)
        return commonCopy.metricUnavailablePlaceholder;
    return `${formatDuration(seconds)} (${openOracleCopy.formatExactSeconds(seconds.toString())})`;
}
function getOpenOracleDisputeFieldErrorId(field, reportId) {
    switch (field) {
        case 'disputeNewAmount1':
            return `open-oracle-dispute-new-amount-1-error-${reportId}`;
        case 'disputeNewAmount2':
            return `open-oracle-dispute-new-amount-2-error-${reportId}`;
        case 'disputeTokenToSwap':
            return `open-oracle-dispute-token-to-swap-error-${reportId}`;
        default:
            return assertNever(field);
    }
}
function getWithdrawalReportModal(balance) {
    return `withdraw-${balance}`;
}
function getSelectedWithdrawalBalance(modal) {
    if (modal === 'withdraw-ethAttoEth')
        return 'ethAttoEth';
    if (modal === 'withdraw-token1')
        return 'token1';
    if (modal === 'withdraw-token2')
        return 'token2';
    return undefined;
}
function getEffectiveOpenOracleReportDetails(report, currentTimestamp, currentBlockNumber) {
    if (report === undefined)
        return undefined;
    if ((currentTimestamp === undefined || report.currentTime === currentTimestamp) && (currentBlockNumber === undefined || report.currentBlockNumber === currentBlockNumber))
        return report;
    return {
        ...report,
        currentBlockNumber: currentBlockNumber ?? report.currentBlockNumber,
        currentTime: currentTimestamp ?? report.currentTime,
    };
}
function resolveBrowseStatusFilter(value) {
    switch (value) {
        case 'Pending':
        case 'Disputed':
        case 'Settled':
        case 'all':
            return value;
        default:
            return 'all';
    }
}
async function loadBrowseReportPage(pageIndex, pageSize) {
    return await loadOpenOracleReportSummaries(createConnectedReadClient(), pageIndex, pageSize);
}
function renderReportField(label, value) {
    return (_jsx(MetricField, { label: label, children: value }, label));
}
function renderReportSection(title, fields) {
    return (_jsx(SectionBlock, { headingLevel: 4, title: title, variant: 'embedded', children: _jsx(MetricGrid, { variant: 'question', children: fields.map(field => renderReportField(field.label, field.value)) }) }));
}
function renderReportFields(fields) {
    return _jsx(MetricGrid, { variant: 'question', children: fields.map(field => renderReportField(field.label, field.value)) });
}
function OpenOracleClockValue({ currentTimestamp, timeType, value, zeroText }) {
    if (timeType)
        return _jsx(TimestampValue, { timestamp: value, ...(currentTimestamp === undefined ? {} : { currentTimestamp }), ...(zeroText === undefined ? {} : { zeroText }) });
    if (value === 0n && zeroText !== undefined)
        return _jsx("span", { className: 'timestamp-value zero', children: zeroText });
    return _jsx("span", { className: 'timestamp-value', children: openOracleCopy.formatTimingValue(value.toString(), openOracleCopy.blocks) });
}
function getOpenOracleClockLabel(timeType, timestampLabel, blockLabel) {
    return timeType ? timestampLabel : blockLabel;
}
function renderReportSummaryCard(report, onSelectReport) {
    const status = getOpenOracleReportStatus(report);
    const statusTone = getOpenOracleReportStatusTone(status);
    const reportTitle = openOracleCopy.formatReportBrowseTitle(report.token1Symbol, report.token2Symbol, report.reportId.toString());
    return (_jsx(ComparisonRecord, { title: reportTitle, badge: _jsx(Badge, { tone: statusTone, children: status }), action: _jsx("button", { "aria-label": openOracleCopy.formatOpenReportLabel(reportTitle), className: 'secondary', type: 'button', onClick: () => onSelectReport(report.reportId), children: openOracleCopy.openReport }), metrics: [
            { label: openOracleCopy.currentPrice, value: _jsx(CurrencyValue, { value: report.price, suffix: openOracleCopy.formatTokenPairSuffix(report.token1Symbol, report.token2Symbol), units: OPEN_ORACLE_PRICE_UNITS, copyable: false }) },
            { label: openOracleCopy.formatCurrentAmount1Label(report.token1Symbol), value: _jsx(CurrencyValue, { value: report.currentAmount1, suffix: report.token1Symbol, units: report.token1Decimals, copyable: false }) },
            { label: openOracleCopy.formatCurrentAmount2Label(report.token2Symbol), value: _jsx(CurrencyValue, { value: report.currentAmount2, suffix: report.token2Symbol, units: report.token2Decimals, copyable: false }) },
            { label: getOpenOracleClockLabel(report.timeType, openOracleCopy.reportTimestamp, openOracleCopy.reportBlock), value: _jsx(OpenOracleClockValue, { timeType: report.timeType, value: report.reportTimestamp }) },
            { label: getOpenOracleClockLabel(report.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock), value: _jsx(OpenOracleClockValue, { timeType: report.timeType, value: report.settlementTimestamp, zeroText: openOracleCopy.notSettled }) },
        ], children: _jsx(ReadOnlyDetailAccordion, { title: commonCopy.technicalDetails, children: renderReportFields([
                {
                    label: report.token1Symbol,
                    value: _jsx(AddressValue, { address: report.token1 }),
                },
                {
                    label: report.token2Symbol,
                    value: _jsx(AddressValue, { address: report.token2 }),
                },
                {
                    label: openOracleCopy.currentReporter,
                    value: report.currentReporter === zeroAddress ? commonCopy.none : _jsx(AddressValue, { address: report.currentReporter }),
                },
            ]) }) }, report.reportId.toString()));
}
export function renderSelectedReportActionSection({ actionMode, disputeSubmission, isConnected, isOnActiveAppChain, onApproveToken1, onApproveToken2, onDisputeReport, onOpenOracleFormChange, onSettleReport, openOracleActiveAction, openOracleForm, openOracleTokenAccessState, openOracleReportDetails, token1Symbol, token2Symbol, }) {
    const disputeTokenOptions = [
        { value: 'token1', label: token1Symbol },
        { value: 'token2', label: token2Symbol },
    ];
    const disputeAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleDisputeAvailability(openOracleReportDetails);
    const settleAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleSettleAvailability(openOracleReportDetails);
    switch (actionMode) {
        case 'dispute': {
            const disputeDisabledMessage = (() => {
                if (openOracleForm.reportId.trim() === '')
                    return openOracleCopy.reportLoadRequired;
                return disputeAvailability.message;
            })();
            const token1ApprovalGuardMessage = (() => {
                if (openOracleReportDetails === undefined)
                    return openOracleCopy.reportLoadRequired;
                if (disputeSubmission?.token1ContributionAmount === undefined)
                    return openOracleCopy.formatDisputeAmountsInvalidReason(token1Symbol);
                return undefined;
            })();
            const token2ApprovalGuardMessage = (() => {
                if (openOracleReportDetails === undefined)
                    return openOracleCopy.reportLoadRequired;
                if (disputeSubmission?.token2ContributionAmount === undefined)
                    return openOracleCopy.formatDisputeAmountsInvalidReason(token2Symbol);
                return undefined;
            })();
            const disputeToken1ApprovalGuardMessage = (() => {
                if (!isConnected)
                    return openOracleCopy.formatDisconnectedWalletApprovalReason(token1Symbol);
                if (!isOnActiveAppChain)
                    return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
                return token1ApprovalGuardMessage;
            })();
            const disputeToken2ApprovalGuardMessage = (() => {
                if (!isConnected)
                    return openOracleCopy.formatDisconnectedWalletApprovalReason(token2Symbol);
                if (!isOnActiveAppChain)
                    return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
                return token2ApprovalGuardMessage;
            })();
            const disputeActionDisabledReason = (() => {
                if (!isConnected)
                    return openOracleCopy.disputeWalletRequiredReason;
                if (!isOnActiveAppChain)
                    return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
                return disputeDisabledMessage ?? (disputeSubmission?.blockMessage?.kind === 'visible' ? disputeSubmission.blockMessage.message : undefined);
            })();
            const disputeReportId = openOracleForm.reportId.trim() || 'unselected';
            const disputeInputFieldErrors = disputeSubmission?.inputFieldErrors ?? {};
            const firstDisputeInputErrorField = OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER.find(field => disputeInputFieldErrors[field] !== undefined);
            const disputeInputBlockMessageId = firstDisputeInputErrorField === undefined ? `open-oracle-dispute-input-blocker-${disputeReportId}` : getOpenOracleDisputeFieldErrorId(firstDisputeInputErrorField, disputeReportId);
            const disputeNewAmount1Error = disputeInputFieldErrors.disputeNewAmount1;
            const disputeNewAmount2Error = disputeInputFieldErrors.disputeNewAmount2;
            const disputeTokenToSwapError = disputeInputFieldErrors.disputeTokenToSwap;
            const disputeActionReasonUsesInputBlockMessage = disputeSubmission?.inputBlockMessage?.kind === 'visible' && disputeActionDisabledReason === disputeSubmission.inputBlockMessage.message;
            const disputeInputBlockDetail = disputeSubmission?.inputBlockMessage !== undefined && firstDisputeInputErrorField === undefined ? (_jsx("p", { className: 'detail', id: disputeInputBlockMessageId, children: disputeSubmission.inputBlockMessage.kind === 'hidden-loading' ? _jsx(LoadingText, { children: disputeSubmission.inputBlockMessage.message }) : disputeSubmission.inputBlockMessage.message })) : undefined;
            return (_jsx(SectionBlock, { variant: 'embedded', children: _jsxs("div", { className: 'form-grid', children: [openOracleReportDetails === undefined
                            ? undefined
                            : renderReportSection(openOracleCopy.currentReportState, [
                                { label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
                                { label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : _jsx(AddressValue, { address: openOracleReportDetails.currentReporter }) },
                                { label: openOracleCopy.currentPrice, value: _jsx(CurrencyValue, { value: openOracleReportDetails.price, suffix: openOracleCopy.formatTokenPairSuffix(token1Symbol, token2Symbol), units: OPEN_ORACLE_PRICE_UNITS, copyable: false }) },
                            ]), _jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.tokenToSwapOut }), _jsx(EnumDropdown, { ariaDescribedBy: disputeTokenToSwapError === undefined ? undefined : getOpenOracleDisputeFieldErrorId('disputeTokenToSwap', disputeReportId), ariaLabel: openOracleCopy.tokenToSwapOut, invalid: disputeTokenToSwapError !== undefined, options: disputeTokenOptions, value: openOracleForm.disputeTokenToSwap, onChange: disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap }) }), renderOpenOracleFieldError(getOpenOracleDisputeFieldErrorId('disputeTokenToSwap', disputeReportId), disputeTokenToSwapError)] }), _jsxs("div", { className: 'field-row', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol) }), _jsx(FormInput, { "aria-describedby": disputeNewAmount1Error === undefined ? undefined : getOpenOracleDisputeFieldErrorId('disputeNewAmount1', disputeReportId), "aria-label": openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol), inputMode: 'decimal', invalid: disputeNewAmount1Error !== undefined, onInput: event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value }), value: openOracleForm.disputeNewAmount1 }), renderOpenOracleFieldError(getOpenOracleDisputeFieldErrorId('disputeNewAmount1', disputeReportId), disputeNewAmount1Error)] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol) }), _jsx(FormInput, { "aria-describedby": disputeNewAmount2Error === undefined ? undefined : getOpenOracleDisputeFieldErrorId('disputeNewAmount2', disputeReportId), "aria-label": openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol), inputMode: 'decimal', invalid: disputeNewAmount2Error !== undefined, onInput: event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value }), value: openOracleForm.disputeNewAmount2 }), renderOpenOracleFieldError(getOpenOracleDisputeFieldErrorId('disputeNewAmount2', disputeReportId), disputeNewAmount2Error)] })] }), disputeSubmission?.expectedNewAmount1 === undefined || disputeSubmission.token1Decimals === undefined ? undefined : _jsx("p", { className: 'detail', children: openOracleCopy.formatNewAmountMustBeExactDetail(token1Symbol, formatCurrencyInputBalance(disputeSubmission.expectedNewAmount1, disputeSubmission.token1Decimals)) }), disputeSubmission?.inputBlockMessage === undefined ? (_jsxs(_Fragment, { children: [_jsx(SectionBlock, { headingLevel: 4, title: openOracleCopy.formatTokenApprovalTitle(token1Symbol), variant: 'embedded', children: _jsx(TokenApprovalControl, { actionLabel: openOracleCopy.disputingTheReport, allowanceError: openOracleTokenAccessState.token1Approval.error, allowanceLoading: openOracleTokenAccessState.token1Approval.loading, approvedAmount: openOracleTokenAccessState.token1Approval.value, disabled: !isConnected || !isOnActiveAppChain, guardMessage: disputeToken1ApprovalGuardMessage, onApprove: amount => onApproveToken1(amount), pending: openOracleActiveAction === 'approveToken1', pendingLabel: openOracleCopy.formatApprovingTokenPendingLabel(token1Symbol), requiredAmount: disputeSubmission?.token1ContributionAmount, resetKey: `dispute:token1:${token1Symbol}:${disputeSubmission?.token1ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`, tokenSymbol: token1Symbol, tokenUnits: disputeSubmission?.token1Decimals ?? 18 }) }), _jsx(SectionBlock, { headingLevel: 4, title: openOracleCopy.formatTokenApprovalTitle(token2Symbol), variant: 'embedded', children: _jsx(TokenApprovalControl, { actionLabel: openOracleCopy.disputingTheReport, allowanceError: openOracleTokenAccessState.token2Approval.error, allowanceLoading: openOracleTokenAccessState.token2Approval.loading, approvedAmount: openOracleTokenAccessState.token2Approval.value, disabled: !isConnected || !isOnActiveAppChain, guardMessage: disputeToken2ApprovalGuardMessage, onApprove: amount => onApproveToken2(amount), pending: openOracleActiveAction === 'approveToken2', pendingLabel: openOracleCopy.formatApprovingTokenPendingLabel(token2Symbol), requiredAmount: disputeSubmission?.token2ContributionAmount, resetKey: `dispute:token2:${token2Symbol}:${disputeSubmission?.token2ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`, tokenSymbol: token2Symbol, tokenUnits: disputeSubmission?.token2Decimals ?? 18 }) })] })) : (disputeInputBlockDetail), !isOnActiveAppChain || disputeSubmission?.blockMessage?.kind !== 'visible' || disputeSubmission.blockMessage === disputeSubmission.inputBlockMessage ? undefined : _jsx("p", { className: 'detail', children: disputeSubmission.blockMessage.message }), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: openOracleCopy.disputeAndSwapAction, pendingLabel: openOracleCopy.submittingDispute, onClick: onDisputeReport, pending: openOracleActiveAction === 'dispute', tone: 'secondary', availability: {
                                    disabled: !isConnected || !isOnActiveAppChain || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false,
                                    reason: disputeActionDisabledReason,
                                }, disabledReasonElementId: disputeActionReasonUsesInputBlockMessage ? disputeInputBlockMessageId : undefined, showDisabledReason: !disputeActionReasonUsesInputBlockMessage }) })] }) }));
        }
        case 'settle': {
            const settleDisabledMessage = (() => {
                if (openOracleForm.reportId.trim() === '')
                    return openOracleCopy.reportLoadRequired;
                return settleAvailability.message;
            })();
            const settleActionDisabledReason = (() => {
                if (!isConnected)
                    return openOracleCopy.settlementWalletRequiredReason;
                if (!isOnActiveAppChain)
                    return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
                return settleDisabledMessage;
            })();
            return (_jsx(SectionBlock, { variant: 'embedded', children: _jsxs("div", { className: 'form-grid', children: [_jsx(TransactionReview, { primary: [{ label: openOracleCopy.reportLifecycle, value: openOracleCopy.settled }], details: openOracleReportDetails === undefined
                                ? []
                                : [
                                    {
                                        label: openOracleCopy.reporterToken1Credit,
                                        value: _jsx(CurrencyValue, { value: openOracleReportDetails.currentAmount1, suffix: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals, copyable: false }),
                                    },
                                    {
                                        label: openOracleCopy.reporterToken2Credit,
                                        value: _jsx(CurrencyValue, { value: openOracleReportDetails.currentAmount2, suffix: openOracleReportDetails.token2Symbol, units: openOracleReportDetails.token2Decimals, copyable: false }),
                                    },
                                    {
                                        label: openOracleCopy.settlerCredit,
                                        value: _jsx(CurrencyValue, { value: openOracleReportDetails.settlerRewardAttoEth, suffix: commonCopy.eth, copyable: false }),
                                    },
                                ], risks: [openOracleCopy.settlementFinalityRisk, openOracleCopy.settlementWithdrawalRisk] }), openOracleReportDetails === undefined
                            ? undefined
                            : renderReportSection(openOracleCopy.settlementSummary, [
                                { label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
                                { label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : _jsx(AddressValue, { address: openOracleReportDetails.currentReporter }) },
                                {
                                    label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock),
                                    value: openOracleReportDetails.settlementTimestamp === 0n ? (openOracleCopy.settlementTimestampOnConfirmation) : (_jsx(OpenOracleClockValue, { currentTimestamp: openOracleReportDetails.currentTime, timeType: openOracleReportDetails.timeType, value: openOracleReportDetails.settlementTimestamp, zeroText: openOracleCopy.notSettled })),
                                },
                            ]), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: openOracleCopy.settleReportAction, pendingLabel: openOracleCopy.settlingReport, onClick: onSettleReport, pending: openOracleActiveAction === 'settle', tone: 'secondary', availability: {
                                    disabled: !isConnected || !isOnActiveAppChain || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct,
                                    reason: settleActionDisabledReason,
                                } }) })] }) }));
        }
        default:
            return assertNever(actionMode);
    }
}
function renderReportDetailsCard(openOracleReportDetails, openOracleForm, openOracleTokenAccessState, openOracleDisputeSubmission, openOracleActiveAction, openOracleActiveWithdrawalBalance, openOracleResult, openOracleReportLookupState, openOracleWithdrawalBalanceChecking, openOracleWithdrawalReviewMessage, accountAddress, isConnected, isOnActiveAppChain, selectedReportModal, onApproveToken1, onApproveToken2, onDisputeReport, onLoadOracleReport, onOpenOracleFormChange, onSelectedReportModalChange, onSettleReport, onWithdrawOpenOracleBalance, openOracleWithdrawableBalances, openOracleWithdrawableBalancesError, openOracleWithdrawableBalancesLoading) {
    const loadingSelectedReport = openOracleReportLookupState === 'loading';
    const reportControls = (_jsx("div", { className: 'form-grid', children: _jsx(LookupFieldRow, { label: openOracleCopy.reportId, value: openOracleForm.reportId, onInput: reportId => onOpenOracleFormChange({ reportId }), action: _jsx("button", { className: 'secondary', onClick: () => onLoadOracleReport(openOracleForm.reportId), disabled: loadingSelectedReport, children: (() => {
                    if (loadingSelectedReport)
                        return _jsx(LoadingText, { children: commonCopy.loadingWithEllipsis });
                    if (openOracleReportDetails === undefined)
                        return openOracleCopy.openReport;
                    return openOracleCopy.refreshReport;
                })() }) }) }));
    if (openOracleReportDetails === undefined) {
        const reportLookupPresentationState = (() => {
            if (openOracleReportLookupState === 'missing')
                return 'missing';
            if (openOracleReportLookupState === 'loading')
                return 'loading';
            return 'unknown';
        })();
        const reportPresentation = getReportPresentation({ kind: 'report', state: reportLookupPresentationState });
        return (_jsxs(SectionBlock, { title: commonCopy.reportDetails, children: [reportControls, reportPresentation === undefined ? undefined : _jsx(StateHint, { presentation: reportPresentation })] }));
    }
    const status = getOpenOracleReportStatus({
        currentReporter: openOracleReportDetails.currentReporter,
        disputeOccurred: openOracleReportDetails.disputeOccurred,
        isDistributed: openOracleReportDetails.isDistributed,
        reportTimestamp: openOracleReportDetails.reportTimestamp,
    });
    const statusTone = getOpenOracleReportStatusTone(status);
    const actionMode = getOpenOracleSelectedReportActionMode(openOracleReportDetails);
    const stage = getOpenOracleStagePresentation(actionMode, openOracleReportDetails);
    const disputeAvailability = getOpenOracleDisputeAvailability(openOracleReportDetails);
    const settleAvailability = getOpenOracleSettleAvailability(openOracleReportDetails);
    const readinessActions = getOpenOracleReadinessActions({
        actionMode,
        disputeMessage: disputeAvailability.message,
        hasReport: true,
        settleMessage: settleAvailability.message,
    }).map(action => {
        if (action.blocker !== undefined)
            return action;
        if (action.key === 'dispute-report')
            return { ...action, onAction: () => onSelectedReportModalChange(DISPUTE_REPORT_MODAL) };
        if (action.key === 'settle-report')
            return { ...action, onAction: () => onSelectedReportModalChange(SETTLE_REPORT_MODAL) };
        return action;
    });
    const withdrawableBalanceItems = [
        { amount: openOracleWithdrawableBalances?.ethAttoEth, key: 'ethAttoEth', symbol: commonCopy.eth, units: 18 },
        { amount: openOracleWithdrawableBalances?.token1, key: 'token1', symbol: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals },
        { amount: openOracleWithdrawableBalances?.token2, key: 'token2', symbol: openOracleReportDetails.token2Symbol, units: openOracleReportDetails.token2Decimals },
    ];
    const selectedWithdrawalBalance = getSelectedWithdrawalBalance(selectedReportModal);
    const selectedWithdrawalItem = withdrawableBalanceItems.find(item => item.key === selectedWithdrawalBalance);
    const selectedWithdrawalAmount = selectedWithdrawalItem?.amount;
    const selectedWithdrawalReviewMessage = openOracleWithdrawalReviewMessage !== undefined && openOracleWithdrawalReviewMessage.balance === selectedWithdrawalBalance ? openOracleWithdrawalReviewMessage.message : undefined;
    const withdrawalDisabledReason = (() => {
        if (!isOnActiveAppChain)
            return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
        if (selectedWithdrawalAmount !== undefined && selectedWithdrawalAmount <= 0n)
            return openOracleCopy.noWithdrawableBalanceForAsset;
        return undefined;
    })();
    const hasWithdrawableBalance = withdrawableBalanceItems.some(item => (item.amount ?? 0n) > 0n);
    const showWithdrawableBalances = isConnected && (openOracleReportDetails.isDistributed || hasWithdrawableBalance || openOracleWithdrawableBalancesLoading || openOracleWithdrawableBalancesError !== undefined);
    let withdrawableBalancesContent;
    if (openOracleWithdrawableBalances === undefined) {
        withdrawableBalancesContent = openOracleWithdrawableBalancesLoading ? (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: openOracleCopy.loadingOracleBalances }) })) : undefined;
    }
    else {
        withdrawableBalancesContent = _jsx(MetricGrid, { children: withdrawableBalanceItems.map(item => renderReportField(item.symbol, _jsx(CurrencyValue, { value: item.amount ?? 0n, suffix: item.symbol, units: item.units, copyable: false }))) });
    }
    const reportTransactionContext = [
        { label: openOracleCopy.reportId, value: openOracleReportDetails.reportId.toString() },
        { label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
        { label: openOracleCopy.oracleAddress, value: _jsx(AddressValue, { address: openOracleReportDetails.openOracleAddress }) },
        { label: transactionReviewCopy.network, value: _jsx(TransactionNetworkValue, {}) },
    ];
    return (_jsxs(_Fragment, { children: [_jsx(StickyObjectContext, { badge: _jsx(Badge, { tone: statusTone, children: status }), eyebrow: openOracleCopy.openOracleReportDetails, title: openOracleCopy.formatReportNumberTitle(openOracleReportDetails.reportId.toString()), items: [
                    { label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
                    { label: openOracleCopy.reporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : _jsx(AddressValue, { address: openOracleReportDetails.currentReporter }) },
                    {
                        label: openOracleCopy.price,
                        value: _jsx(CurrencyValue, { value: openOracleReportDetails.price, suffix: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol), units: OPEN_ORACLE_PRICE_UNITS, copyable: false }),
                    },
                ] }), reportControls, stage.label === status ? undefined : _jsx(LifecycleStageBanner, { stage: stage }), readinessActions.length > 0 ? (_jsx(SectionBlock, { title: openOracleCopy.reportActions, children: _jsx("div", { className: 'action-readiness-grid', children: readinessActions.map(action => (_jsx(ActionLauncherCard, { action: action }, action.key))) }) })) : undefined, !showWithdrawableBalances ? undefined : (_jsxs(SectionBlock, { title: openOracleCopy.oracleBalances, description: openOracleCopy.oracleBalancesDetail, children: [_jsx(ErrorNotice, { message: openOracleWithdrawableBalancesError }), withdrawableBalancesContent, !hasWithdrawableBalance && !openOracleWithdrawableBalancesLoading && openOracleWithdrawableBalancesError === undefined ? _jsx("p", { className: 'detail', children: openOracleCopy.noOracleBalances }) : undefined, !hasWithdrawableBalance ? undefined : (_jsx("div", { className: 'actions', children: withdrawableBalanceItems
                            .filter(item => (item.amount ?? 0n) > 0n)
                            .map(item => (_jsx(TransactionActionButton, { idleLabel: openOracleCopy.withdrawBalance(item.symbol), pendingLabel: openOracleWithdrawalBalanceChecking ? openOracleCopy.checkingWithdrawalBalance(item.symbol) : openOracleCopy.withdrawingBalance(item.symbol), onClick: () => onSelectedReportModalChange(getWithdrawalReportModal(item.key)), pending: (openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance') && openOracleActiveWithdrawalBalance === item.key, tone: 'secondary', availability: { disabled: !isOnActiveAppChain || openOracleActiveAction === 'withdrawBalance', reason: isOnActiveAppChain ? undefined : (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) } }, item.key))) }))] })), _jsxs("div", { className: 'report-detail-stack', children: [_jsx(ReadOnlyDetailAccordion, { title: openOracleCopy.identity, children: renderReportFields([
                            {
                                label: openOracleReportDetails.token1Symbol,
                                value: _jsx(AddressValue, { address: openOracleReportDetails.token1 }),
                            },
                            {
                                label: openOracleReportDetails.token2Symbol,
                                value: _jsx(AddressValue, { address: openOracleReportDetails.token2 }),
                            },
                            {
                                label: openOracleCopy.initialReporter,
                                value: openOracleReportDetails.initialReporter === zeroAddress ? commonCopy.none : _jsx(AddressValue, { address: openOracleReportDetails.initialReporter }),
                            },
                        ]) }), _jsx(ReadOnlyDetailAccordion, { title: openOracleCopy.economics, children: renderReportSection(openOracleCopy.reportAmounts, [
                            {
                                label: openOracleCopy.formatExactTokenRequiredLabel(openOracleReportDetails.token1Symbol),
                                value: _jsx(CurrencyValue, { value: openOracleReportDetails.exactToken1Report, suffix: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals, copyable: false }),
                            },
                            {
                                label: openOracleCopy.formatCurrentAmount1Label(openOracleReportDetails.token1Symbol),
                                value: _jsx(CurrencyValue, { value: openOracleReportDetails.currentAmount1, suffix: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals, copyable: false }),
                            },
                            {
                                label: openOracleCopy.formatCurrentAmount2Label(openOracleReportDetails.token2Symbol),
                                value: _jsx(CurrencyValue, { value: openOracleReportDetails.currentAmount2, suffix: openOracleReportDetails.token2Symbol, units: openOracleReportDetails.token2Decimals, copyable: false }),
                            },
                            {
                                label: openOracleCopy.price,
                                value: _jsx(CurrencyValue, { value: openOracleReportDetails.price, suffix: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol), units: OPEN_ORACLE_PRICE_UNITS, copyable: false }),
                            },
                            {
                                label: openOracleCopy.fee,
                                value: _jsx(CurrencyValue, { value: openOracleReportDetails.fee, suffix: commonCopy.eth, copyable: false }),
                            },
                            {
                                label: openOracleCopy.settlerReward,
                                value: _jsx(CurrencyValue, { value: openOracleReportDetails.settlerRewardAttoEth, suffix: commonCopy.eth, copyable: false }),
                            },
                            {
                                label: openOracleCopy.escalationHalt,
                                value: _jsx(CurrencyValue, { value: openOracleReportDetails.escalationHalt, suffix: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals, copyable: false }),
                            },
                        ]) }), _jsx(ReadOnlyDetailAccordion, { title: commonCopy.status, children: renderReportFields([
                            {
                                label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.reportTimestamp, openOracleCopy.reportBlock),
                                value: _jsx(OpenOracleClockValue, { currentTimestamp: openOracleReportDetails.currentTime, timeType: openOracleReportDetails.timeType, value: openOracleReportDetails.reportTimestamp }),
                            },
                            {
                                label: openOracleCopy.disputeOccurred,
                                value: openOracleReportDetails.disputeOccurred ? commonCopy.yes : commonCopy.no,
                            },
                            {
                                label: commonCopy.settled,
                                value: openOracleReportDetails.isDistributed ? commonCopy.yes : commonCopy.no,
                            },
                            {
                                label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock),
                                value: _jsx(OpenOracleClockValue, { currentTimestamp: openOracleReportDetails.currentTime, timeType: openOracleReportDetails.timeType, value: openOracleReportDetails.settlementTimestamp, zeroText: openOracleCopy.notSettled }),
                            },
                            {
                                label: openOracleCopy.lastReportOpportunity,
                                value: openOracleReportDetails.lastReportOppoTime === 0n ? commonCopy.none : openOracleCopy.formatTimingValue(openOracleReportDetails.lastReportOppoTime, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
                            },
                            {
                                label: openOracleCopy.stateHash,
                                value: openOracleReportDetails.stateHash,
                            },
                        ]) }), _jsx(ReadOnlyDetailAccordion, { title: commonCopy.settlement, children: renderReportFields([
                            {
                                label: openOracleCopy.settlementTime,
                                value: openOracleCopy.formatTimingValue(openOracleReportDetails.settlementTime, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
                            },
                            {
                                label: openOracleCopy.disputeDelay,
                                value: openOracleCopy.formatTimingValue(openOracleReportDetails.disputeDelay, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
                            },
                            {
                                label: openOracleCopy.feePercentage,
                                value: formatOpenOracleFeePercentage(openOracleReportDetails.feePercentage),
                            },
                            {
                                label: openOracleCopy.protocolFee,
                                value: formatOpenOracleFeePercentage(openOracleReportDetails.protocolFee),
                            },
                            {
                                label: commonCopy.multiplier,
                                value: formatOpenOracleMultiplier(openOracleReportDetails.multiplier),
                            },
                        ]) }), _jsx(ReadOnlyDetailAccordion, { title: openOracleCopy.callbackExtra, children: renderReportFields([
                            {
                                label: openOracleCopy.callbackContract,
                                value: openOracleReportDetails.callbackContract === zeroAddress ? commonCopy.none : _jsx(AddressValue, { address: openOracleReportDetails.callbackContract }),
                            },
                            {
                                label: openOracleCopy.callbackGasLimit,
                                value: openOracleReportDetails.callbackGasLimit === 0 ? commonCopy.none : openOracleReportDetails.callbackGasLimit.toString(),
                            },
                            {
                                label: openOracleCopy.protocolFeeRecipient,
                                value: openOracleReportDetails.protocolFeeRecipient === zeroAddress ? commonCopy.none : _jsx(AddressValue, { address: openOracleReportDetails.protocolFeeRecipient }),
                            },
                            {
                                label: openOracleCopy.trackDisputes,
                                value: openOracleReportDetails.trackDisputes ? commonCopy.yes : commonCopy.no,
                            },
                            {
                                label: openOracleCopy.numberOfReports,
                                value: openOracleReportDetails.numReports.toString(),
                            },
                        ]) })] }), _jsx(OperationModal, { context: reportTransactionContext, isOpen: selectedReportModal === 'dispute', onClose: () => onSelectedReportModalChange(undefined), title: openOracleCopy.disputeAndSwap, children: renderSelectedReportActionSection({
                    actionMode: 'dispute',
                    disputeSubmission: openOracleDisputeSubmission,
                    isConnected,
                    isOnActiveAppChain,
                    onApproveToken1,
                    onApproveToken2,
                    onDisputeReport,
                    onOpenOracleFormChange,
                    onSettleReport,
                    openOracleActiveAction,
                    openOracleForm,
                    openOracleTokenAccessState,
                    openOracleReportDetails,
                    token1Symbol: openOracleReportDetails.token1Symbol,
                    token2Symbol: openOracleReportDetails.token2Symbol,
                }) }), _jsx(OperationModal, { closeOnSuccessKey: openOracleResult?.action === 'settle' ? openOracleResult.hash : undefined, context: reportTransactionContext, isOpen: selectedReportModal === 'settle', onClose: () => onSelectedReportModalChange(undefined), title: openOracleCopy.settleReport, children: renderSelectedReportActionSection({
                    actionMode: 'settle',
                    disputeSubmission: openOracleDisputeSubmission,
                    isConnected,
                    isOnActiveAppChain,
                    onApproveToken1,
                    onApproveToken2,
                    onDisputeReport,
                    onOpenOracleFormChange,
                    onSettleReport,
                    openOracleActiveAction,
                    openOracleForm,
                    openOracleTokenAccessState,
                    openOracleReportDetails,
                    token1Symbol: openOracleReportDetails.token1Symbol,
                    token2Symbol: openOracleReportDetails.token2Symbol,
                }) }), selectedWithdrawalItem === undefined || selectedWithdrawalAmount === undefined ? undefined : (_jsxs(OperationModal, { closeOnSuccessKey: openOracleResult?.action === 'withdrawBalance' ? openOracleResult.hash : undefined, context: reportTransactionContext, isOpen: selectedWithdrawalBalance !== undefined, onClose: () => onSelectedReportModalChange(undefined), title: openOracleCopy.withdrawBalance(selectedWithdrawalItem.symbol), children: [_jsx(TransactionReview, { primary: [
                            {
                                label: transactionReviewCopy.youReceive,
                                value: _jsx(CurrencyValue, { value: selectedWithdrawalAmount, suffix: selectedWithdrawalItem.symbol, units: selectedWithdrawalItem.units, precision: 'exact', copyable: false }),
                            },
                        ], details: [
                            {
                                label: openOracleCopy.withdrawalRecipient,
                                value: _jsx(AddressValue, { address: accountAddress }),
                            },
                        ], risks: [openOracleCopy.formatWithdrawalRisk(selectedWithdrawalItem.symbol)] }), _jsx(ErrorNotice, { message: selectedWithdrawalReviewMessage }), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: openOracleCopy.confirmWithdrawal, pendingLabel: openOracleWithdrawalBalanceChecking ? openOracleCopy.checkingWithdrawalBalance(selectedWithdrawalItem.symbol) : openOracleCopy.withdrawingBalance(selectedWithdrawalItem.symbol), onClick: () => onWithdrawOpenOracleBalance(selectedWithdrawalItem.key, selectedWithdrawalAmount), pending: (openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance') && openOracleActiveWithdrawalBalance === selectedWithdrawalItem.key, availability: {
                                disabled: !isOnActiveAppChain || selectedWithdrawalAmount <= 0n || openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance',
                                reason: withdrawalDisabledReason,
                            } }) })] }))] }));
}
export function OpenOracleSection({ activeView, accountState, environmentReady, environmentRefreshKey, loadBrowseReports = loadBrowseReportPage, onApproveToken1, onApproveToken2, onCancelOpenOracleWithdrawalBalanceCheck, onCreateOpenOracleGame, onDisputeReport, onLoadOracleReport, onOpenOracleCreateFormChange, onOpenOracleFormChange, onSettleReport, onWithdrawOpenOracleBalance, loadingOpenOracleCreate, openOracleActiveAction, openOracleActiveWithdrawalBalance, openOracleCreateForm, openOracleCreateFieldErrors = {}, openOracleDisputeSubmission, openOracleError, openOracleForm, openOracleReportLookupState, openOracleWithdrawalBalanceChecking, openOracleWithdrawalReviewMessage, openOracleTokenAccessState, openOracleReportDetails, openOracleResult, openOracleWithdrawableBalances, openOracleWithdrawableBalancesError, openOracleWithdrawableBalancesLoading, onActiveViewChange, }) {
    const view = activeView;
    const chainCurrentTimestamp = useChainTimestamp();
    const chainCurrentBlockNumber = useChainBlockNumber();
    const [browsePage, setBrowsePage] = useState(undefined);
    const [browseLoadState, setBrowseLoadState] = useState({ requestKey: undefined, status: 'loading' });
    const [browseReloadKey, setBrowseReloadKey] = useState(0);
    const [browsePageIndex, setBrowsePageIndex] = useState(0);
    const [browseSearchText, setBrowseSearchText] = useState('');
    const [browseStatusFilter, setBrowseStatusFilter] = useState('all');
    const [selectedReportModal, setSelectedReportModal] = useState(undefined);
    const [touchedCreateFields, setTouchedCreateFields] = useState(new Set());
    const [dismissedCreateSuccessKey, setDismissedCreateSuccessKey] = useState(undefined);
    const changeSelectedReportModal = (modal) => {
        if (getSelectedWithdrawalBalance(selectedReportModal) !== undefined && modal !== selectedReportModal)
            onCancelOpenOracleWithdrawalBalanceCheck();
        setSelectedReportModal(modal);
    };
    const browseLoad = useLoadController();
    const isConnected = accountState.address !== undefined;
    const isOnActiveAppChain = isActiveAppChain(accountState.chainId);
    const createValidation = getOpenOracleCreateValidation({ form: openOracleCreateForm });
    const hasCreateContractFieldErrors = openOracleCreateFieldErrors.token1Address !== undefined || openOracleCreateFieldErrors.token2Address !== undefined;
    const rawCreateGuardMessage = getOpenOracleCreateGuardMessage({
        ethValueInput: openOracleCreateForm.ethValue,
        isOnActiveAppChain,
        settlerRewardInput: openOracleCreateForm.settlerRewardEthAmount,
        walletConnected: isConnected,
        walletBalanceAttoEth: accountState.ethBalanceAttoEth,
    });
    const createGuardMessage = !isConnected || !isOnActiveAppChain || createValidation.isValid ? rawCreateGuardMessage : undefined;
    const markCreateFieldTouched = (field) => setTouchedCreateFields(current => new Set([...current, field]));
    const getCreateContractFieldError = (field) => {
        if (field === 'token1Address')
            return openOracleCreateFieldErrors.token1Address;
        if (field === 'token2Address')
            return openOracleCreateFieldErrors.token2Address;
        return undefined;
    };
    const getVisibleCreateFieldError = (field) => getCreateContractFieldError(field) ?? (touchedCreateFields.has(field) ? createValidation.fieldErrors[field] : undefined);
    const firstVisibleInvalidCreateField = OPEN_ORACLE_CREATE_FIELD_ORDER.find(field => getVisibleCreateFieldError(field) !== undefined);
    const createDisabledReasonElementId = createGuardMessage === undefined && firstVisibleInvalidCreateField !== undefined ? getOpenOracleCreateFieldErrorId(firstVisibleInvalidCreateField) : undefined;
    const createAvailabilityMessage = createGuardMessage ?? openOracleCreateFieldErrors.token1Address ?? openOracleCreateFieldErrors.token2Address ?? createValidation.message;
    const disputeDelayError = getVisibleCreateFieldError('disputeDelay');
    const escalationHaltError = getVisibleCreateFieldError('escalationHalt');
    const ethValueError = getVisibleCreateFieldError('ethValue');
    const exactToken1ReportError = getVisibleCreateFieldError('exactToken1Report');
    const feePercentageError = getVisibleCreateFieldError('feePercentage');
    const initialToken2AmountError = getVisibleCreateFieldError('initialToken2Amount');
    const multiplierError = getVisibleCreateFieldError('multiplier');
    const protocolFeeError = getVisibleCreateFieldError('protocolFee');
    const settlementTimeError = getVisibleCreateFieldError('settlementTime');
    const settlerRewardError = getVisibleCreateFieldError('settlerRewardEthAmount');
    const token1AddressError = getVisibleCreateFieldError('token1Address');
    const token2AddressError = getVisibleCreateFieldError('token2Address');
    const effectiveOpenOracleReportDetails = getEffectiveOpenOracleReportDetails(openOracleReportDetails, chainCurrentTimestamp, chainCurrentBlockNumber);
    const browseRequestKey = `${environmentRefreshKey}:${browsePageIndex}:${browseReloadKey}:${openOracleResult?.action ?? ''}:${openOracleResult?.hash ?? ''}`;
    const successfulCreateKey = openOracleResult?.action === 'createReportInstance' ? openOracleResult.hash : undefined;
    const showCreateSuccess = successfulCreateKey !== undefined && successfulCreateKey !== dismissedCreateSuccessKey;
    useEffect(() => {
        if (successfulCreateKey === undefined)
            return;
        setTouchedCreateFields(new Set());
    }, [successfulCreateKey]);
    useEffect(() => {
        let cancelled = false;
        const shouldLoadBrowse = view === 'browse' || openOracleResult?.action === 'createReportInstance';
        if (!environmentReady || !shouldLoadBrowse)
            return undefined;
        const runBrowseLoad = async () => {
            await browseLoad.run({
                isCurrent: () => !cancelled,
                onStart: () => {
                    setBrowseLoadState({ requestKey: browseRequestKey, status: 'loading' });
                },
                load: async () => await loadBrowseReports(browsePageIndex, BROWSE_PAGE_SIZE),
                onSuccess: page => {
                    const pageCount = getPaginationPageCount(page.reportCount, BROWSE_PAGE_SIZE);
                    const resolvedPageIndex = resolvePaginationPageIndex(browsePageIndex, pageCount);
                    if (resolvedPageIndex !== browsePageIndex) {
                        setBrowsePage(undefined);
                        setBrowsePageIndex(resolvedPageIndex);
                        return;
                    }
                    setBrowsePage(page);
                    setBrowseLoadState({ requestKey: browseRequestKey, status: 'ready' });
                },
                onError: error => {
                    setBrowsePage(undefined);
                    setBrowseLoadState({
                        message: error instanceof Error ? error.message : openOracleCopy.reportLoadError,
                        requestKey: browseRequestKey,
                        status: 'error',
                    });
                },
            });
        };
        void runBrowseLoad();
        return () => {
            cancelled = true;
        };
    }, [browsePageIndex, browseReloadKey, environmentReady, environmentRefreshKey, loadBrowseReports, openOracleResult?.action, openOracleResult?.hash, view]);
    const browseLoadStateIsCurrent = browseLoadState.requestKey === browseRequestKey;
    const loadingBrowse = !environmentReady || !browseLoadStateIsCurrent || browseLoadState.status === 'loading';
    const browseLoadError = browseLoadStateIsCurrent && browseLoadState.status === 'error' ? browseLoadState.message : undefined;
    const browseReady = browseLoadStateIsCurrent && browseLoadState.status === 'ready';
    const currentBrowsePage = browseReady ? browsePage : undefined;
    const normalizedBrowseSearchText = browseSearchText.trim().toLowerCase();
    const browseReportCount = currentBrowsePage?.reportCount ?? 0n;
    const browsePageCount = currentBrowsePage === undefined ? undefined : getPaginationPageCount(browseReportCount, BROWSE_PAGE_SIZE);
    const browseHasPreviousPage = browsePageIndex > 0;
    const browseHasNextPage = getHasNextPaginationPage(browsePageIndex, browsePageCount);
    const filteredBrowseReports = currentBrowsePage?.reports.filter(report => {
        const status = getOpenOracleReportStatus(report);
        if (browseStatusFilter !== 'all' && status !== browseStatusFilter)
            return false;
        if (normalizedBrowseSearchText === '')
            return true;
        return (report.reportId.toString().includes(normalizedBrowseSearchText) ||
            report.token1Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
            report.token2Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
            report.token1.toLowerCase().includes(normalizedBrowseSearchText) ||
            report.token2.toLowerCase().includes(normalizedBrowseSearchText));
    }) ?? [];
    const hasActiveBrowseFilters = normalizedBrowseSearchText !== '' || browseStatusFilter !== 'all';
    const openBrowseReport = async (reportId) => {
        onOpenOracleFormChange({ reportId: reportId.toString() });
        onActiveViewChange('selected-report');
        await onLoadOracleReport(reportId.toString());
    };
    return (_jsxs("div", { className: 'route-view-flow', children: [view === 'browse' ? (_jsx("div", { className: 'workflow-stack route-workflow-stack', children: _jsxs(SectionBlock, { actions: _jsx(PaginationControls, { hasNextPage: browseHasNextPage, hasPreviousPage: browseHasPreviousPage, loading: loadingBrowse, onNextPage: () => setBrowsePageIndex(current => current + 1), onPreviousPage: () => setBrowsePageIndex(current => Math.max(0, current - 1)), summary: currentBrowsePage === undefined ? undefined : formatPaginationSummary(browsePageIndex, browsePageCount) }), density: 'compact', title: openOracleCopy.browseReports, variant: 'plain', children: [_jsxs("div", { className: 'filter-toolbar', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.searchReports }), _jsx(FormInput, { value: browseSearchText, onInput: event => setBrowseSearchText(event.currentTarget.value), placeholder: openOracleCopy.searchByReportIdTokenSymbolOrTokenAddress })] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: commonCopy.status }), _jsxs("select", { value: browseStatusFilter, onChange: event => setBrowseStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value)), children: [_jsx("option", { value: 'all', children: openOracleCopy.allStatuses }), _jsx("option", { value: 'Pending', children: commonCopy.pending }), _jsx("option", { value: 'Disputed', children: openOracleCopy.disputed }), _jsx("option", { value: 'Settled', children: commonCopy.settled })] })] })] }), currentBrowsePage === undefined || !hasActiveBrowseFilters ? undefined : _jsx("p", { className: 'detail', children: openOracleCopy.formatBrowseShownCountSummary(filteredBrowseReports.length.toString(), currentBrowsePage.reports.length.toString()) }), (() => {
                            if (loadingBrowse)
                                return (_jsx(StateHint, { presentation: {
                                        key: 'loading',
                                        badgeLabel: commonCopy.loading,
                                        badgeTone: 'pending',
                                        detail: environmentReady ? openOracleCopy.reportSummariesRefreshingDetail : openOracleCopy.reportSummariesInitializingDetail,
                                        detailIsLoading: true,
                                    } }));
                            if (browseLoadError !== undefined)
                                return (_jsx(StateHint, { announcement: 'assertive', actions: _jsx("button", { className: 'secondary', type: 'button', onClick: () => setBrowseReloadKey(current => current + 1), children: openOracleCopy.retryReports }), presentation: {
                                        key: 'load_failed',
                                        badgeLabel: commonCopy.failed,
                                        badgeTone: 'error',
                                        detail: browseLoadError,
                                    } }));
                            if (currentBrowsePage === undefined)
                                return undefined;
                            if (currentBrowsePage.reports.length === 0)
                                return _jsx(StateHint, { announcement: 'polite', presentation: { key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail: openOracleCopy.oracleGamesEmpty } });
                            if (filteredBrowseReports.length === 0)
                                return _jsx(StateHint, { announcement: 'polite', presentation: { key: 'empty', badgeLabel: commonCopy.noMatches, badgeTone: 'muted', detail: openOracleCopy.reportFiltersEmpty } });
                            return _jsx("div", { className: 'comparison-record-list', children: filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId))) });
                        })()] }) })) : undefined, view === 'create' ? (_jsxs("div", { className: 'workflow-stack route-workflow-stack', children: [!showCreateSuccess ? undefined : (_jsx(SectionBlock, { title: openOracleCopy.nextStep, children: _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'primary', type: 'button', onClick: () => {
                                        setDismissedCreateSuccessKey(successfulCreateKey);
                                        onActiveViewChange('browse');
                                    }, children: commonCopy.returnToBrowse }), _jsx("button", { className: 'secondary', type: 'button', onClick: () => setDismissedCreateSuccessKey(successfulCreateKey), children: openOracleCopy.createAnother })] }) })), showCreateSuccess ? undefined : (_jsxs(SectionBlock, { title: openOracleCopy.openOracleGame, variant: 'plain', children: [_jsx("p", { className: 'notice warning', children: openOracleCopy.standaloneOracleWarningDetail }), _jsx("p", { className: 'detail', children: openOracleCopy.standaloneOracleIntroduction }), _jsx(TransactionObjectContext, { className: 'mobile-workflow-context', title: openOracleCopy.reportAtAGlance, items: [
                                    { label: openOracleCopy.baseToken, value: _jsx(AddressValue, { address: openOracleCreateForm.token1Address.trim() === '' ? undefined : openOracleCreateForm.token1Address, copyable: false, responsiveAbbreviation: true }) },
                                    { label: openOracleCopy.quoteToken, value: _jsx(AddressValue, { address: openOracleCreateForm.token2Address.trim() === '' ? undefined : openOracleCreateForm.token2Address, copyable: false, responsiveAbbreviation: true }) },
                                    { label: transactionReviewCopy.youPay, value: `${openOracleCreateForm.ethValue || commonCopy.metricUnavailablePlaceholder} ${commonCopy.eth}` },
                                ] }), _jsxs("div", { className: 'form-grid', children: [_jsx(SectionBlock, { headingLevel: 4, title: openOracleCopy.tokenPair, variant: 'embedded', children: _jsxs("div", { className: 'field-row', children: [_jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: openOracleCopy.token1Address }), _jsx(FormInput, { "aria-describedby": token1AddressError === undefined ? undefined : 'open-oracle-token1-address-error', "aria-label": openOracleCopy.token1Address, invalid: token1AddressError !== undefined, onBlur: () => markCreateFieldTouched('token1Address'), onInput: event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value }), placeholder: commonCopy.hexValuePlaceholder, value: openOracleCreateForm.token1Address })] }), token1AddressError === undefined ? undefined : (_jsx("p", { className: 'field-error', id: 'open-oracle-token1-address-error', role: 'alert', children: token1AddressError }))] }), _jsxs("div", { className: 'field', children: [_jsxs("label", { children: [_jsx("span", { children: openOracleCopy.token2Address }), _jsx(FormInput, { "aria-describedby": token2AddressError === undefined ? undefined : 'open-oracle-token2-address-error', "aria-label": openOracleCopy.token2Address, invalid: token2AddressError !== undefined, onBlur: () => markCreateFieldTouched('token2Address'), onInput: event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value }), placeholder: commonCopy.hexValuePlaceholder, value: openOracleCreateForm.token2Address })] }), token2AddressError === undefined ? undefined : (_jsx("p", { className: 'field-error', id: 'open-oracle-token2-address-error', role: 'alert', children: token2AddressError }))] })] }) }), _jsxs(SectionBlock, { headingLevel: 4, title: openOracleCopy.initialEconomics, variant: 'embedded', children: [_jsxs("div", { className: 'field-row', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.exactToken1Report }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('exactToken1Report'), exactToken1ReportError, 'open-oracle-exact-token1-report-help'), "aria-label": openOracleCopy.exactToken1Report, inputMode: 'decimal', invalid: exactToken1ReportError !== undefined, onBlur: () => markCreateFieldTouched('exactToken1Report'), onInput: event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value }), value: openOracleCreateForm.exactToken1Report }), _jsx("p", { id: 'open-oracle-exact-token1-report-help', className: 'field-help', children: openOracleCopy.initialToken1AmountHelpText }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('exactToken1Report'), exactToken1ReportError)] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.initialToken2Amount }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('initialToken2Amount'), initialToken2AmountError, 'open-oracle-initial-token2-amount-help'), "aria-label": openOracleCopy.initialToken2Amount, inputMode: 'decimal', invalid: initialToken2AmountError !== undefined, onBlur: () => markCreateFieldTouched('initialToken2Amount'), onInput: event => onOpenOracleCreateFormChange({ initialToken2Amount: event.currentTarget.value }), value: openOracleCreateForm.initialToken2Amount }), _jsx("p", { id: 'open-oracle-initial-token2-amount-help', className: 'field-help', children: openOracleCopy.initialToken2AmountHelpText }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('initialToken2Amount'), initialToken2AmountError)] })] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.settlerReward }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('settlerRewardEthAmount'), settlerRewardError, 'open-oracle-settler-reward-help'), "aria-label": openOracleCopy.settlerReward, inputMode: 'decimal', invalid: settlerRewardError !== undefined, onBlur: () => markCreateFieldTouched('settlerRewardEthAmount'), onInput: event => onOpenOracleCreateFormChange({ settlerRewardEthAmount: event.currentTarget.value }), value: openOracleCreateForm.settlerRewardEthAmount }), _jsx("p", { id: 'open-oracle-settler-reward-help', className: 'field-help', children: openOracleCopy.settlerRewardHelpText }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('settlerRewardEthAmount'), settlerRewardError)] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.ethValueToSend }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('ethValue'), ethValueError, 'open-oracle-eth-value-help'), "aria-label": openOracleCopy.ethValueToSend, inputMode: 'decimal', invalid: ethValueError !== undefined, onBlur: () => markCreateFieldTouched('ethValue'), onInput: event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value }), value: openOracleCreateForm.ethValue }), _jsx("p", { id: 'open-oracle-eth-value-help', className: 'field-help', children: openOracleCopy.creationFundingRequirementHelpText }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('ethValue'), ethValueError)] })] }), _jsxs(ReadOnlyDetailAccordion, { title: openOracleCopy.advancedDisputeAndTimingSettings, children: [_jsx("p", { className: 'detail', children: openOracleCopy.advancedDisputeAndTimingSettingsDetail }), _jsxs("div", { className: 'field-row', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.disputeFeePercentage }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('feePercentage'), feePercentageError), "aria-label": openOracleCopy.disputeFeePercentage, inputMode: 'decimal', invalid: feePercentageError !== undefined, onBlur: () => markCreateFieldTouched('feePercentage'), onInput: event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value }), value: openOracleCreateForm.feePercentage }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('feePercentage'), feePercentageError)] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: commonCopy.multiplier }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('multiplier'), multiplierError, 'open-oracle-multiplier-help'), "aria-label": commonCopy.multiplier, inputMode: 'numeric', invalid: multiplierError !== undefined, onBlur: () => markCreateFieldTouched('multiplier'), onInput: event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value }), value: openOracleCreateForm.multiplier }), _jsx("p", { id: 'open-oracle-multiplier-help', className: 'field-help', children: openOracleCopy.escalationMultiplierHelpText }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('multiplier'), multiplierError)] })] }), _jsxs(SectionBlock, { headingLevel: 4, title: openOracleCopy.timing, variant: 'embedded', children: [_jsxs("div", { className: 'field-row', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.settlementDelaySeconds }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('settlementTime'), settlementTimeError), "aria-label": openOracleCopy.settlementDelaySeconds, inputMode: 'numeric', invalid: settlementTimeError !== undefined, onBlur: () => markCreateFieldTouched('settlementTime'), onInput: event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value }), value: openOracleCreateForm.settlementTime }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('settlementTime'), settlementTimeError)] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.escalationHalt }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('escalationHalt'), escalationHaltError, 'open-oracle-escalation-halt-help'), "aria-label": openOracleCopy.escalationHalt, inputMode: 'decimal', invalid: escalationHaltError !== undefined, onBlur: () => markCreateFieldTouched('escalationHalt'), onInput: event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value }), value: openOracleCreateForm.escalationHalt }), _jsx("p", { id: 'open-oracle-escalation-halt-help', className: 'field-help', children: openOracleCopy.disputeEscalationStopAmountHelpText }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('escalationHalt'), escalationHaltError)] })] }), _jsxs("div", { className: 'field-row', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.disputeDelaySeconds }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('disputeDelay'), disputeDelayError), "aria-label": openOracleCopy.disputeDelaySeconds, inputMode: 'numeric', invalid: disputeDelayError !== undefined, onBlur: () => markCreateFieldTouched('disputeDelay'), onInput: event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value }), value: openOracleCreateForm.disputeDelay }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('disputeDelay'), disputeDelayError)] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: openOracleCopy.protocolFeePercentage }), _jsx(FormInput, { "aria-describedby": getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('protocolFee'), protocolFeeError), "aria-label": openOracleCopy.protocolFeePercentage, inputMode: 'decimal', invalid: protocolFeeError !== undefined, onBlur: () => markCreateFieldTouched('protocolFee'), onInput: event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value }), value: openOracleCreateForm.protocolFee }), renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('protocolFee'), protocolFeeError)] })] })] }), _jsx("h4", { children: openOracleCopy.parameterDetails }), _jsx("p", { className: 'detail', children: openOracleCopy.standaloneParameterDetails })] }), _jsx(TransactionReview, { context: [
                                            { label: openOracleCopy.token1Address, value: _jsx(AddressValue, { address: openOracleCreateForm.token1Address.trim() === '' ? undefined : openOracleCreateForm.token1Address }) },
                                            { label: openOracleCopy.token2Address, value: _jsx(AddressValue, { address: openOracleCreateForm.token2Address.trim() === '' ? undefined : openOracleCreateForm.token2Address }) },
                                            { label: transactionReviewCopy.network, value: _jsx(TransactionNetworkValue, {}) },
                                        ], primary: [
                                            { label: transactionReviewCopy.youPay, value: `${openOracleCreateForm.ethValue || commonCopy.metricUnavailablePlaceholder} ${commonCopy.eth}` },
                                            { label: openOracleCopy.reportAmounts, value: `${openOracleCreateForm.exactToken1Report || commonCopy.metricUnavailablePlaceholder} / ${openOracleCreateForm.initialToken2Amount || commonCopy.metricUnavailablePlaceholder}` },
                                        ], details: [
                                            { label: openOracleCopy.settlerReward, value: `${openOracleCreateForm.settlerRewardEthAmount || commonCopy.metricUnavailablePlaceholder} ${commonCopy.eth}` },
                                            { label: openOracleCopy.settlementDelaySeconds, value: formatOpenOracleReviewDuration(openOracleCreateForm.settlementTime) },
                                            { label: openOracleCopy.disputeDelaySeconds, value: formatOpenOracleReviewDuration(openOracleCreateForm.disputeDelay) },
                                            { label: openOracleCopy.disputeFeePercentage, value: `${openOracleCreateForm.feePercentage || commonCopy.metricUnavailablePlaceholder}%` },
                                            { label: commonCopy.multiplier, value: formatOpenOracleMultiplier(tryParseBigIntInput(openOracleCreateForm.multiplier)) },
                                            { label: openOracleCopy.escalationHalt, value: openOracleCreateForm.escalationHalt || commonCopy.metricUnavailablePlaceholder },
                                            { label: openOracleCopy.protocolFeePercentage, value: `${openOracleCreateForm.protocolFee || commonCopy.metricUnavailablePlaceholder}%` },
                                        ], risks: [openOracleCopy.standaloneFundingRisk, openOracleCopy.standaloneDisputeSettingsRisk] }), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: openOracleCopy.createStandaloneOracleGame, pendingLabel: openOracleCopy.creating, onClick: onCreateOpenOracleGame, pending: loadingOpenOracleCreate, availability: { disabled: !isOnActiveAppChain || createGuardMessage !== undefined || !createValidation.isValid || hasCreateContractFieldErrors, reason: createAvailabilityMessage }, disabledReasonElementId: createDisabledReasonElementId, showDisabledReason: createDisabledReasonElementId === undefined }) })] })] })), _jsx(ErrorNotice, { message: openOracleError })] })) : undefined, view === 'selected-report' ? (_jsx("div", { className: 'workflow-stack route-workflow-stack open-oracle-report-stack', children: renderReportDetailsCard(effectiveOpenOracleReportDetails, openOracleForm, openOracleTokenAccessState, openOracleDisputeSubmission, openOracleActiveAction, openOracleActiveWithdrawalBalance, openOracleResult, openOracleReportLookupState, openOracleWithdrawalBalanceChecking, openOracleWithdrawalReviewMessage, accountState.address, isConnected, isOnActiveAppChain, selectedReportModal, onApproveToken1, onApproveToken2, onDisputeReport, onLoadOracleReport, onOpenOracleFormChange, changeSelectedReportModal, onSettleReport, onWithdrawOpenOracleBalance, openOracleWithdrawableBalances, openOracleWithdrawableBalancesError, openOracleWithdrawableBalancesLoading) })) : undefined, _jsx(ErrorNotice, { message: openOracleError })] }));
}
//# sourceMappingURL=OpenOracleSection.js.map