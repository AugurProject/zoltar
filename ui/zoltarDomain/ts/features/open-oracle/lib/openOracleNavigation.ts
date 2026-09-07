import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import { buildRouteHref } from '@zoltar/ui-core-shared/lib/routing.js'
import { writeOpenOracleViewQueryParam } from '@zoltar/ui-core-shared/lib/openOracleUrlParams.js'
import type { ViewTabOption } from '@zoltar/ui-core-shared/types/components.js'
import type { OpenOracleView } from '../../types.js'

export function getOpenOracleViewOptions(routeHash: string, search: string): ViewTabOption<OpenOracleView>[] {
	return [
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'browse')), label: appCopy.browseReports, value: 'browse' },
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'create')), label: appCopy.createReport, value: 'create' },
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'selected-report')), label: appCopy.viewReport, value: 'selected-report' },
	]
}
