import * as shellCopy from '@zoltar/ui-statoblast-shared/copy/statoblastShell.js'
import * as questionCopy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import { poolTabLabels } from '@zoltar/ui-statoblast-shared/copy/securityPoolPage.js'
import type { StatoblastPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { formatAppDocumentTitle as formatDocumentTitle } from '@zoltar/ui-core-shared/app/lib/appTitle.js'

export function getAppPageTitle(page: StatoblastPage) {
	switch (page.kind) {
		case 'watchlist':
			return shellCopy.watchlist
		case 'choose-universe':
			return shellCopy.genesisTitle
		case 'migrate-rep':
			return shellCopy.migrateRep
		case 'deploy-pool':
			return shellCopy.deployPool
		case 'pool':
			return poolTabLabels[page.tab]
		case 'question':
			return { shares: questionCopy.shares, reporting: questionCopy.reporting, claims: questionCopy.inheritedClaims }[page.tab]
		default:
			return shellCopy.pageNotFound
	}
}

export const applicationTitle = 'Augur Statoblast'

/** `detail` names the specific object on the page, such as the open pool, ahead of the page title. */
export function formatAppDocumentTitle(pageTitle: string, detail?: string) {
	return formatDocumentTitle(detail === undefined ? pageTitle : `${detail} · ${pageTitle}`, applicationTitle)
}
