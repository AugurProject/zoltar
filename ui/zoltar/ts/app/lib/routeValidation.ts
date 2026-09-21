import { hasInvalidViewQueryParam } from '@zoltar/ui-core-shared/navigation/viewQueryParam.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'

export const ZOLTAR_VIEWS: readonly ZoltarView[] = ['questions', 'create', 'universes']

export function hasInvalidZoltarView({ resolvedRoute, search, zoltarView }: { resolvedRoute: Route; search: string; zoltarView: string }) {
	return hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews: ZOLTAR_VIEWS, key: 'zoltarView', resolvedRoute, search, value: zoltarView })
}
