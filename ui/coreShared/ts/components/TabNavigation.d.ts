import type { RouteTabDefinition } from '../types/components.js';
type TabNavigationProps = {
    route: string;
    tabs: readonly RouteTabDefinition[];
    onRouteChange: (route: string) => void;
};
export declare function TabNavigation({ route, tabs, onRouteChange }: TabNavigationProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TabNavigation.d.ts.map