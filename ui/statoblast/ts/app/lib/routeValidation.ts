import { hasInvalidViewQueryParam } from '@zoltar/ui-core-shared/navigation/viewQueryParam.js'
import { isSupportedSelectedPoolView } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolWorkflow.js'
import type { Route } from '@zoltar/ui-statoblast-shared/types/app.js'
import type { OpenOracleView } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'

const OPEN_ORACLE_VIEWS: readonly OpenOracleView[] = ['browse', 'create', 'selected-report']

/** Pool locations come from the hash path, so only an unknown pool tab or Open Oracle view can make an otherwise resolved route invalid. */
export function getInvalidStatoblastRouteState({ openOracleView, resolvedRoute, search, selectedPoolView }: { openOracleView: string; resolvedRoute: Route; search: string; selectedPoolView: string }) {
	return {
		hasInvalidOpenOracleView: hasInvalidViewQueryParam({ allowedRoutes: ['open-oracle'], allowedViews: OPEN_ORACLE_VIEWS, key: 'openOracleView', resolvedRoute, search, value: openOracleView }),
		hasInvalidSelectedPoolView: resolvedRoute === 'pools' && !isSupportedSelectedPoolView(selectedPoolView),
	}
}
