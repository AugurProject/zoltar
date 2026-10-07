import { buildRouteHref, getTopLevelRouteSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'

type UniverseAccess = {
	migrationActive?: boolean
	loadingZoltarForkAccess: boolean
	/** The connected account's REP balance in the active universe. */
	zoltarForkRepBalanceAttoRep: bigint | undefined
	zoltarUniverse: { forkTime: bigint; hasForked: boolean } | undefined
}

/** The universe part of Statoblast's top bar: the account's REP balance, fork state, and where to migrate after a fork. */
export function getStatoblastOverviewUniverse({ loadingZoltarForkAccess, zoltarForkRepBalanceAttoRep, zoltarUniverse, migrationActive }: UniverseAccess) {
	return {
		isLoadingUniverseRepBalance: loadingZoltarForkAccess,
		migrateRepHref: migrationActive ? undefined : buildRouteHref('#/pools/migrate', getTopLevelRouteSearch('pools')),
		universeForkTime: zoltarUniverse?.forkTime,
		universeHasForked: zoltarUniverse?.hasForked,
		universeRepBalanceAttoRep: zoltarForkRepBalanceAttoRep,
	}
}

/**
 * The top bar's universe state, as in Zoltar: a `?universe=` that names no deployed universe shows the shared not-found hint with
 * its Go to Genesis universe recovery on every Statoblast view, instead of labelling the universe as if it existed.
 */
export function getStatoblastUniversePresentation({ canReadOnchainData, loadingZoltarUniverse, zoltarUniverse, zoltarUniverseMissing }: { canReadOnchainData: boolean; loadingZoltarUniverse: boolean; zoltarUniverse: object | undefined; zoltarUniverseMissing: boolean }) {
	const universeState = resolveLoadableValueState({ isLoading: loadingZoltarUniverse, isMissing: zoltarUniverseMissing, value: zoltarUniverse })
	return canReadOnchainData && universeState === 'missing' ? getUniversePresentation(universeState) : undefined
}
