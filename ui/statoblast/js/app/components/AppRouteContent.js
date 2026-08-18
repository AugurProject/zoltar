import { jsx as _jsx } from "preact/jsx-runtime";
import { DeploymentRouteContent } from '@zoltar/ui-zoltar/features/deployment/components/DeploymentRouteContent.js';
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js';
import { OpenOracleSection } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOracleSection.js';
import { SecurityPoolsSection } from '../../features/security-pools/components/SecurityPoolsSection.js';
export function shouldRenderRouteContent({ readBackendMessage, route }) {
    if (route !== 'deploy' && readBackendMessage !== undefined)
        return false;
    return true;
}
export function AppRouteContent({ deploy, openOracle, readBackendMessage, route, securityPools }) {
    if (!shouldRenderRouteContent({ readBackendMessage, route }))
        return null;
    switch (route) {
        case 'deploy':
            return _jsx(DeploymentRouteContent, { ...deploy });
        case 'security-pools':
            return _jsx(SecurityPoolsSection, { ...securityPools });
        case 'open-oracle':
            return _jsx(OpenOracleSection, { ...openOracle });
        case 'not-found':
            return _jsx(NotFoundSection, {});
        default:
            return _jsx(NotFoundSection, {});
    }
}
//# sourceMappingURL=AppRouteContent.js.map