import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as zoltarCopy from '../../../copy/zoltar.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js';
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js';
export function getMigrationOutcomeHeldBalance(child, childUniverseRepBalances) {
    if (!child.exists)
        return 0n;
    return childUniverseRepBalances[child.universeId.toString()];
}
export function getMigrationOutcomeSplitLimit(childUniverses, childUniverseRepBalances, migrationBalance, selectedOutcomeIndexSet) {
    if (migrationBalance === undefined)
        return undefined;
    let splitLimit = undefined;
    for (const child of childUniverses) {
        if (!selectedOutcomeIndexSet.has(child.outcomeIndex.toString()))
            continue;
        const heldBalance = getMigrationOutcomeHeldBalance(child, childUniverseRepBalances);
        if (heldBalance === undefined)
            return undefined;
        const remainingCapacity = migrationBalance > heldBalance ? migrationBalance - heldBalance : 0n;
        splitLimit = splitLimit === undefined || remainingCapacity < splitLimit ? remainingCapacity : splitLimit;
    }
    return splitLimit ?? 0n;
}
export function MigrationOutcomeUniversesSection({ childUniverses, childUniverseRepBalances, disabled, isScalarFork, migrationBalance, onAddNextOutcome, onToggleOutcomeIndex, selectedOutcomeIndexSet }) {
    const hasAddableOutcome = childUniverses.some(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()));
    return (_jsx(WorkflowSubsection, { badge: isScalarFork ? (_jsx("button", { className: 'quiet', type: 'button', onClick: onAddNextOutcome, disabled: disabled || !hasAddableOutcome, children: zoltarCopy.addAnotherUniverse })) : undefined, className: 'migration-outcome-section', title: zoltarCopy.outcomeUniverses, children: childUniverses.length === 0 ? (_jsx("p", { className: 'detail', children: zoltarCopy.outcomeUniversesEmpty })) : (_jsx(OutcomeSelectionList, { items: childUniverses.map(child => {
                const selected = selectedOutcomeIndexSet.has(child.outcomeIndex.toString());
                const heldBalance = getMigrationOutcomeHeldBalance(child, childUniverseRepBalances);
                const isHeldBalanceLoading = child.exists && heldBalance === undefined;
                return {
                    details: (_jsxs(_Fragment, { children: [_jsxs("span", { children: [zoltarCopy.walletBalanceLabel, ' ', _jsx("strong", { children: _jsx(CurrencyValue, { copyable: false, loading: isHeldBalanceLoading, value: heldBalance, suffix: commonCopy.rep }) })] }), _jsxs("span", { children: [zoltarCopy.migratedBalanceLabel, ' ', _jsxs("strong", { children: [_jsx(CurrencyValue, { copyable: false, loading: isHeldBalanceLoading, value: heldBalance, suffix: commonCopy.rep }), " / ", _jsx(CurrencyValue, { copyable: false, loading: migrationBalance === undefined, value: migrationBalance, suffix: commonCopy.rep })] })] })] })),
                    disabled,
                    key: child.universeId.toString(),
                    label: child.outcomeLabel,
                    onSelect: () => onToggleOutcomeIndex(child.outcomeIndex),
                    selected,
                };
            }) })) }));
}
//# sourceMappingURL=MigrationOutcomeUniversesSection.js.map