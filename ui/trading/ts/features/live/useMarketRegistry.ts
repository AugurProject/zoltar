import { useEffect, useRef, useState } from 'preact/hooks'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { readOperationClient, runReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { marketsCopy } from '../../copy/markets.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { createSecurityPoolDeploymentIndex, publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import type { TradingPairIndex } from '../../protocol/marketDiscovery.js'
import type { LiveTradingControllerServices } from './liveTradingTypes.js'
import { parsedUniverseId } from './useLiveTradingState.js'

const REGISTRY_PAGE_SIZE = 25n

type MarketRegistryPage = Readonly<{ start: bigint; total: bigint; previousStart: bigint | undefined; nextStart: bigint | undefined }>

/** One page of the trading markets the registry lists in the selected universe, and how to move between pages. */
export type MarketRegistry = Readonly<{
	/** `idle` while there is no universe to list, for example before or after a failed universe discovery. */
	status: 'idle' | 'loading' | 'ready' | 'error'
	markets: readonly LiveMarket[]
	page: MarketRegistryPage | undefined
	error: string | undefined
	loadPage(start: bigint): void
	retry(): void
}>

// `requestedStart` is the page the user last asked for, so Retry repeats that request even when it failed before any market arrived.
type RegistryState = Readonly<{ scope: string | undefined; status: MarketRegistry['status']; markets: readonly LiveMarket[]; page: MarketRegistryPage | undefined; requestedStart: bigint | undefined; error: string | undefined }>

function emptyRegistry(scope: string | undefined): RegistryState {
	return { scope, status: scope === undefined ? 'idle' : 'loading', markets: [], page: undefined, requestedStart: undefined, error: undefined }
}

/**
 * Pages through every trading market the registry lists in the selected universe, so a new browser sees markets without
 * an address. The first page loads as soon as the list opens; an explicit invalidation (a confirmed transaction or a
 * simulation control) re-reads the page on screen in place. Blocks alone do not, since a page reads every market on it.
 */
export function useMarketRegistry({ active, configuration, selectedUniverseId, services }: { active: boolean; configuration: DeploymentConfiguration | undefined; selectedUniverseId: string | undefined; services: LiveTradingControllerServices }): MarketRegistry {
	const scope = active && configuration !== undefined && selectedUniverseId !== undefined ? `${configuration.chainId.toString()}:${configuration.factory}:${configuration.rpcUrl}:${selectedUniverseId}` : undefined
	const [state, setState] = useState<RegistryState>(() => emptyRegistry(scope))
	const requests = useRef(createLatestRequestGuard()).current
	const pairIndex = useRef<TradingPairIndex>(createSecurityPoolDeploymentIndex()).current
	const current = state.scope === scope ? state : emptyRegistry(scope)

	async function load(start: bigint, background = false) {
		if (scope === undefined || configuration === undefined || selectedUniverseId === undefined) return
		const request = requests.begin()
		const isCurrent = () => requests.isCurrent(request)
		const update = (apply: (previous: RegistryState) => RegistryState) => setState(previous => apply(previous.scope === scope ? previous : emptyRegistry(scope)))
		// A newly requested page (another start, or an empty list) fills in as its markets load; re-reading the page on
		// screen keeps it in place until the read completes.
		const fillsIn = !background && (current.markets.length === 0 || current.page?.start !== start)
		if (!background) update(previous => ({ ...previous, status: 'loading', requestedStart: start, error: undefined }))
		try {
			const client = services.createTradingPublicClient(configuration)
			const discovered = await runReadOperation(
				async operation =>
					await services.discoverTradingMarketPage(readOperationClient(client, operation), configuration, parsedUniverseId(selectedUniverseId), start, REGISTRY_PAGE_SIZE, pairIndex, isCurrent, progress => {
						if (!fillsIn || !isCurrent()) return
						update(previous => ({ ...previous, markets: progress.markets.filter(market => market !== undefined), page: { start: progress.start, total: progress.total, previousStart: progress.previousStart, nextStart: progress.nextStart } }))
					}),
				{ isCurrent },
			)
			if (!isCurrent()) return
			// Discovery falls back to the genesis universe for an unknown request; that universe's markets are not this list's.
			const inUniverse = discovered.selectedUniverseId?.toString() === selectedUniverseId
			update(() => ({
				scope,
				status: 'ready',
				markets: inUniverse ? discovered.markets : [],
				page: inUniverse ? { start: discovered.start, total: discovered.total, previousStart: discovered.previousStart, nextStart: discovered.nextStart } : { start: 0n, total: 0n, previousStart: undefined, nextStart: undefined },
				requestedStart: start,
				error: undefined,
			}))
		} catch (error) {
			if (!isCurrent()) return
			update(previous => ({ ...previous, status: 'error', error: publicErrorMessage(error, marketsCopy.registryFailedLead) }))
		}
	}
	const loadRef = useRef(load)
	loadRef.current = load

	useEffect(() => {
		if (scope === undefined) {
			requests.invalidate()
			return
		}
		void loadRef.current(0n)
		return () => requests.invalidate()
	}, [scope])

	useBlockRefresh(event => {
		if (event.reason === 'invalidate' && current.status !== 'loading') void loadRef.current(current.page?.start ?? 0n, true)
	}, scope !== undefined)

	return {
		status: current.status,
		markets: current.markets,
		page: current.page,
		error: current.error,
		loadPage: start => void loadRef.current(start),
		retry: () => void loadRef.current(current.requestedStart ?? current.page?.start ?? 0n),
	}
}
