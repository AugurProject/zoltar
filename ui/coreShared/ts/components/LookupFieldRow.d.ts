import type { ComponentChildren, JSX } from 'preact';
type LookupFieldRowProps = {
    action?: ComponentChildren;
    disabled?: boolean;
    inputClassName?: string;
    inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode'];
    invalid?: boolean;
    label: ComponentChildren;
    onInput: (value: string) => void;
    placeholder?: string;
    resolvedValue?: ComponentChildren;
    resolvedValueLabel?: ComponentChildren;
    value: string;
};
export declare function LookupFieldRow({ action, disabled, inputClassName, inputMode, invalid, label, onInput, placeholder, resolvedValue, resolvedValueLabel, value }: LookupFieldRowProps): JSX.Element;
export {};
//# sourceMappingURL=LookupFieldRow.d.ts.map