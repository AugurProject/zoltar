import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { Route } from '../types/app.js'
import type { OpenOracleView } from '@zoltar/ui-zoltar/features/types.js'
import type { SecurityPoolsView } from '../features/types.js'

export type AppPageTitleInput = {
	activeOpenOracleView: OpenOracleView
	activeSecurityPoolsView: SecurityPoolsView
	route: Route
}

export function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route }: AppPageTitleInput) {
	if (route === 'deploy') return appCopy.deployContracts
	if (route === 'security-pools') {
		if (activeSecurityPoolsView === 'create') return commonCopy.createSecurityPool
		if (activeSecurityPoolsView === 'operate') return appCopy.manageSecurityPool
		return commonCopy.securityPools
	}
	if (route === 'open-oracle') {
		if (activeOpenOracleView === 'create') return appCopy.createOracleReport
		if (activeOpenOracleView === 'selected-report') return appCopy.oracleReportDetails
		return appCopy.oracleReports
	}
	return appCopy.pageNotFoundTitle
}

const statoblastDocumentTitleSuffix = 'Augur Statoblast'

export function formatAppDocumentTitle(pageTitle: string) {
	return `${pageTitle} | ${statoblastDocumentTitleSuffix}`
}
