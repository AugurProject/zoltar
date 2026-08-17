import type { ComponentProps } from 'preact';
import { DeploymentRouteContent } from '../../features/deployment/components/DeploymentRouteContent.js';
import { OpenOracleSection } from '../../features/open-oracle/components/OpenOracleSection.js';
import { ZoltarSection } from '../../features/zoltarSurface/components/ZoltarSection.js';
type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'zoltar';
type Props = {
    deploy: ComponentProps<typeof DeploymentRouteContent>;
    zoltar: ComponentProps<typeof ZoltarSection>;
    openOracle: ComponentProps<typeof OpenOracleSection>;
    readBackendMessage: string | undefined;
    route: AppRoute;
};
export declare function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>): boolean;
export declare function AppRouteContent({ deploy, zoltar, openOracle, readBackendMessage, route }: Props): import("preact").JSX.Element | null;
export {};
//# sourceMappingURL=AppRouteContent.d.ts.map