import type { ComponentProps } from 'preact';
import { DeploymentRouteContent } from '@zoltar/ui-zoltar/features/deployment/components/DeploymentRouteContent.js';
import { OpenOracleSection } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOracleSection.js';
import { SecurityPoolsSection } from '../../features/security-pools/components/SecurityPoolsSection.js';
import type { Route } from '../../types/app.js';
type Props = {
    deploy: ComponentProps<typeof DeploymentRouteContent>;
    openOracle: ComponentProps<typeof OpenOracleSection>;
    readBackendMessage: string | undefined;
    route: Route;
    securityPools: ComponentProps<typeof SecurityPoolsSection>;
};
export declare function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>): boolean;
export declare function AppRouteContent({ deploy, openOracle, readBackendMessage, route, securityPools }: Props): import("preact").JSX.Element | null;
export {};
//# sourceMappingURL=AppRouteContent.d.ts.map