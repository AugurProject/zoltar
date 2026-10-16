import { portfolioBalancesUnavailable } from '../../copy/portfolio.js'
import * as workflowCopy from '../../copy/workflows.js'
import { createPortfolioReadQueue } from './portfolioReadQueue.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
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

/** Resolves the given revalidation waiters. */
function release(waiters: ReadonlyArray<() => void>) {
	for (const resolve of waiters) resolve()
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
	// Partial discovery adds pools gradually; queued reads reuse each unchanged market object.
	const portfolioScope = useRef<string>()
	const currentMarkets = useRef(visibleMarkets)
	currentMarkets.current = visibleMarkets
	const portfolioQueue = useRef<{ key: string; read: (market: LiveMarket) => Promise<PortfolioBalanceEntry> }>()
	const balanceRead = useRef<{ key: string; request: RequestIdentity; waiters: Array<() => void> }>()
	const [balanceRevalidationNonce, setBalanceRevalidationNonce] = useState(0)
	const handledBalanceRevalidation = useRef(balanceRevalidationNonce)
	// Callers waiting for a requested re-read of the selected market's balances; the read it starts releases them when it settles.
	const balanceRevalidationWaiters = useRef<Array<() => void>>([]).current

	useEffect(() => {
		if (route !== 'portfolio') {
			portfolioBalanceRequests.invalidate()
			portfolioQueue.current = undefined
			queries.setPortfolioEntries([])
			queries.setPortfolioBalanceState('disconnected')
			queries.setPortfolioBalanceError(undefined)
			return
		}
		// Keep balances already loaded for the same pools visible while they revalidate so background refreshes do not flash cards empty.
		const scopeKey = `${account ?? ''}|${configuration?.chainId ?? ''}|${configuration?.securityPoolFactory ?? ''}|${configuration?.zoltar ?? ''}|${selectedUniverseId ?? ''}`
		const previousEntries = portfolioScope.current === scopeKey ? queries.portfolioEntries : []
		portfolioScope.current = scopeKey
		const previousByPool = new Map(previousEntries.map(entry => [entry.market.pool, entry]))
		const retainedEntries = visibleMarkets.map(market => {
			const candidate = previousByPool.get(market.pool)
			const previous = candidate?.market.shareToken === market.shareToken && candidate.market.universeId === market.universeId ? candidate : undefined
			return { market, balances: liveBalancesForMarket(previous?.balances, market), error: market.loadError ?? previous?.error }
		})
		queries.setPortfolioEntries(retainedEntries)
		if (configuration === undefined || account === undefined) {
			portfolioBalanceRequests.invalidate()
			portfolioQueue.current = undefined
			queries.setPortfolioBalanceState(walletContextInvalidated ? 'error' : 'disconnected')
			queries.setPortfolioBalanceError(walletContextInvalidated ? 'Your wallet account or network changed. Reconnect to load portfolio positions.' : undefined)
			return
		}
		const queueKey = `${scopeKey}|${configuration.rpcUrl}|${configuration.zoltar}|${queries.portfolioRefreshNonce.toString()}`
		if (portfolioQueue.current?.key !== queueKey) {
			const client = services.createTradingPublicClient(configuration)
			let lastReadStarted = 0
			const canRead = (market: LiveMarket) => portfolioQueue.current?.key === queueKey && accountRef.current === account && currentMarkets.current.includes(market)
			portfolioQueue.current = {
				key: queueKey,
				read: createPortfolioReadQueue(async market => {
					if (!canRead(market)) return { market, balances: undefined, error: undefined }
					const delay = Math.max(0, 1_000 - (Date.now() - lastReadStarted))
					if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
					if (!canRead(market)) return { market, balances: undefined, error: undefined }
					lastReadStarted = Date.now()
					try {
						const loaded = await withReadTimeout(services.loadLiveBalances(client, market, account))
						return { market, balances: liveBalancesForMarket(loaded, market), error: undefined }
					} catch (error) {
						return { market, balances: undefined, error: publicErrorMessage(error, workflowCopy.balanceRefreshFailed) }
					}
				}),
			}
		}
		const readBalance = portfolioQueue.current.read
		const request = portfolioBalanceRequests.begin()
		const revalidating = retainedEntries.every(entry => entry.balances !== undefined || entry.error !== undefined)
		queries.setPortfolioBalanceState(revalidating ? 'ready' : 'loading')
		queries.setPortfolioBalanceError(undefined)
		void mapWithConcurrency(visibleMarkets, 1, async (market, index) => {
			if (market.loadError !== undefined) return { market, balances: undefined, error: market.loadError }
			const entry = await readBalance(market)
			if (portfolioBalanceRequests.isCurrent(request) && accountRef.current === account) queries.setPortfolioEntries(current => current.map((currentEntry, currentIndex) => (currentIndex === index ? withCurrentMarket(entry, currentEntry) : currentEntry)))
			return entry
		})
			.then(entries => {
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				queries.setPortfolioEntries(current => entries.map((entry, index) => withCurrentMarket(entry, current[index])))
				queries.setPortfolioBalanceState('ready')
				queries.setPortfolioBalanceError(undefined)
			})
			.catch(error => {
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				queries.setPortfolioBalanceState('error')
				queries.setPortfolioBalanceError(publicErrorMessage(error, portfolioBalancesUnavailable))
			})
	}, [account, configuration, marketRevision, queries.portfolioRefreshNonce, route, selectedUniverseId, walletContextInvalidated])

	useEffect(() => {
		// A requested revalidation (after a confirmed trade) must not join a read that may have started before the change it waits for.
		const forced = handledBalanceRevalidation.current !== balanceRevalidationNonce
		handledBalanceRevalidation.current = balanceRevalidationNonce
		// Waiters belong to the requested read; an effect run for an earlier render leaves them for it.
		const requested = forced ? balanceRevalidationWaiters.splice(0) : []
		if (route === 'portfolio') {
			balanceRequests.invalidate()
			queries.setBalances(undefined)
			queries.setBalanceState('disconnected')
			queries.setBalanceError(undefined)
			release(requested)
			return
		}
		if (configuration === undefined || account === undefined || selected === undefined || selected.loadError !== undefined) {
			balanceRequests.invalidate()
			queries.setBalances(undefined)
			queries.setBalanceState(walletContextInvalidated || selected?.loadError !== undefined ? 'error' : 'disconnected')
			queries.setBalanceError(selected?.loadError)
			release(requested)
			return
		}
		const scope = shareBalanceScope(selected)
		const readKey = `${account}|${scope.pool}|${scope.shareToken}|${scope.invalidTokenId.toString()}|${selected.pair ?? ''}`
		const inFlight = balanceRead.current
		if (!forced && inFlight !== undefined && inFlight.key === readKey && balanceRequests.isCurrent(inFlight.request)) return
		const request = balanceRequests.begin()
		// A newer read answers for whoever waited on the read it replaces.
		const read = { key: readKey, request, waiters: [...requested, ...(inFlight?.waiters.splice(0) ?? [])] }
		balanceRead.current = read
		const settle = () => {
			if (balanceRead.current === read) balanceRead.current = undefined
			release(read.waiters.splice(0))
		}
		// Balances already loaded for this exact pool stay visible while they revalidate; anything else shows a loading state.
		const retained = queries.balanceState === 'ready' ? liveBalancesForMarket(queries.balances, selected) : undefined
		if (retained === undefined) {
			queries.setBalanceState('loading')
			queries.setBalances(undefined)
		}
		queries.setBalanceError(undefined)
		void withReadTimeout(services.loadLiveBalances(services.createTradingPublicClient(configuration), selected, account)).then(
			loaded => {
				if (balanceRequests.isCurrent(request)) {
					queries.setBalances(loaded)
					queries.setBalanceState('ready')
					queries.setBalanceError(undefined)
				}
				settle()
			},
			error => {
				if (balanceRequests.isCurrent(request)) {
					queries.setBalanceState('error')
					queries.setBalanceError(publicErrorMessage(error, workflowCopy.balanceRefreshFailed))
				}
				settle()
			},
		)
	}, [account, configuration, route, selected, walletContextInvalidated, balanceRevalidationNonce])

	useEffect(
		() => () => {
			portfolioBalanceRequests.invalidate()
			portfolioQueue.current = undefined
			balanceRequests.invalidate()
			// Nothing reads balances once unmounted, so nobody may be left waiting for a read.
			release(balanceRevalidationWaiters.splice(0))
			release(balanceRead.current?.waiters.splice(0) ?? [])
		},
		[balanceRequests, portfolioBalanceRequests],
	)

	return {
		/** Re-reads the selected market's balances even while a read is running, and resolves once that read settles, whatever its result. */
		revalidateBalances: () =>
			new Promise<void>(resolve => {
				balanceRevalidationWaiters.push(resolve)
				setBalanceRevalidationNonce(value => value + 1)
			}),
	}
}
