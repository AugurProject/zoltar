import type { ComponentChildren } from 'preact';
type MetricFieldProps = {
    children: ComponentChildren;
    className?: string | undefined;
    label: ComponentChildren;
    valueClassName?: string | undefined;
    valueTagName?: 'span' | 'strong' | undefined;
};
export declare function MetricField({ children, className, label, valueClassName, valueTagName }: MetricFieldProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=MetricField.d.ts.map