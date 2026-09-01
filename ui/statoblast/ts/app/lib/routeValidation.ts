import { hasPresentEmptyQueryParam } from '@zoltar/ui-core-shared/lib/routing.js'
import { isSupportedSelectedPoolView } from '../../features/security-pools/lib/securityPoolWorkflow.js'
import type { Route } from '../../types/app.js'
import type { SecurityPoolsView } from '../../features/types.js'
import type { OpenOracleView } from '@zoltar/ui-zoltar/features/types.js'

const SECURITY_POOLS_VIEWS: readonly SecurityPoolsView[] = ['browse', 'create', 'operate', 'universes']
const OPEN_ORACLE_VIEWS: readonly OpenOracleView[] = ['browse', 'create', 'selected-report']

export function getInvalidStatoblastRouteState({ activeSecurityPoolsView, openOracleView, resolvedRoute, search, securityPoolsView, selectedPoolView }: { activeSecurityPoolsView: SecurityPoolsView; openOracleView: string; resolvedRoute: Route; search: string; securityPoolsView: string; selectedPoolView: string }) {
	const hasSecurityPoolsViewParam = search.includes('securityPoolsView=')
	const hasOpenOracleViewParam = search.includes('openOracleView=')
	const hasSelectedPoolViewParam = search.includes('selectedPoolView=')
	const hasInvalidSecurityPoolsView = hasPresentEmptyQueryParam(search, 'securityPoolsView') || (securityPoolsView !== '' && !SECURITY_POOLS_VIEWS.includes(securityPoolsView as SecurityPoolsView))
	const hasInvalidOpenOracleView = hasPresentEmptyQueryParam(search, 'openOracleView') || (openOracleView !== '' && !OPEN_ORACLE_VIEWS.includes(openOracleView as OpenOracleView))
	const hasInvalidSelectedPoolView = hasPresentEmptyQueryParam(search, 'selectedPoolView') || (hasSelectedPoolViewParam && (!isSupportedSelectedPoolView(selectedPoolView) || resolvedRoute !== 'security-pools' || activeSecurityPoolsView !== 'operate'))
	return {
		hasInvalidOpenOracleView: hasInvalidOpenOracleView || (hasOpenOracleViewParam && resolvedRoute !== 'open-oracle'),
		hasInvalidSecurityPoolsView: hasInvalidSecurityPoolsView || (hasSecurityPoolsViewParam && resolvedRoute !== 'security-pools'),
		hasInvalidSelectedPoolView,
	}
}
