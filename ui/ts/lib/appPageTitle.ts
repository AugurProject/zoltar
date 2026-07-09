import type { Route } from '../types/app.js'
import type { OpenOracleView, SecurityPoolsView, ZoltarView } from '../types/components.js'
import { UI_STRINGS } from './uiStrings.js'

export type AppPageTitleInput = {
	activeOpenOracleView: OpenOracleView
	activeSecurityPoolsView: SecurityPoolsView
	activeZoltarView: ZoltarView
	route: Route
}

export function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, activeZoltarView, route }: AppPageTitleInput) {
	if (route === 'deploy') return UI_STRINGS.appPageTitle.deployContractsPageTitle
	if (route === 'zoltar') {
		if (activeZoltarView === 'create') return UI_STRINGS.appPageTitle.createQuestionPageTitle
		if (activeZoltarView === 'fork') return UI_STRINGS.appPageTitle.forkOraclePageTitle
		if (activeZoltarView === 'migrate') return UI_STRINGS.appPageTitle.migrateRepPageTitle
		return UI_STRINGS.appPageTitle.questionsAndMarketsPageTitle
	}
	if (route === 'security-pools') {
		if (activeSecurityPoolsView === 'create') return UI_STRINGS.appPageTitle.createSecurityPoolPageTitle
		if (activeSecurityPoolsView === 'operate') return UI_STRINGS.appPageTitle.manageSecurityPoolPageTitle
		return UI_STRINGS.appPageTitle.securityPoolsPageTitle
	}
	if (route === 'open-oracle') {
		if (activeOpenOracleView === 'create') return UI_STRINGS.appPageTitle.createOracleReportPageTitle
		if (activeOpenOracleView === 'selected-report') return UI_STRINGS.appPageTitle.openOracleReportDetailsPageTitle
		return UI_STRINGS.appPageTitle.openOracleReportsPageTitle
	}
	return UI_STRINGS.appPageTitle.pageNotFoundPageTitle
}

export function formatAppDocumentTitle(pageTitle: string) {
	return `${pageTitle} | ${UI_STRINGS.appPageTitle.documentTitleSuffix}`
}
