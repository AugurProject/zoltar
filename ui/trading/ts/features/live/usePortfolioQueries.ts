import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { createLatestRequestGuard, RequestIdentity } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { liveBalancesForMarket, mapWithConcurrency, publicErrorMessage, shareBalanceScope, type LiveBalances, type LiveMarket } from '../../protocol/live.js'
import type { BalanceState, LiveTradingControllerServices, PortfolioBalanceEntry } from './liveTradingTypes.js'

export function usePortfolioQueries() {
	const [balances, setBalances] = useState<LiveBalances>()
	const [balanceState, setBalanceState] = useState<BalanceState>('disconnected')
	const [balanceError, setBalanceError] = useState<string>()
	const [portfolioEntries, setPortfolioEntries] = useState<readonly PortfolioBalanceEntry[]>([])
	const [portfolioBalanceState, setPortfolioBalanceState] = useState<BalanceState>('disconnected')
	const [portfolioBalanceError, setPortfolioBalanceError] = useState<string>()
	const [portfolioRefreshNonce, setPortfolioRefreshNonce] = useState(0)

	return { balances, setBalances, balanceState, setBalanceState, balanceError, setBalanceError, portfolioEntries, setPortfolioEntries, portfolioBalanceState, setPortfolioBalanceState, portfolioBalanceError, setPortfolioBalanceError, portfolioRefreshNonce, setPortfolioRefreshNonce }
}

type RequestGuard = ReturnType<typeof createLatestRequestGuard>

/** A background refresh may have committed a newer market object while its balances were loading; keep the newest one. */
function withCurrentMarket(entry: PortfolioBalanceEntry, current: PortfolioBalanceEntry | undefined): PortfolioBalanceEntry {
	return current !== undefined && current.market.pool === entry.market.pool ? { ...entry, market: current.market } : entry
}

export function usePortfolioRefreshEffects({
	route,
	configuration,
	account,
	selected,
	visibleMarkets,
	marketRevision,
	selectedUniverseId,
	walletContextInvalidated,
	accountRef,
	queries,
	services,
	portfolioBalanceRequests,
	balanceRequests,
}: {
	route: string
	configuration: DeploymentConfiguration | undefined
	account: Address | undefined
	selected: LiveMarket | undefined
	visibleMarkets: readonly LiveMarket[]
	marketRevision: readonly LiveMarket[]
	selectedUniverseId: string | undefined
	walletContextInvalidated: boolean
	accountRef: Readonly<{ current: Address | undefined }>
	queries: ReturnType<typeof usePortfolioQueries>
	services: LiveTradingControllerServices
	portfolioBalanceRequests: RequestGuard
	balanceRequests: RequestGuard
}) {
	// Background refreshes commit fresh market objects every cycle. A read that is still current and in flight for
	// the same account and pools is left to finish instead of being restarted, so slow RPCs still reach a ready state.
	const portfolioRead = useRef<{ key: string; request: RequestIdentity }>()
	const balanceRead = useRef<{ key: string; request: RequestIdentity }>()

	useEffect(() => {
		if (route !== 'portfolio') {
			portfolioBalanceRequests.invalidate()
			queries.setPortfolioEntries([])
			queries.setPortfolioBalanceState('disconnected')
			queries.setPortfolioBalanceError(undefined)
			return
		}
		// Keep balances already loaded for the same pools visible while they revalidate so background refreshes do not flash cards empty.
		const previousEntries = queries.portfolioEntries
		const retainedEntries = visibleMarkets.map(market => {
			const previous = previousEntries.find(entry => entry.market.pool === market.pool)
			return { market, balances: liveBalancesForMarket(previous?.balances, market), error: market.loadError }
		})
		queries.setPortfolioEntries(retainedEntries)
		if (configuration === undefined || account === undefined) {
			portfolioBalanceRequests.invalidate()
			queries.setPortfolioBalanceState(walletContextInvalidated ? 'error' : 'disconnected')
			queries.setPortfolioBalanceError(walletContextInvalidated ? 'Wallet context changed; reconnect before loading portfolio positions' : undefined)
			return
		}
		const readKey = [account, queries.portfolioRefreshNonce.toString(), ...visibleMarkets.map(market => `${market.pool}:${market.shareToken}:${market.universeId.toString()}:${market.loadError ?? ''}`)].join('|')
		const inFlight = portfolioRead.current
		if (inFlight !== undefined && inFlight.key === readKey && portfolioBalanceRequests.isCurrent(inFlight.request)) return
		const request = portfolioBalanceRequests.begin()
		portfolioRead.current = { key: readKey, request }
		const settle = () => {
			if (portfolioRead.current?.request === request) portfolioRead.current = undefined
		}
		const revalidating = retainedEntries.every(entry => entry.balances !== undefined || entry.error !== undefined)
		queries.setPortfolioBalanceState(revalidating ? 'ready' : 'loading')
		queries.setPortfolioBalanceError(undefined)
		const client = services.createTradingPublicClient(configuration)
		void mapWithConcurrency(visibleMarkets, 6, async (market, index) => {
			if (market.loadError !== undefined) return { market, balances: undefined, error: market.loadError }
			let entry: PortfolioBalanceEntry
			try {
				const loaded = await services.loadLiveBalances(client, market, account)
				entry = { market, balances: liveBalancesForMarket(loaded, market), error: undefined }
			} catch (error) {
				entry = { market, balances: undefined, error: publicErrorMessage(error, 'Balance refresh failed') }
			}
			if (portfolioBalanceRequests.isCurrent(request) && accountRef.current === account) queries.setPortfolioEntries(current => current.map((currentEntry, currentIndex) => (currentIndex === index ? withCurrentMarket(entry, currentEntry) : currentEntry)))
			return entry
		})
			.then(entries => {
				settle()
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				queries.setPortfolioEntries(current => entries.map((entry, index) => withCurrentMarket(entry, current[index])))
				queries.setPortfolioBalanceState('ready')
				queries.setPortfolioBalanceError(undefined)
			})
			.catch(error => {
				settle()
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				queries.setPortfolioBalanceState('error')
				queries.setPortfolioBalanceError(publicErrorMessage(error, 'Portfolio balance refresh failed'))
			})
	}, [account, configuration, marketRevision, queries.portfolioRefreshNonce, route, selectedUniverseId, walletContextInvalidated])

	useEffect(() => {
		if (route === 'portfolio') {
			balanceRequests.invalidate()
			queries.setBalances(undefined)
			queries.setBalanceState('disconnected')
			queries.setBalanceError(undefined)
			return
		}
		if (configuration === undefined || account === undefined || selected === undefined || selected.loadError !== undefined) {
			balanceRequests.invalidate()
			queries.setBalances(undefined)
			queries.setBalanceState(walletContextInvalidated || selected?.loadError !== undefined ? 'error' : 'disconnected')
			queries.setBalanceError(selected?.loadError)
			return
		}
		const scope = shareBalanceScope(selected)
		const readKey = `${account}|${scope.pool}|${scope.shareToken}|${scope.invalidTokenId.toString()}|${selected.pair ?? ''}`
		const inFlight = balanceRead.current
		if (inFlight !== undefined && inFlight.key === readKey && balanceRequests.isCurrent(inFlight.request)) return
		const request = balanceRequests.begin()
		balanceRead.current = { key: readKey, request }
		const settle = () => {
			if (balanceRead.current?.request === request) balanceRead.current = undefined
		}
		// Balances already loaded for this exact pool stay visible while they revalidate; anything else shows a loading state.
		const retained = queries.balanceState === 'ready' ? liveBalancesForMarket(queries.balances, selected) : undefined
		if (retained === undefined) {
			queries.setBalanceState('loading')
			queries.setBalances(undefined)
		}
		queries.setBalanceError(undefined)
		void services.loadLiveBalances(services.createTradingPublicClient(configuration), selected, account).then(
			loaded => {
				settle()
				if (!balanceRequests.isCurrent(request)) return
				queries.setBalances(loaded)
				queries.setBalanceState('ready')
				queries.setBalanceError(undefined)
			},
			error => {
				settle()
				if (!balanceRequests.isCurrent(request)) return
				queries.setBalanceState('error')
				queries.setBalanceError(publicErrorMessage(error, 'Balance refresh failed'))
			},
		)
	}, [account, configuration, route, selected, walletContextInvalidated])

	useEffect(
		() => () => {
			portfolioBalanceRequests.invalidate()
			balanceRequests.invalidate()
		},
		[balanceRequests, portfolioBalanceRequests],
	)
}
