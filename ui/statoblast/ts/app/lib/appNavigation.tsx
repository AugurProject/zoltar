import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import { createSecondaryNavigation, resolveSecondaryNavigation, withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'
import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { buildPoolsRouteHash, parsePoolsRouteHash, writePoolsLocationSearch } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'
import type { QuestionLedgersView } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'

type PoolsListView = Exclude<QuestionLedgersView, 'operate'>

function getPoolsViewHref(view: PoolsListView) {
	const search = writePoolsLocationSearch(getRouteHashSearch(), parsePoolsRouteHash(parseRouteHash(window.location.hash).routeHash), { view })
	return buildRouteHref(buildPoolsRouteHash({ view }), search)
}

/** Pools, security pools and price reports share one primary row; Deploy joins while deployment is incomplete, and the other sections are disabled while required contracts are missing. */
export function getStatoblastRouteTabs({ applicationDeploymentMissing, route, showDeployTab }: { applicationDeploymentMissing: boolean; route: string; showDeployTab: boolean }): RouteTabDefinition[] {
	return withDeploymentTab({
		deploymentMissing: applicationDeploymentMissing,
		deploymentTab: { hash: statoblastRouting.getHash('deploy'), label: commonCopy.deploy, route: 'deploy' },
		deploymentIncomplete: showDeployTab,
		route,
		tabs: [
			{ hash: statoblastRouting.getHash('pools'), label: statoblastAppCopy.questions, route: 'pools' },
			{ hash: statoblastRouting.getHash('securityPools'), label: statoblastAppCopy.securityPools, route: 'securityPools' },
			{ hash: statoblastRouting.getHash('open-oracle'), label: openOracleCopy.priceReports, route: 'open-oracle' },
		],
	})
}

export function getRouteSecondaryNavigation({ activeQuestionLedgersView, route, setQuestionLedgersView }: { activeQuestionLedgersView: QuestionLedgersView; route: string; setQuestionLedgersView: (view: QuestionLedgersView) => void }) {
	// A pool page is its own record with a back link and stage tabs; the list views would only compete with them.
	const poolsViews =
		activeQuestionLedgersView === 'operate'
			? undefined
			: createSecondaryNavigation<PoolsListView>({
					ariaLabel: statoblastAppCopy.poolsViews,
					value: activeQuestionLedgersView,
					onChange: setQuestionLedgersView,
					options: [
						{ href: getPoolsViewHref('browse'), label: statoblastAppCopy.browseQuestions, value: 'browse' },
						{ href: getPoolsViewHref('universes'), label: zoltarCopy.universesTitle, value: 'universes' },
						...(activeQuestionLedgersView === 'migrate' ? [{ href: getPoolsViewHref('migrate'), label: zoltarCopy.migrateRep, value: 'migrate' as const }] : []),
					],
				})
	return resolveSecondaryNavigation({ route, secondaryByRoute: { pools: poolsViews } })
}

export function getTransactionRouteKey({ activeQuestionLedgersView, route }: { activeQuestionLedgersView: QuestionLedgersView; route: string }) {
	if (route === 'pools') return `${route}:${activeQuestionLedgersView}`
	return route
}
