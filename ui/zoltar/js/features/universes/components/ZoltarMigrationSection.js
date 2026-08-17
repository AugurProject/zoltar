import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as zoltarCopy from '../../../copy/zoltar.js';
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js';
import { useMemo } from 'preact/hooks';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js';
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js';
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js';
import { TransactionUniverseValue } from './TransactionUniverseValue.js';
import { UniverseLink } from './UniverseLink.js';
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js';
import { getMigrationOutcomeSplitLimit, MigrationOutcomeUniversesSection } from './MigrationOutcomeUniversesSection.js';
import { formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { tryParseBigIntListInput } from '@zoltar/ui-core-shared/lib/inputs.js';
import { tryParseRepAmountInput as parseMigrationAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js';
import { deriveTokenApprovalRequirement } from '@zoltar/ui-core-shared/lib/tokenApproval.js';
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
import { formatUniverseLabel } from '../lib/universe.js';
import { getMigrationGuardMessage } from '../lib/zoltarMigrationGuards.js';
import { getWrongNetworkMessage } from '@zoltar/ui-core-shared/lib/network.js';
function getMigrationAmount(value) {
    return parseMigrationAmountInput(value);
}
function getMigrationOutcomeIndexes(value) {
    return tryParseBigIntListInput(value) ?? [];
}
function getMigrationAmountSource(preparedRepBalanceAttoRep, repBalanceAttoRep) {
    return (preparedRepBalanceAttoRep ?? 0n) + (repBalanceAttoRep ?? 0n);
}
function getMissingPreparationAmount(targetAmount, preparedRepBalanceAttoRep) {
    const currentPreparedBalance = preparedRepBalanceAttoRep ?? 0n;
    return targetAmount > currentPreparedBalance ? targetAmount - currentPreparedBalance : 0n;
}
export function ZoltarMigrationSection({ accountAddress, isOnActiveAppChain, loadingZoltarForkAccess, loadingZoltarUniverse, onMigrateInternalRep, onPrepareRepForMigration, onZoltarMigrationFormChange, zoltarForkRepBalanceAttoRep, zoltarForkApproval, zoltarForkActiveAction, zoltarMigrationChildRepBalancesAttoRep, zoltarMigrationActiveAction, zoltarMigrationError, zoltarMigrationForm, zoltarMigrationPending, zoltarMigrationPreparedRepBalanceAttoRep, zoltarUniverse, zoltarUniverseState, onApproveZoltarForkRep, }) {
    const rootUniverse = zoltarUniverse;
    const universeMissing = zoltarUniverseState === 'missing';
    const hasForked = rootUniverse?.hasForked === true;
    const selectedOutcomeIndexes = useMemo(() => getMigrationOutcomeIndexes(zoltarMigrationForm.outcomeIndexes), [zoltarMigrationForm.outcomeIndexes]);
    const selectedOutcomeIndexSet = useMemo(() => new Set(selectedOutcomeIndexes.map(index => index.toString())), [selectedOutcomeIndexes]);
    const selectedChildUniverses = useMemo(() => rootUniverse?.childUniverses.filter(child => selectedOutcomeIndexSet.has(child.outcomeIndex.toString())) ?? [], [rootUniverse?.childUniverses, selectedOutcomeIndexSet]);
    const heldChildUniverses = useMemo(() => (loadingZoltarForkAccess ? [] : (rootUniverse?.childUniverses.filter(child => child.exists && (zoltarMigrationChildRepBalancesAttoRep[child.universeId.toString()] ?? 0n) > 0n) ?? [])), [loadingZoltarForkAccess, rootUniverse?.childUniverses, zoltarMigrationChildRepBalancesAttoRep]);
    const migrationAmount = getMigrationAmount(zoltarMigrationForm.amount);
    const hasValidAmount = migrationAmount !== undefined && migrationAmount > 0n;
    const isMigrationAmountInvalid = zoltarMigrationForm.amount.trim() !== '' && migrationAmount === undefined;
    const missingPreparationAmount = hasValidAmount && migrationAmount !== undefined ? getMissingPreparationAmount(migrationAmount, zoltarMigrationPreparedRepBalanceAttoRep) : 0n;
    const totalAvailableAttoRep = (zoltarMigrationPreparedRepBalanceAttoRep ?? 0n) + (zoltarForkRepBalanceAttoRep ?? 0n);
    const amountExceedsAvailableRep = hasValidAmount && migrationAmount !== undefined && migrationAmount > totalAvailableAttoRep;
    const hasEnoughRep = hasValidAmount && zoltarForkRepBalanceAttoRep !== undefined && zoltarForkRepBalanceAttoRep >= missingPreparationAmount;
    const hasPreparedBalance = hasValidAmount && zoltarMigrationPreparedRepBalanceAttoRep !== undefined && zoltarMigrationPreparedRepBalanceAttoRep >= migrationAmount;
    const approvalRequirement = deriveTokenApprovalRequirement(missingPreparationAmount, zoltarForkApproval.value);
    const hasSufficientAllowance = approvalRequirement.hasSufficientApproval;
    const hasValidOutcomeIndexes = selectedOutcomeIndexes.length > 0;
    const needsAdditionalPreparation = missingPreparationAmount > 0n;
    const splitLimit = useMemo(() => getMigrationOutcomeSplitLimit(rootUniverse?.childUniverses ?? [], zoltarMigrationChildRepBalancesAttoRep, zoltarMigrationPreparedRepBalanceAttoRep, selectedOutcomeIndexSet), [rootUniverse?.childUniverses, selectedOutcomeIndexSet, zoltarMigrationChildRepBalancesAttoRep, zoltarMigrationPreparedRepBalanceAttoRep]);
    const hasSufficientSplitLimit = migrationAmount !== undefined && splitLimit !== undefined && migrationAmount <= splitLimit;
    const canPrepare = accountAddress !== undefined && isOnActiveAppChain && rootUniverse !== undefined && hasForked && !zoltarMigrationPending && hasValidAmount && needsAdditionalPreparation && hasEnoughRep && hasSufficientAllowance;
    const canSplit = accountAddress !== undefined && isOnActiveAppChain && rootUniverse !== undefined && hasForked && !zoltarMigrationPending && hasValidAmount && hasPreparedBalance && hasValidOutcomeIndexes && hasSufficientSplitLimit;
    const migrationAmountSource = getMigrationAmountSource(zoltarMigrationPreparedRepBalanceAttoRep, zoltarForkRepBalanceAttoRep);
    const walletRepAfterPrepareAttoRep = zoltarForkRepBalanceAttoRep === undefined || missingPreparationAmount > zoltarForkRepBalanceAttoRep ? undefined : zoltarForkRepBalanceAttoRep - missingPreparationAmount;
    const custodyRepAfterPrepareAttoRep = (zoltarMigrationPreparedRepBalanceAttoRep ?? 0n) + missingPreparationAmount;
    const splitRepReceivedAttoRep = migrationAmount === undefined ? undefined : migrationAmount * BigInt(selectedChildUniverses.length);
    const workflowStage = (() => {
        if (!hasValidAmount || !hasValidOutcomeIndexes)
            return 'choose';
        if (needsAdditionalPreparation || zoltarForkActiveAction === 'approve' || zoltarMigrationActiveAction === 'prepare')
            return 'prepare';
        return 'split';
    })();
    const workflowSteps = [
        { key: 'choose', label: zoltarCopy.chooseDestinationStep },
        { key: 'prepare', label: zoltarCopy.prepareRepStep },
        { key: 'split', label: zoltarCopy.splitRepStep },
    ];
    const selectedDestinationsContent = selectedChildUniverses.length === 0
        ? zoltarCopy.outcomeSelectionRequired
        : selectedChildUniverses.map((child, index) => (_jsxs("span", { children: [index === 0 ? undefined : ', ', child.outcomeLabel, " \u00B7 ", _jsx(UniverseLink, { universeId: child.universeId })] }, child.universeId.toString())));
    const approvalGuardMessage = (() => {
        const guard = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.preparationNotForkedReason);
        if (guard !== undefined)
            return guard;
        if (!hasValidAmount || migrationAmount === undefined)
            return commonCopy.positiveAmountRequired;
        return undefined;
    })();
    const getAlreadyPreparedHint = () => {
        if (hasValidOutcomeIndexes && splitLimit === 0n)
            return zoltarCopy.migrationAmountAlreadySplitDetail;
        return zoltarCopy.migrationBalanceReadyDetail;
    };
    const prepareHintMessage = (() => {
        const guard = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.preparationNotForkedReason);
        if (guard !== undefined)
            return guard;
        if (!hasValidAmount || migrationAmount === undefined)
            return commonCopy.positiveAmountRequired;
        if (missingPreparationAmount === 0n)
            return getAlreadyPreparedHint();
        if (zoltarForkRepBalanceAttoRep === undefined || zoltarForkRepBalanceAttoRep < missingPreparationAmount)
            return zoltarCopy.formatMigrationRepShortfall(formatCurrencyBalance(missingPreparationAmount));
        if (!hasSufficientAllowance)
            return zoltarCopy.migrationApprovalPendingDetail;
        return zoltarCopy.formatAddMigrationRepDetail(formatCurrencyBalance(missingPreparationAmount));
    })();
    const splitHintMessage = (() => {
        const guard = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.migrationNotForkedReason);
        if (guard !== undefined)
            return guard;
        if (!hasValidAmount || migrationAmount === undefined)
            return commonCopy.positiveAmountRequired;
        if (!hasPreparedBalance)
            return zoltarCopy.formatMigrationPreparationRequired(formatCurrencyBalance(missingPreparationAmount ?? 0n));
        if (!hasValidOutcomeIndexes)
            return zoltarCopy.outcomeSelectionRequired;
        if (splitLimit === undefined)
            return zoltarCopy.outcomeBalancesLoading;
        if (splitLimit === 0n)
            return zoltarCopy.migrationAmountAlreadySplitDetail;
        if (!hasSufficientSplitLimit)
            return zoltarCopy.formatSplitCapacityDetail(formatCurrencyBalance(splitLimit));
        return undefined;
    })();
    const migrationAmountHintMessage = (() => {
        const guard = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.migrationNotForkedReason);
        if (guard !== undefined)
            return guard;
        if (!hasValidAmount || migrationAmount === undefined)
            return undefined;
        if (amountExceedsAvailableRep)
            return zoltarCopy.formatMigrationBalanceExceeded(formatCurrencyBalance(totalAvailableAttoRep), formatCurrencyBalance(zoltarMigrationPreparedRepBalanceAttoRep ?? 0n), formatCurrencyBalance(zoltarForkRepBalanceAttoRep ?? 0n));
        if (missingPreparationAmount === 0n)
            return getAlreadyPreparedHint();
        return zoltarCopy.formatAddMigrationRepDetail(formatCurrencyBalance(missingPreparationAmount));
    })();
    const selectAllAmount = () => {
        onZoltarMigrationFormChange({ amount: formatCurrencyInputBalance(migrationAmountSource) });
    };
    const addNextOutcome = () => {
        const nextOutcome = rootUniverse?.childUniverses.find(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()));
        if (nextOutcome === undefined)
            return;
        toggleOutcomeIndex(nextOutcome.outcomeIndex);
    };
    const toggleOutcomeIndex = (outcomeIndex) => {
        if (selectedOutcomeIndexSet.has(outcomeIndex.toString())) {
            onZoltarMigrationFormChange({
                outcomeIndexes: selectedOutcomeIndexes
                    .filter((index) => index !== outcomeIndex)
                    .map((index) => index.toString())
                    .join(', '),
            });
            return;
        }
        onZoltarMigrationFormChange({ outcomeIndexes: [...selectedOutcomeIndexes, outcomeIndex].map((index) => index.toString()).join(', ') });
    };
    if (universeMissing) {
        const presentation = getUniversePresentation(zoltarUniverseState);
        return (_jsxs(_Fragment, { children: [presentation === undefined ? undefined : _jsx(StateHint, { presentation: presentation, title: zoltarCopy.migrateRep }), _jsx(ErrorNotice, { message: zoltarMigrationError })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsxs(SectionBlock, { title: zoltarCopy.migrateRep, children: [_jsx("div", { className: 'workflow-summary-strip workflow-guide', children: _jsx("div", { className: 'workflow-summary-strip-steps migration-workflow-steps', children: workflowSteps.map(step => (_jsx("span", { className: workflowStage === step.key ? 'current' : '', children: step.label }, step.key))) }) }), _jsxs(DataGrid, { children: [_jsx(MetricField, { label: zoltarCopy.walletRepBalance, children: _jsx(CurrencyValue, { loading: loadingZoltarForkAccess && zoltarForkRepBalanceAttoRep === undefined, value: zoltarForkRepBalanceAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: zoltarCopy.migrationRepBalance, children: _jsx(CurrencyValue, { loading: loadingZoltarForkAccess && zoltarMigrationPreparedRepBalanceAttoRep === undefined, value: zoltarMigrationPreparedRepBalanceAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: commonCopy.universe, children: rootUniverse === undefined ? (_jsx("span", { className: 'loading-value', role: 'status', "aria-label": zoltarCopy.universeDataLoading, children: _jsx("span", { className: 'spinner', "aria-hidden": 'true' }) })) : (_jsx(UniverseLink, { universeId: rootUniverse.universeId })) })] }), _jsxs("div", { className: 'form-grid', children: [_jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'zoltar-migration-amount', children: zoltarCopy.migrationAmount }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { id: 'zoltar-migration-amount', className: 'field-inline-input', invalid: isMigrationAmountInvalid, inputMode: 'decimal', onInput: event => onZoltarMigrationFormChange({ amount: event.currentTarget.value }), placeholder: commonCopy.zeroDecimalPlaceholder, value: zoltarMigrationForm.amount, disabled: zoltarMigrationPending || !hasForked }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: selectAllAmount, disabled: zoltarMigrationPending || !hasForked || migrationAmountSource <= 0n, children: commonCopy.max })] }), migrationAmountHintMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: migrationAmountHintMessage })] }), _jsx(TokenApprovalControl, { actionLabel: zoltarCopy.preparingCurrentAmountLabel, allowanceError: zoltarForkApproval.error, allowanceLoading: zoltarForkApproval.loading, approvedAmount: zoltarForkApproval.value, disabled: !isOnActiveAppChain, guardMessage: approvalGuardMessage, onApprove: amount => onApproveZoltarForkRep(amount), pending: zoltarForkActiveAction === 'approve', pendingLabel: commonCopy.approvingRep, requiredAmount: missingPreparationAmount, resetKey: `${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${missingPreparationAmount.toString()}`, tokenSymbol: 'REP', tokenUnits: 18 }), rootUniverse === undefined ? undefined : (_jsx(MigrationOutcomeUniversesSection, { childUniverseRepBalances: zoltarMigrationChildRepBalancesAttoRep, childUniverses: rootUniverse.childUniverses, disabled: zoltarMigrationPending, isScalarFork: rootUniverse.forkQuestionDetails?.marketType === 'scalar', migrationBalance: zoltarMigrationPreparedRepBalanceAttoRep, onAddNextOutcome: addNextOutcome, onToggleOutcomeIndex: toggleOutcomeIndex, selectedOutcomeIndexSet: selectedOutcomeIndexSet })), heldChildUniverses.length === 0 ? undefined : (_jsx(WorkflowSubsection, { title: zoltarCopy.walletRepTokens, children: _jsx(DataGrid, { dense: true, children: heldChildUniverses.map(child => (_jsx(MetricField, { label: child.outcomeLabel, children: _jsx(WalletAssetControl, { accountAddress: accountAddress, address: child.reputationToken, isSupportedChain: isOnActiveAppChain, tokenLabel: `${formatUniverseLabel(child.universeId)} ${commonCopy.rep}` }) }, child.universeId.toString()))) }) })), _jsx(TransactionReview, { context: [
                                    { label: commonCopy.question, value: rootUniverse?.forkQuestionDetails?.title ?? commonCopy.unavailable },
                                    { label: commonCopy.universe, value: _jsx(TransactionUniverseValue, { universeId: rootUniverse?.universeId }) },
                                    { label: zoltarCopy.selectedDestinations, value: selectedDestinationsContent },
                                ], primary: [
                                    needsAdditionalPreparation ? { label: transactionReviewCopy.youPay, value: _jsx(CurrencyValue, { value: missingPreparationAmount, suffix: commonCopy.rep }) } : { label: zoltarCopy.migrationAmount, value: _jsx(CurrencyValue, { value: migrationAmount, suffix: commonCopy.rep }) },
                                    needsAdditionalPreparation ? { label: zoltarCopy.repMovedToMigrationCustody, value: _jsx(CurrencyValue, { value: missingPreparationAmount, suffix: commonCopy.rep }) } : { label: zoltarCopy.childUniverseRepReceived, value: _jsx(CurrencyValue, { value: splitRepReceivedAttoRep, suffix: commonCopy.rep }) },
                                ], risks: [zoltarCopy.migrationDestinationRisk, zoltarCopy.migrationSplitRisk] }), _jsx(ReadOnlyDetailAccordion, { title: zoltarCopy.balanceChanges, children: _jsxs(MetricGrid, { children: [_jsx(MetricField, { label: zoltarCopy.afterPrepareWalletBalance, children: _jsx(CurrencyValue, { value: walletRepAfterPrepareAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: zoltarCopy.afterPrepareCustodyBalance, children: _jsx(CurrencyValue, { value: custodyRepAfterPrepareAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: zoltarCopy.afterSplitCustodyBalanceUnchanged, children: _jsx(CurrencyValue, { value: zoltarMigrationPreparedRepBalanceAttoRep, suffix: commonCopy.rep }) }), selectedChildUniverses.map(child => (_jsx(MetricField, { label: zoltarCopy.destinationRepAfterSplit(child.outcomeLabel), children: _jsx(CurrencyValue, { value: migrationAmount === undefined || zoltarMigrationChildRepBalancesAttoRep[child.universeId.toString()] === undefined ? undefined : (zoltarMigrationChildRepBalancesAttoRep[child.universeId.toString()] ?? 0n) + migrationAmount, suffix: commonCopy.rep }) }, child.universeId.toString())))] }) }), _jsxs("div", { className: 'actions', children: [_jsx(TransactionActionButton, { idleLabel: zoltarCopy.prepareRep, pendingLabel: zoltarCopy.preparingRepPending, onClick: onPrepareRepForMigration, pending: zoltarMigrationActiveAction === 'prepare', tone: 'secondary', availability: { disabled: !canPrepare, reason: isOnActiveAppChain ? prepareHintMessage : (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) } }), _jsx(TransactionActionButton, { idleLabel: zoltarCopy.splitRep, pendingLabel: zoltarCopy.splittingRepPending, onClick: onMigrateInternalRep, pending: zoltarMigrationActiveAction === 'split', availability: { disabled: !canSplit, reason: isOnActiveAppChain ? splitHintMessage : (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) } })] })] })] }), _jsx(ErrorNotice, { message: zoltarMigrationError })] }));
}
//# sourceMappingURL=ZoltarMigrationSection.js.map