import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'
import { formatAppDocumentTitle as formatDocumentTitle } from '@zoltar/ui-core-shared/app/lib/appTitle.js'

export type AppPageTitleInput = {
	activeZoltarView: ZoltarView
	route: Route
}

function getZoltarViewTitle(view: ZoltarView) {
	switch (view) {
		case 'overview':
			return zoltarCopy.overview
		case 'questions':
			return marketCopy.questions
		case 'create':
			return commonCopy.createQuestion
		case 'universes':
			return zoltarCopy.universesTitle
		case 'fork':
			return zoltarCopy.forkZoltar
		case 'migrate':
			return zoltarCopy.migrateRep
		default:
			return assertNever(view)
	}
}

export function getAppPageTitle({ activeZoltarView, route }: AppPageTitleInput) {
	if (route === 'deploy') return appCopy.deployContracts
	if (route === 'zoltar') return getZoltarViewTitle(activeZoltarView)
	return appCopy.pageNotFoundTitle
}

export function formatAppDocumentTitle(pageTitle: string) {
	return formatDocumentTitle(pageTitle, zoltarCopy.applicationTitle)
}
