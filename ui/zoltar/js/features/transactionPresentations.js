import { jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js';
import * as marketCopy from '../copy/market.js';
import * as openOracleCopy from '../copy/openOracle.js';
import * as securityPoolCopy from '../copy/securityPool.js';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js';
import { UniverseLink } from './universes/components/UniverseLink.js';
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { getReportingOutcomeLabel } from './reporting/lib/reporting.js';
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js';
import { buildIntent, buildPresentation, withWarning } from '@zoltar/ui-core-shared/lib/transactionPresentations.js';
function humanizeAction(action) {
    return action
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, value => value.toUpperCase())
        .replaceAll(/\bRep\b/g, commonCopy.rep)
        .replaceAll(/\bEth\b/g, commonCopy.eth)
        .replaceAll(/\bWeth\b/g, commonCopy.weth);
}
export function createDeploymentTransactionIntent(stepLabel) {
    return buildIntent({
        action: 'deploy',
        source: 'deployment',
        submittedTitle: transactionCopy.formatDeployingValue(stepLabel),
    });
}
export function createDeploymentSuccessPresentation(stepLabel, hash) {
    return buildPresentation({
        hash,
        title: transactionCopy.formatValueDeployed(stepLabel),
        tone: 'success',
    });
}
function getMarketCreationTransactionRows(context) {
    return [
        ...(context.title === undefined || context.title.trim() === '' ? [] : [{ label: marketCopy.title, value: context.title.trim() }]),
        { label: marketCopy.questionType, value: getMarketTypeLabel(context.marketType) },
        ...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: context.universeId }) }]),
    ];
}
export function createMarketCreationTransactionIntent(context) {
    return buildIntent({
        action: 'createMarket',
        rows: getMarketCreationTransactionRows(context),
        source: 'zoltar',
        submittedTitle: transactionCopy.creatingQuestion,
    });
}
export function createMarketCreationSuccessPresentation(result, context) {
    return buildPresentation({
        hash: result.createQuestionHash,
        rows: [{ label: commonCopy.questionId, value: _jsx(IdentifierValue, { value: result.questionId }) }, ...getMarketCreationTransactionRows({ ...context, marketType: result.marketType })],
        title: transactionCopy.questionCreated,
        tone: 'success',
    });
}
export function createMarketCreationWarningPresentation(result, message, context) {
    return withWarning(createMarketCreationSuccessPresentation(result, context), message);
}
function getQuestionUniverseTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [
        ...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: context.universeId }) }]),
        ...(context.questionId === undefined || context.questionId.trim() === '' ? [] : [{ label: commonCopy.questionId, value: _jsx(IdentifierValue, { value: context.questionId.trim() }) }]),
    ];
}
export function createZoltarForkTransactionIntent(actionName, context) {
    return buildIntent({
        action: actionName,
        rows: getQuestionUniverseTransactionRows(context),
        source: 'zoltar',
        submittedTitle: actionName === 'approve' ? transactionCopy.approvingForkRep : transactionCopy.forkingZoltar,
    });
}
export function createZoltarForkSuccessPresentation(result) {
    const title = result.action === 'approveForkRep' ? transactionCopy.forkRepApproved : transactionCopy.zoltarForkSubmitted;
    return buildPresentation({
        hash: result.hash,
        rows: [
            { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: result.universeId }) },
            { label: commonCopy.questionId, value: _jsx(IdentifierValue, { value: result.questionId }) },
        ],
        title,
        tone: 'success',
    });
}
export function createZoltarForkWarningPresentation(result, message) {
    return withWarning(createZoltarForkSuccessPresentation(result), message);
}
function getChildUniverseTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: context.universeId }) }]), ...(context.outcomeIndex === undefined ? [] : [{ label: commonCopy.outcomeIndex, value: context.outcomeIndex.toString() }])];
}
export function createChildUniverseTransactionIntent(source, context) {
    return buildIntent({
        action: 'createChildUniverse',
        rows: getChildUniverseTransactionRows(context),
        source,
        submittedTitle: transactionCopy.deployingChildUniverse,
    });
}
export function createChildUniverseSuccessPresentation(result) {
    return buildPresentation({
        hash: result.hash,
        rows: [
            { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: result.universeId }) },
            { label: commonCopy.outcomeIndex, value: result.outcomeIndex.toString() },
        ],
        title: transactionCopy.childUniverseDeployed,
        tone: 'success',
    });
}
export function createChildUniverseWarningPresentation(result, message) {
    return withWarning(createChildUniverseSuccessPresentation(result), message);
}
function getZoltarMigrationTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [
        ...(context.universeId === undefined ? [] : [{ label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: context.universeId }) }]),
        ...(context.amount === undefined || context.amount.trim() === '' ? [] : [{ label: commonCopy.amount, value: `${context.amount.trim()} ${commonCopy.rep}` }]),
        ...(context.outcomeIndexes === undefined || context.outcomeIndexes.trim() === '' ? [] : [{ label: transactionCopy.outcomeIndexes, value: context.outcomeIndexes.trim() }]),
    ];
}
export function createZoltarMigrationTransactionIntent(actionName, context) {
    return buildIntent({
        action: actionName,
        rows: getZoltarMigrationTransactionRows(context),
        source: 'zoltar',
        submittedTitle: actionName === 'prepare' ? transactionCopy.preparingRep : transactionCopy.splittingRep,
    });
}
export function createZoltarMigrationSuccessPresentation(result) {
    return buildPresentation({
        detail: result.action === 'addRepToMigrationBalance' ? transactionCopy.migrationRepPreparationSuccessDetail : transactionCopy.repSplitSuccessDetail,
        hash: result.hash,
        rows: [
            { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: result.universeId }) },
            { label: commonCopy.amount, value: `${formatCurrencyBalance(result.amountAttoRep)} ${commonCopy.rep}` },
            { label: transactionCopy.outcomeIndexes, value: result.outcomeIndexes.length === 0 ? commonCopy.none : result.outcomeIndexes.join(', ') },
        ],
        title: result.action === 'addRepToMigrationBalance' ? transactionCopy.repPrepared : transactionCopy.repSplit,
        tone: 'success',
    });
}
export function createZoltarMigrationWarningPresentation(result, message) {
    return withWarning(createZoltarMigrationSuccessPresentation(result), message);
}
function getPoolUniverseTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [
        ...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ identityKey: 'security-pool', label: transactionCopy.pool, value: _jsx(AddressValue, { address: context.securityPoolAddress }) }]),
        ...(context.universeId === undefined ? [] : [{ identityKey: 'universe', label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: context.universeId }) }]),
    ];
}
function getReportingTransactionRows(context) {
    return [...(getPoolUniverseTransactionRows(context) ?? []), ...(context?.outcome === undefined ? [] : [{ label: commonCopy.outcome, value: getReportingOutcomeLabel(context.outcome) }])];
}
export function createReportingTransactionIntent(actionName, context) {
    return buildIntent({
        action: actionName,
        rows: getReportingTransactionRows(context),
        source: 'reporting',
        submittedTitle: humanizeAction(actionName),
    });
}
export function createReportingSuccessPresentation(result) {
    const detail = result.action === 'reportOutcome' ? transactionCopy.reportingContributionSuccessDetail : transactionCopy.escalationDepositsSettledDetail;
    return buildPresentation({
        detail,
        hash: result.hash,
        rows: [
            { label: transactionCopy.pool, value: _jsx(AddressValue, { address: result.securityPoolAddress }) },
            { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: result.universeId }) },
            { label: commonCopy.outcome, value: getReportingOutcomeLabel(result.outcome) },
        ],
        title: humanizeAction(result.action),
        tone: 'success',
    });
}
export function createReportingWarningPresentation(result, message) {
    return withWarning(createReportingSuccessPresentation(result), message);
}
function getPoolOracleTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [...(context.securityPoolAddress === undefined ? [] : [{ label: commonCopy.securityPoolAddress, value: _jsx(AddressValue, { address: context.securityPoolAddress }) }]), { label: securityPoolCopy.oracleManager, value: _jsx(AddressValue, { address: context.managerAddress }) }];
}
export function createPoolOracleTransactionIntent(actionName, context) {
    let submittedTitle = transactionCopy.executingStagedOperation;
    if (actionName === 'requestPrice') {
        submittedTitle = transactionCopy.requestingPrice;
    }
    return buildIntent({
        action: actionName,
        rows: getPoolOracleTransactionRows(context),
        source: 'pool-oracle',
        submittedTitle,
    });
}
export function createPoolOracleSuccessPresentation(result, context) {
    let title = transactionCopy.stagedOperationExecuted;
    if (result.action === 'requestPrice') {
        title = transactionCopy.priceRequested;
    }
    return buildPresentation({
        hash: result.hash,
        rows: getPoolOracleTransactionRows(context),
        title,
        tone: 'success',
    });
}
export function createPoolOracleWarningPresentation(result, message, context) {
    return withWarning(createPoolOracleSuccessPresentation(result, context), message);
}
function getOpenOracleTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [
        ...(context.reportId === undefined || context.reportId.trim() === '' ? [] : [{ label: openOracleCopy.reportId, value: context.reportId }]),
        ...(context.tokenPair === undefined || context.tokenPair.trim() === '' ? [] : [{ label: openOracleCopy.tokenPair, value: context.tokenPair }]),
        ...(context.openOracleAddress === undefined ? [] : [{ label: openOracleCopy.oracleAddress, value: _jsx(AddressValue, { address: context.openOracleAddress }) }]),
    ];
}
function getOpenOracleSubmittedTitle(actionName, context) {
    if (actionName === 'approveToken1')
        return openOracleCopy.formatApproveToken(context?.token1Symbol ?? openOracleCopy.baseToken);
    if (actionName === 'approveToken2')
        return openOracleCopy.formatApproveToken(context?.token2Symbol ?? openOracleCopy.quoteToken);
    if (actionName === 'createReportInstance')
        return openOracleCopy.createReport;
    if (actionName === 'settle')
        return openOracleCopy.settlingReportTitle;
    if (actionName === 'withdrawBalance')
        return openOracleCopy.withdrawBalance(context?.withdrawalTokenSymbol ?? openOracleCopy.oracleBalance);
    return humanizeAction(actionName);
}
function getOpenOracleSuccessTitle(actionName, context) {
    if (actionName === 'approveToken1')
        return openOracleCopy.formatTokenApproved(context?.token1Symbol ?? openOracleCopy.baseToken);
    if (actionName === 'approveToken2')
        return openOracleCopy.formatTokenApproved(context?.token2Symbol ?? openOracleCopy.quoteToken);
    if (actionName === 'createReportInstance')
        return openOracleCopy.reportCreated;
    if (actionName === 'settle')
        return openOracleCopy.reportSettled;
    if (actionName === 'withdrawBalance')
        return openOracleCopy.formatTokenWithdrawn(context?.withdrawalTokenSymbol ?? openOracleCopy.oracleBalance);
    return humanizeAction(actionName);
}
export function createOpenOracleTransactionIntent(actionName, context) {
    return buildIntent({
        action: actionName,
        rows: getOpenOracleTransactionRows(context),
        source: 'open-oracle',
        submittedTitle: getOpenOracleSubmittedTitle(actionName, context),
    });
}
export function createOpenOracleSuccessPresentation(result, context) {
    return buildPresentation({
        hash: result.hash,
        rows: getOpenOracleTransactionRows(context),
        title: getOpenOracleSuccessTitle(result.action, context),
        tone: 'success',
    });
}
export function createOpenOracleWarningPresentation(result, message, context) {
    return withWarning(createOpenOracleSuccessPresentation(result, context), message);
}
//# sourceMappingURL=transactionPresentations.js.map