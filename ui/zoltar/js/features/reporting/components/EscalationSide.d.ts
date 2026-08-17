import type { JSX } from 'preact';
import type { EscalationDeposit } from '@zoltar/ui-core-shared/types/contracts.js';
type EscalationSideDisplay = {
    balance: bigint | undefined;
    label: string;
    userDeposits: EscalationDeposit[] | undefined;
    userStake: bigint | undefined;
};
type EscalationSideProps = {
    bindingCapital: bigint | undefined;
    chartScaleMax: bigint;
    disabled?: boolean;
    isLeading: boolean;
    isSelected: boolean;
    isTabStop: boolean;
    onSelect: () => void;
    side: EscalationSideDisplay;
};
export declare function EscalationSide({ bindingCapital, chartScaleMax, disabled, isLeading, isSelected, isTabStop, onSelect, side }: EscalationSideProps): JSX.Element;
export {};
//# sourceMappingURL=EscalationSide.d.ts.map