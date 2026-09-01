import { hasPresentEmptyQueryParam } from '@zoltar/ui-core-shared/lib/routing.js'
import type { Route } from '../../types/app.js'
import type { ZoltarView } from '../../features/types.js'

const ZOLTAR_VIEWS: readonly ZoltarView[] = ['questions', 'create', 'fork', 'migrate', 'universes']

export function hasInvalidZoltarView({ resolvedRoute, search, zoltarView }: { resolvedRoute: Route; search: string; zoltarView: string }) {
	return hasPresentEmptyQueryParam(search, 'zoltarView') || (search.includes('zoltarView=') && resolvedRoute !== 'zoltar') || (zoltarView !== '' && !ZOLTAR_VIEWS.includes(zoltarView as ZoltarView))
}
