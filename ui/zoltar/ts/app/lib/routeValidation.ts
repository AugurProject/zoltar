import { hasInvalidViewQueryParam } from '@zoltar/ui-core-shared/navigation/viewQueryParam.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'
import { ZOLTAR_VIEWS } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/lib/zoltarViewModels.js'

export function hasInvalidZoltarView({ resolvedRoute, search, zoltarView }: { resolvedRoute: Route; search: string; zoltarView: string }) {
	return hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews: ZOLTAR_VIEWS, key: 'zoltarView', resolvedRoute, search, value: zoltarView })
}
