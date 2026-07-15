import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import * as zoltarCopy from '../copy/zoltar.js'
import type { Route } from '../types/app.js'
import type { OpenOracleView, SecurityPoolsView, ZoltarView } from '../types/components.js'

export type AppPageTitleInput = {
	activeOpenOracleView: OpenOracleView
	activeSecurityPoolsView: SecurityPoolsView
	activeZoltarView: ZoltarView
	route: Route
}

export function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, activeZoltarView, route }: AppPageTitleInput) {
	if (route === 'deploy') return appCopy.deployContracts
	if (route === 'zoltar') {
		if (activeZoltarView === 'create') return commonCopy.createQuestion
		if (activeZoltarView === 'fork') return zoltarCopy.forkZoltar
		if (activeZoltarView === 'migrate') return zoltarCopy.migrateRep
		return appCopy.questionsAndMarkets
	}
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

export function formatAppDocumentTitle(pageTitle: string) {
	return `${pageTitle} | ${appCopy.appDocumentTitleSuffix}`
}
