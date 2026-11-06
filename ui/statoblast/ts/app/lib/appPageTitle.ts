import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import type { StatoblastRoute } from '@zoltar/ui-statoblast-shared/types/app.js'
import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import { formatAppDocumentTitle as formatDocumentTitle } from '@zoltar/ui-core-shared/app/lib/appTitle.js'

export type AppPageTitleInput = {
	activeSecurityPoolsView: SecurityPoolsView
	route: StatoblastRoute
}

export function getAppPageTitle({ activeSecurityPoolsView, route }: AppPageTitleInput) {
	if (route === 'portfolios') return statoblastAppCopy.portfolios
	if (route === 'deploy') return appCopy.deployContracts
	if (route === 'pools') {
		if (activeSecurityPoolsView === 'operate') return 'Question'
		if (activeSecurityPoolsView === 'migrate') return appCopy.migrateRep
		if (activeSecurityPoolsView === 'universes') return zoltarCopy.universesTitle
		// Matches the browse view's visible heading, so the tab title and page announcement name what the user sees.
		return 'Portfolio questions'
	}
	if (route === 'open-oracle') return openOracleCopy.priceReports
	return appCopy.pageNotFoundTitle
}

export const applicationTitle = 'Augur Statoblast'

/** `detail` names the specific object on the page, such as the open pool, ahead of the page title. */
export function formatAppDocumentTitle(pageTitle: string, detail?: string) {
	return formatDocumentTitle(detail === undefined ? pageTitle : `${detail} · ${pageTitle}`, applicationTitle)
}
