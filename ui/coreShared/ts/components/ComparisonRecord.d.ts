import type { ComponentChildren } from 'preact';
type ComparisonRecordMetric = {
    label: ComponentChildren;
    value: ComponentChildren;
};
type ComparisonRecordProps = {
    action?: ComponentChildren;
    badge?: ComponentChildren;
    children?: ComponentChildren;
    metrics: ComparisonRecordMetric[];
    title: ComponentChildren;
};
export declare function ComparisonRecord({ action, badge, children, metrics, title }: ComparisonRecordProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ComparisonRecord.d.ts.map