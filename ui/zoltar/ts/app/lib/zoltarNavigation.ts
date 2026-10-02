import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readUniverseQueryParam, writeUniverseQueryParam, writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { ZOLTAR_TAB_VIEWS } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/lib/zoltarViewModels.js'
import { zoltarRouting } from '@zoltar/ui-zoltar-shared/lib/routing.js'

export type ZoltarTabView = (typeof ZOLTAR_TAB_VIEWS)[number]

/** The secondary tab that owns a view: Fork and Migrate are reached from Universes, so that tab stays selected. */
export function getZoltarTabView(view: ZoltarView): ZoltarTabView {
	if (view === 'fork' || view === 'migrate') return 'universes'
	return view
}

export function getZoltarTabLabel(view: ZoltarTabView) {
	switch (view) {
		case 'overview':
			return zoltarCopy.overview
		case 'questions':
			return marketCopy.browseQuestions
		case 'create':
			return commonCopy.createQuestion
		case 'universes':
			return zoltarCopy.universesTitle
		default:
			return assertNever(view)
	}
}

/** Link to a Zoltar view that keeps the selected universe and environment parameters; a malformed universe is dropped so the link recovers to Genesis. */
export function getZoltarViewHref(view: ZoltarView) {
	const search = getRouteHashSearch()
	return buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(writeUniverseQueryParam(search, readUniverseQueryParam(search)), view))
}
