import type { ViewTabOption } from '../../types/components.js';
type RouteSubNavigationProps<TValue extends string> = {
    ariaLabel: string;
    onChange: (value: TValue) => void;
    options: ViewTabOption<TValue>[];
    value: TValue;
};
export declare function RouteSubNavigation<TValue extends string>({ ariaLabel, onChange, options, value }: RouteSubNavigationProps<TValue>): import("preact").JSX.Element;
export {};
//# sourceMappingURL=RouteSubNavigation.d.ts.map