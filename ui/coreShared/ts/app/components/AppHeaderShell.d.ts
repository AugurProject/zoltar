import type { SimulationController } from '../../simulation/controller.js';
import type { RouteTabDefinition } from '../../types/components.js';
import type { ComponentChildren } from 'preact';
type AppHeaderShellProps = {
    overview: ComponentChildren;
    simulationController: SimulationController | undefined;
    subNavigation?: ComponentChildren;
    tabNavigation: {
        route: string;
        tabs: readonly RouteTabDefinition[];
        onRouteChange: (route: string) => void;
    };
    onEnvironmentChanged?: () => Promise<void>;
    onRefresh: () => Promise<void>;
};
export declare function AppHeaderShell({ overview, simulationController, subNavigation, tabNavigation, onEnvironmentChanged, onRefresh }: AppHeaderShellProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=AppHeaderShell.d.ts.map