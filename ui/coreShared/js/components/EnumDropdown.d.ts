export type EnumDropdownOption<T extends string> = {
    label: string;
    value: T;
};
type EnumDropdownProps<T extends string> = {
    ariaDescribedBy?: string | undefined;
    ariaLabel?: string;
    disabled?: boolean;
    invalid?: boolean;
    onChange: (value: T) => void;
    options: ReadonlyArray<EnumDropdownOption<T>>;
    placeholder?: string;
    value: T | undefined;
};
export declare function EnumDropdown<T extends string>({ ariaDescribedBy, ariaLabel, disabled, invalid, onChange, options, placeholder, value }: EnumDropdownProps<T>): import("preact").JSX.Element;
export {};
//# sourceMappingURL=EnumDropdown.d.ts.map