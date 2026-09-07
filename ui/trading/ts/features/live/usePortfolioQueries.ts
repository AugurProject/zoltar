import type { Address } from '@zoltar/shared/ethereum'
import type { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { useEffect, useState } from 'preact/hooks'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { liveBalancesForMarket, mapWithConcurrency, publicErrorMessage, type LiveBalances, type LiveMarket } from '../../protocol/live.js'
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
	useEffect(() => {
		const request = portfolioBalanceRequests.begin()
		if (route !== 'portfolio') {
			queries.setPortfolioEntries([])
			queries.setPortfolioBalanceState('disconnected')
			queries.setPortfolioBalanceError(undefined)
			return
		}
		queries.setPortfolioEntries(visibleMarkets.map(market => ({ market, balances: undefined, error: market.loadError })))
		if (configuration === undefined || account === undefined) {
			queries.setPortfolioBalanceState(walletContextInvalidated ? 'error' : 'disconnected')
			queries.setPortfolioBalanceError(walletContextInvalidated ? 'Wallet context changed; reconnect before loading portfolio positions' : undefined)
			return
		}
		queries.setPortfolioBalanceState('loading')
		queries.setPortfolioBalanceError(undefined)
		const client = services.createTradingPublicClient(configuration)
		void mapWithConcurrency(visibleMarkets, 6, async (market, index) => {
			if (market.loadError !== undefined) return { market, balances: undefined, error: market.loadError }
			let entry: PortfolioBalanceEntry
			try {
				const loaded = await services.loadLiveBalances(client, market, account, configuration.router)
				entry = { market, balances: liveBalancesForMarket(loaded, market), error: undefined }
			} catch (error) {
				entry = { market, balances: undefined, error: publicErrorMessage(error, 'Balance refresh failed') }
			}
			if (portfolioBalanceRequests.isCurrent(request) && accountRef.current === account) queries.setPortfolioEntries(current => current.map((currentEntry, currentIndex) => (currentIndex === index ? entry : currentEntry)))
			return entry
		})
			.then(entries => {
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				queries.setPortfolioEntries(entries)
				queries.setPortfolioBalanceState('ready')
				queries.setPortfolioBalanceError(undefined)
			})
			.catch(error => {
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				queries.setPortfolioBalanceState('error')
				queries.setPortfolioBalanceError(publicErrorMessage(error, 'Portfolio balance refresh failed'))
			})
		return () => portfolioBalanceRequests.invalidate()
	}, [account, configuration, marketRevision, queries.portfolioRefreshNonce, route, selectedUniverseId, walletContextInvalidated])

	useEffect(() => {
		const request = balanceRequests.begin()
		if (route === 'portfolio') {
			queries.setBalances(undefined)
			queries.setBalanceState('disconnected')
			queries.setBalanceError(undefined)
			return
		}
		if (configuration === undefined || account === undefined || selected === undefined || selected.loadError !== undefined) {
			queries.setBalances(undefined)
			queries.setBalanceState(walletContextInvalidated || selected?.loadError !== undefined ? 'error' : 'disconnected')
			queries.setBalanceError(selected?.loadError)
			return
		}
		queries.setBalanceState('loading')
		queries.setBalanceError(undefined)
		queries.setBalances(undefined)
		void services.loadLiveBalances(services.createTradingPublicClient(configuration), selected, account, configuration.router).then(
			loaded => {
				if (!balanceRequests.isCurrent(request)) return
				queries.setBalances(loaded)
				queries.setBalanceState('ready')
				queries.setBalanceError(undefined)
			},
			error => {
				if (!balanceRequests.isCurrent(request)) return
				queries.setBalanceState('error')
				queries.setBalanceError(publicErrorMessage(error, 'Balance refresh failed'))
			},
		)
		return () => balanceRequests.invalidate()
	}, [account, configuration, route, selected, walletContextInvalidated])
}
