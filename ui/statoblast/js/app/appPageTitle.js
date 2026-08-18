import * as appCopy from '@zoltar/ui-core-shared/copy/app.js';
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
export function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route }) {
    if (route === 'deploy')
        return appCopy.deployContracts;
    if (route === 'security-pools') {
        if (activeSecurityPoolsView === 'create')
            return commonCopy.createSecurityPool;
        if (activeSecurityPoolsView === 'operate')
            return appCopy.manageSecurityPool;
        return commonCopy.securityPools;
    }
    if (route === 'open-oracle') {
        if (activeOpenOracleView === 'create')
            return appCopy.createOracleReport;
        if (activeOpenOracleView === 'selected-report')
            return appCopy.oracleReportDetails;
        return appCopy.oracleReports;
    }
    return appCopy.pageNotFoundTitle;
}
const statoblastDocumentTitleSuffix = 'Augur Statoblast';
export function formatAppDocumentTitle(pageTitle) {
    return `${pageTitle} | ${statoblastDocumentTitleSuffix}`;
}
//# sourceMappingURL=appPageTitle.js.map