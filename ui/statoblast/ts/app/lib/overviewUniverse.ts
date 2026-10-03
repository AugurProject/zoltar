import { buildRouteHref, getTopLevelRouteSearch } from '@zoltar/ui-core-shared/navigation/routing.js'

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
