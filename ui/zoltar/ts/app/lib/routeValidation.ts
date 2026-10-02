import { hasInvalidViewQueryParam } from '@zoltar/ui-core-shared/navigation/viewQueryParam.js'
import { hasInvalidUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import type { ZoltarRoute } from '@zoltar/ui-zoltar-shared/types/app.js'
import { ZOLTAR_VIEWS } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/lib/zoltarViewModels.js'

/** True when the hash query names an unknown or misplaced Zoltar view or a malformed universe, so the app shows the not-found page. */
export function isInvalidZoltarRoute({ resolvedRoute, search, zoltarView }: { resolvedRoute: ZoltarRoute; search: string; zoltarView: string }) {
	const hasInvalidZoltarView = hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews: ZOLTAR_VIEWS, key: 'zoltarView', resolvedRoute, search, value: zoltarView })
	// A malformed universe would otherwise open Genesis as if the link had named it.
	return hasInvalidZoltarView || hasInvalidUniverseQueryParam(search)
}
