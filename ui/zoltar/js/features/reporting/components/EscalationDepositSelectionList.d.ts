import type { ComponentChildren } from 'preact';
import type { EscalationDeposit } from '@zoltar/ui-core-shared/types/contracts.js';
type EscalationDepositSelectionItem = {
    deposit: EscalationDeposit;
    details: ComponentChildren[];
    secondaryDetails?: ComponentChildren[];
};
type EscalationDepositSelectionListProps = {
    disabled?: boolean;
    items: EscalationDepositSelectionItem[];
    onSelectionChange: (selectedDepositIndexes: bigint[]) => void;
    selectedDepositIndexes: bigint[];
};
export declare function EscalationDepositSelectionList({ disabled, items, onSelectionChange, selectedDepositIndexes }: EscalationDepositSelectionListProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=EscalationDepositSelectionList.d.ts.map