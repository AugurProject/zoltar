import type { Route } from '../types/app.js'
import type { OpenOracleView, SecurityPoolsView, ZoltarView } from '../types/components.js'
import {
	UI_STRING_APP_DOCUMENT_TITLE_SUFFIX,
	UI_STRING_CREATE_ORACLE_REPORT,
	UI_STRING_CREATE_QUESTION,
	UI_STRING_CREATE_SECURITY_POOL,
	UI_STRING_DEPLOY_CONTRACTS,
	UI_STRING_FORK_ZOLTAR,
	UI_STRING_MANAGE_SECURITY_POOL,
	UI_STRING_MIGRATE_REP,
	UI_STRING_ORACLE_REPORT_DETAILS,
	UI_STRING_ORACLE_REPORTS,
	UI_STRING_PAGE_NOT_FOUND_APP_PAGE_TITLE_PAGE_NOT_FOUND_PAGE_TITLE,
	UI_STRING_QUESTIONS_AND_MARKETS,
	UI_STRING_SECURITY_POOLS,
} from './uiStrings.js'

export type AppPageTitleInput = {
	activeOpenOracleView: OpenOracleView
	activeSecurityPoolsView: SecurityPoolsView
	activeZoltarView: ZoltarView
	route: Route
}

export function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, activeZoltarView, route }: AppPageTitleInput) {
	if (route === 'deploy') return UI_STRING_DEPLOY_CONTRACTS
	if (route === 'zoltar') {
		if (activeZoltarView === 'create') return UI_STRING_CREATE_QUESTION
		if (activeZoltarView === 'fork') return UI_STRING_FORK_ZOLTAR
		if (activeZoltarView === 'migrate') return UI_STRING_MIGRATE_REP
		return UI_STRING_QUESTIONS_AND_MARKETS
	}
	if (route === 'security-pools') {
		if (activeSecurityPoolsView === 'create') return UI_STRING_CREATE_SECURITY_POOL
		if (activeSecurityPoolsView === 'operate') return UI_STRING_MANAGE_SECURITY_POOL
		return UI_STRING_SECURITY_POOLS
	}
	if (route === 'open-oracle') {
		if (activeOpenOracleView === 'create') return UI_STRING_CREATE_ORACLE_REPORT
		if (activeOpenOracleView === 'selected-report') return UI_STRING_ORACLE_REPORT_DETAILS
		return UI_STRING_ORACLE_REPORTS
	}
	return UI_STRING_PAGE_NOT_FOUND_APP_PAGE_TITLE_PAGE_NOT_FOUND_PAGE_TITLE
}

export function formatAppDocumentTitle(pageTitle: string) {
	return `${pageTitle} | ${UI_STRING_APP_DOCUMENT_TITLE_SUFFIX}`
}
