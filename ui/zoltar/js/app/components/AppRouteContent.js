import { jsx as _jsx } from "preact/jsx-runtime";
import { DeploymentRouteContent } from '../../features/deployment/components/DeploymentRouteContent.js';
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js';
import { OpenOracleSection } from '../../features/open-oracle/components/OpenOracleSection.js';
import { ZoltarSection } from '../../features/zoltarSurface/components/ZoltarSection.js';
export function shouldRenderRouteContent({ readBackendMessage, route }) {
    if (route !== 'deploy' && readBackendMessage !== undefined)
        return false;
    return true;
}
export function AppRouteContent({ deploy, zoltar, openOracle, readBackendMessage, route }) {
    if (!shouldRenderRouteContent({ readBackendMessage, route }))
        return null;
    switch (route) {
        case 'deploy':
            return _jsx(DeploymentRouteContent, { ...deploy });
        case 'zoltar':
            return _jsx(ZoltarSection, { ...zoltar });
        case 'open-oracle':
            return _jsx(OpenOracleSection, { ...openOracle });
        case 'not-found':
            return _jsx(NotFoundSection, {});
        default:
            return _jsx(NotFoundSection, {});
    }
}
//# sourceMappingURL=AppRouteContent.js.map