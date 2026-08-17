import type { SimulationController } from '../simulation/controller.js';
type SimulationBannerProps = {
    controller: SimulationController;
    onEnvironmentChanged?: () => Promise<void>;
    onRefresh: () => Promise<void>;
};
export declare function SimulationBanner({ controller, onEnvironmentChanged, onRefresh }: SimulationBannerProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=SimulationBanner.d.ts.map