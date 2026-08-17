import * as appCopy from '@zoltar/ui-core-shared/copy/app.js';
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as marketCopy from '../../copy/market.js';
import * as zoltarCopy from '../../copy/zoltar.js';
export function getAppPageTitle({ activeOpenOracleView, activeZoltarView, route }) {
    if (route === 'deploy')
        return appCopy.deployContracts;
    if (route === 'zoltar') {
        if (activeZoltarView === 'create')
            return commonCopy.createQuestion;
        if (activeZoltarView === 'fork')
            return zoltarCopy.forkZoltar;
        if (activeZoltarView === 'migrate')
            return zoltarCopy.migrateRep;
        return marketCopy.questions;
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
export function formatAppDocumentTitle(pageTitle) {
    return `${pageTitle} | ${appCopy.appDocumentTitleSuffix}`;
}
//# sourceMappingURL=appPageTitle.js.map