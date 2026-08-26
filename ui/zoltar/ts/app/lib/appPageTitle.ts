import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../copy/market.js'
import * as zoltarCopy from '../../copy/zoltar.js'
import type { Route } from '../../types/app.js'
import type { OpenOracleView, ZoltarView } from '../../features/types.js'
import { formatAppDocumentTitle as formatDocumentTitle } from '@zoltar/ui-core-shared/app/lib/appTitle.js'

export type AppPageTitleInput = {
	activeOpenOracleView: OpenOracleView
	activeZoltarView: ZoltarView
	route: Route
}

export function getAppPageTitle({ activeOpenOracleView, activeZoltarView, route }: AppPageTitleInput) {
	if (route === 'deploy') return appCopy.deployContracts
	if (route === 'zoltar') {
		if (activeZoltarView === 'create') return commonCopy.createQuestion
		if (activeZoltarView === 'fork') return zoltarCopy.forkZoltar
		if (activeZoltarView === 'migrate') return zoltarCopy.migrateRep
		return marketCopy.questions
	}
	if (route === 'open-oracle') return getOpenOraclePageTitle(activeOpenOracleView)
	return appCopy.pageNotFoundTitle
}

export function getOpenOraclePageTitle(view: OpenOracleView) {
	if (view === 'create') return appCopy.createOracleReport
	if (view === 'selected-report') return appCopy.oracleReportDetails
	return appCopy.oracleReports
}

export function formatAppDocumentTitle(pageTitle: string) {
	return formatDocumentTitle(pageTitle, zoltarCopy.applicationTitle)
}
