import type { Route } from '../types/app.js'
import type { OpenOracleView, SecurityPoolsView, ZoltarView } from '../types/components.js'

const APP_DOCUMENT_TITLE_SUFFIX = 'Zoltar + Augur Placeholder'

export type AppPageTitleInput = {
	activeOpenOracleView: OpenOracleView
	activeSecurityPoolsView: SecurityPoolsView
	activeZoltarView: ZoltarView
	route: Route
}

export function getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, activeZoltarView, route }: AppPageTitleInput) {
	if (route === 'deploy') return 'Deploy Contracts'
	if (route === 'zoltar') {
		if (activeZoltarView === 'create') return 'Create Question'
		if (activeZoltarView === 'fork') return 'Fork Oracle'
		if (activeZoltarView === 'migrate') return 'Migrate REP'
		return 'Markets'
	}
	if (route === 'security-pools') {
		if (activeSecurityPoolsView === 'create') return 'Create Security Pool'
		if (activeSecurityPoolsView === 'operate') return 'Operate Security Pool'
		return 'Security Pools'
	}
	if (route === 'open-oracle') {
		if (activeOpenOracleView === 'create') return 'Advanced Oracle Report Creation'
		if (activeOpenOracleView === 'selected-report') return 'Selected Oracle Report'
		return 'Oracle Reports'
	}
	return 'Page Not Found'
}

export function formatAppDocumentTitle(pageTitle: string) {
	return `${pageTitle} | ${APP_DOCUMENT_TITLE_SUFFIX}`
}
