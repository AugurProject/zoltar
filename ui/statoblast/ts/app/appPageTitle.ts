import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../copy/app.js'
import type { Route } from '../types/app.js'
import type { OpenOracleView } from '@zoltar/ui-zoltar/features/types.js'
import type { SecurityPoolsView } from '../features/types.js'
import { formatAppDocumentTitle as formatDocumentTitle } from '@zoltar/ui-core-shared/app/lib/appTitle.js'

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
		if (activeSecurityPoolsView === 'universes') return commonCopy.universe
		return commonCopy.securityPools
	}
	if (route === 'open-oracle') {
		if (activeOpenOracleView === 'create') return statoblastAppCopy.createOracleReport
		if (activeOpenOracleView === 'selected-report') return statoblastAppCopy.oracleReportDetails
		return statoblastAppCopy.oracleReports
	}
	return appCopy.pageNotFoundTitle
}

export const applicationTitle = 'Augur Statoblast'

export function formatAppDocumentTitle(pageTitle: string) {
	return formatDocumentTitle(pageTitle, applicationTitle)
}
