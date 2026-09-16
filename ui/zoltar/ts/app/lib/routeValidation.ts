import { hasPresentEmptyQueryParam } from '@zoltar/ui-core-shared/navigation/routing.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'

export const ZOLTAR_VIEWS: readonly ZoltarView[] = ['questions', 'create', 'universes']

export function hasInvalidZoltarView({ resolvedRoute, search, zoltarView }: { resolvedRoute: Route; search: string; zoltarView: string }) {
	const hasZoltarViewParam = new URLSearchParams(search).has('zoltarView')
	return hasPresentEmptyQueryParam(search, 'zoltarView') || (hasZoltarViewParam && resolvedRoute !== 'zoltar') || (zoltarView !== '' && !ZOLTAR_VIEWS.some(view => view === zoltarView))
}
