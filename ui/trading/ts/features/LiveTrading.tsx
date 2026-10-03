import { parsedUniverseId } from './live/useLiveTradingState.js'
import * as portfolioCopy from '../copy/portfolio.js'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { isMarketTransactionPending } from './live/marketTransactionActivity.js'
import { parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, type LiveMarket } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
import * as coreAppCopy from '@zoltar/ui-core-shared/copy/app.js'
import { getTradingRouteHref, isTradingLookupRoute, tradingListKindFor, tradingWorkflowRoute, type TradingRoute } from '../lib/routing.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { useLiveTradingController } from './liveTradingController.js'
import { liveTradingControllerServices } from './liveTradingControllerHelpers.js'
import type { LiveTradingControllerServices, LiveWorkflowPanelProps } from './live/liveTradingTypes.js'
import { LivePortfolio } from './LivePortfolio.js'
import { LivePositionControls } from './LivePositionControls.js'
import { LiveLiquidityControls, liveLiquidityServices, type LiveLiquidityServices } from './LiveLiquidityControls.js'
import { LiveSettlementControls, liveSettlementServices, type LiveSettlementServices } from './LiveSettlementControls.js'
import { DEFAULT_TRADE_SETTINGS, type TradeSettings } from '../lib/tradeSettings.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { liveLookupRoutePresentation, liveRouteLoadingPresentation, liveWorkflowRoutePresentation } from './live/routePresentation.js'
import { LiveSecurityPoolDetails, PairInitializationAction, SecurityPoolRouteEmptyState } from './LiveSecurityPoolDetails.js'
import { UniverseLink } from '@zoltar/ui-core-shared/components/UniverseLink.js'
import { UniverseDirectory } from './UniverseDirectory.js'
import type { LoadUniverseSummary } from './useUniverseSummary.js'
import type { UniverseDiscoveryScope } from '../lib/universeSelection.js'
import { LiveMarketBrowser } from './LiveMarketBrowser.js'
import { MarketContracts, MarketFacts, MarketOverview, MarketPageHeader } from './MarketOverview.js'
import { MarketPosition } from './MarketPosition.js'
import { MarketTicketSheet, type TicketActivity } from './MarketTicketSheet.js'
import { marketOddsPercent } from '../lib/marketListing.js'
import { marketViewHref, readMarketViewParam, readTicketParam, replaceRouteHashSearch, writeMarketViewParam, writeTicketParam, type TicketSelection } from '../lib/routeState.js'
import { transactionInFlight, transactionStatusText } from './live/transactionPresentation.js'
import * as ticketCopy from '../copy/tradeTicket.js'
import { marketsCopy } from '../copy/markets.js'
import { liveCopy } from '../copy/live.js'
import { useFocusOnKeyChange } from './live/useFocusOnKeyChange.js'
import { useDownloadedEntities, useFavorites, useRememberOpenedEntity } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { getRememberableMarket, marketDownloadStore, selectFavoriteMarkets, selectMarketCacheUpdates } from '../lib/favoriteMarkets.js'

const ignoreWalletSummaryChange = () => undefined

type MarketWorkspaceView = 'trade' | 'liquidity' | 'settlement'

const MARKET_WORKSPACE_PANEL_ID = 'market-workspace-panel'

export function LiveTrading({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
	urlUniverseId,
	confirmedUniverseId,
	loadUniverseSummary,
	onDiscoveryStateChange,
	onUniversesChange = () => undefined,
	onWorkflowLockChange,
	onWalletSummaryChange = ignoreWalletSummaryChange,
	walletSummaryRetryNonce = 0,
	walletConnectRequestNonce,
	tradeSettings = DEFAULT_TRADE_SETTINGS,
	controllerServices = liveTradingControllerServices,
	liquidityServices = liveLiquidityServices,
	settlementServices = liveSettlementServices,
}: {
	route: TradingRoute
	configuration: DeploymentConfiguration | undefined
	configurationError: string | undefined
	selectedUniverseId?: string | undefined
	/** The `universe` parameter the application is honouring, recorded in each discovery answer's scope. */
	urlUniverseId?: bigint | undefined
	/** The universe discovery has confirmed; the universe route waits for it so an unknown request never renders as a universe. */
	confirmedUniverseId?: string | undefined
	/** Test seam for the universe route's summary read. */
	loadUniverseSummary?: LoadUniverseSummary | undefined
	/** Lets the shell know when universe discovery has failed, so the header can say so instead of loading forever. */
	onDiscoveryStateChange?: ((state: 'loading' | 'ready' | 'error' | 'not-found') => void) | undefined
	onUniversesChange?(universeIds: readonly bigint[], selectedUniverseId: bigint | undefined, scope: UniverseDiscoveryScope): void
	onWorkflowLockChange(locked: boolean): void
	onWalletSummaryChange?(summary: WalletSummaryState): void
	walletSummaryRetryNonce?: number
	walletConnectRequestNonce?: number
	/** Slippage and validity from the application Settings menu; every Trading transaction uses them. */
	tradeSettings?: TradeSettings
	controllerServices?: LiveTradingControllerServices
	liquidityServices?: LiveLiquidityServices
	settlementServices?: LiveSettlementServices
}) {
	const { wallet, balances, discovery, position, workflow } = useLiveTradingController({
		route,
		configuration,
		configurationError,
		selectedUniverseId,
		urlUniverseId,
		onUniversesChange,
		onWorkflowLockChange,
		onWalletSummaryChange,
		walletSummaryRetryNonce,
		settings: tradeSettings,
		services: controllerServices,
	})
	const { account, walletClient, walletEthAttoEth, networkMismatchReason, connect, connectionMessage, refreshWalletSummaryAfterReceipt, executeWithCurrentWalletContext, createGuardedWalletWrite } = wallet
	const { balanceError, portfolioBalanceState, portfolioBalanceError, visiblePortfolioEntries, selectedBalances, selectedBalanceState, retryBalances, retryPortfolioBalances } = balances
	const { visibleMarkets, listedMarkets, selected, selectedPairInitialized, routePool, discoveryState, discoveryError, discoveryFreshness: freshness, nowSeconds, refresh, refreshFromControl, refreshLocked, marketPage } = discovery
	const { mode, side, setMode, setSide } = position
	const { workflowLocked, marketWorkflowLocked, updateLiquidityWorkflowLock } = workflow
	const workflowRoute = tradingWorkflowRoute(route)
	const creatingMarket = workflowRoute === 'create-market'
	const existingMarketPool = creatingMarket && routePool !== undefined && selected?.pool.toLowerCase() === routePool.toLowerCase() && selected.pair !== undefined && selected.loadError === undefined ? selected.pool : undefined
	useEffect(() => {
		if (existingMarketPool === undefined || marketWorkflowLocked) return
		window.location.replace(getTradingRouteHref(`#/market/${existingMarketPool}`))
	}, [existingMarketPool, marketWorkflowLocked])
	// Trade and settlement share the `#/market/<address>` hash, so a closed market's chosen view lives in its `view` parameter; liquidity is its own hash.
	const [closedMarketView, setClosedMarketView] = useState<'trade' | 'settlement'>('settlement')
	useEffect(() => setClosedMarketView(readMarketViewParam(parseRouteHash(window.location.hash).search) ?? 'settlement'), [routePool])
	// Moving between addressed markets keeps the same page title, so focus the new market heading here instead of relying on the app heading.
	const marketHeadingRef = useFocusOnKeyChange<HTMLHeadingElement>(selected?.pool, false)
	const favoriteMarketIds = useFavorites('trading', 'market')
	const favoritePoolIds = useFavorites('trading', 'pool')
	const downloadedPools = useDownloadedEntities('trading', 'pool', marketDownloadStore)
	const downloadedMarkets = useDownloadedEntities('trading', 'market', marketDownloadStore)
	// Lists show saved favorites; opening a pool reads and remembers its current summary.
	const listsMarkets = tradingListKindFor(route) === 'markets'
	// A successfully opened pool is saved for creation; pools with a pair also become market favorites.
	const rememberedMarket = routePool === undefined ? undefined : getRememberableMarket(selected)
	const rememberedPool = routePool !== undefined && selected?.loadError === undefined ? selected : undefined
	useRememberOpenedEntity('trading', 'pool', marketDownloadStore, rememberedPool?.pool, rememberedPool)
	useRememberOpenedEntity('trading', 'market', marketDownloadStore, rememberedMarket?.pool, rememberedMarket)
	const recordedMarkets = useRef(new Map<string, LiveMarket>())
	const marketCacheUpdates = selectMarketCacheUpdates(listedMarkets, recordedMarkets.current, favoriteMarketIds.entries)
	useEffect(() => {
		// A workflow can revoke partial discovery; persist only the completed list.
		if (discoveryState !== 'ready' || marketCacheUpdates.length === 0) return
		for (const update of marketCacheUpdates) recordedMarkets.current.set(update.id, update.data)
		downloadedMarkets.record(marketCacheUpdates)
	})
	// Arriving on a market with a `ticket` parameter (a market-card, portfolio, or refreshed link) opens the ticket on
	// that direction and side; the ticket then keeps its current selection in the parameter so a refresh restores it.
	const [ticketOpenRequested, setTicketOpenRequested] = useState(false)
	const positionInputRef = useRef({ mode, side, setMode, setSide })
	positionInputRef.current = { mode, side, setMode, setSide }
	useEffect(() => {
		// A request left unconsumed by a market that never loaded must not open the sheet on the next market.
		setTicketOpenRequested(false)
		if (routePool === undefined || workflowRoute !== 'market') return
		const requested = readTicketParam(parseRouteHash(window.location.hash).search)
		if (requested === undefined) return
		const current = positionInputRef.current
		if (current.mode !== requested.mode) current.setMode(requested.mode)
		if (current.side !== requested.side) current.setSide(requested.side)
		setTicketOpenRequested(true)
	}, [routePool, workflowRoute])
	useEffect(() => {
		if (routePool === undefined || workflowRoute !== 'market') return
		replaceRouteHashSearch(search => writeTicketParam(search, { mode, side }))
	}, [mode, side, routePool, workflowRoute])
	const handleTicketOpenRequest = useCallback(() => setTicketOpenRequested(false), [])
	const previousWalletConnectRequestNonce = useRef(walletConnectRequestNonce)
	useEffect(() => onDiscoveryStateChange?.(discoveryState), [discoveryState, onDiscoveryStateChange])
	useEffect(() => {
		if (walletConnectRequestNonce === undefined) return
		if (previousWalletConnectRequestNonce.current === walletConnectRequestNonce) return
		previousWalletConnectRequestNonce.current = walletConnectRequestNonce
		void connect()
	}, [connect, walletConnectRequestNonce])
	// A failed deployment lookup switches the application to the deployment setup or the connection error,
	// which own the error surface, so this route only ever renders while the deployment is still resolving.
	if (configuration === undefined) {
		const loadingPresentation = liveRouteLoadingPresentation(route)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={loadingPresentation.title} description={loadingPresentation.description} />
				<StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: appCopy.loadingContracts, detailIsLoading: true }} />
			</div>
		)
	}
	// Connecting re-requests the deployment chain first, so the same action switches a wallet that is on another network.
	let walletActionLabel = account === undefined ? appCopy.connectWallet : <ReadOnlyAddressValue address={account} />
	if (account === undefined && networkMismatchReason !== undefined) walletActionLabel = coreAppCopy.formatSwitchToNetwork(configuration.chainName)
	// The workflow panels' first step: connect, or switch a connected wallet back to the deployment chain.
	const ticketWallet = {
		connected: account !== undefined && walletClient !== undefined,
		networkMismatchReason,
		actionLabel: networkMismatchReason === undefined ? appCopy.connectWallet : coreAppCopy.formatSwitchToNetwork(configuration.chainName),
		walletEthAttoEth,
		connect,
	}
	const ticketHoldings = { balances: selectedBalances, balanceState: selectedBalanceState, balanceError, retry: retryBalances }
	const walletAction =
		walletConnectRequestNonce === undefined ? (
			<button className='secondary wallet-button' type='button' disabled={workflowLocked} onClick={connect}>
				{walletActionLabel}
			</button>
		) : undefined
	if (route === 'universe') {
		// Discovery confirms the requested universe before the directory describes it, so an unknown request never renders as a universe.
		if (confirmedUniverseId === undefined || discoveryState === 'error')
			return (
				<div className='route-view-flow'>
					<RouteHeader title={appCopy.universe} />
					<ErrorNotice message={connectionMessage} />
					{discoveryState === 'error' ? (
						<RetryableNotice message={liveCopy.describeDiscoveryFailure(liveCopy.discoveryFailureLead(route), discoveryError)} retryLabel={commonCopy.retry} onRetry={refreshFromControl} disabled={refreshLocked} />
					) : (
						<StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails, detailIsLoading: true }} />
					)}
					{discoveryState === 'error' && (parsedUniverseId(selectedUniverseId) ?? 0n) !== 0n ? (
						<UniverseLink className='button-link secondary-link' universeId={0n}>
							{commonCopy.goToGenesisUniverse}
						</UniverseLink>
					) : undefined}
				</div>
			)
		return <UniverseDirectory configuration={configuration} connectionMessage={connectionMessage} universeId={BigInt(confirmedUniverseId)} {...(loadUniverseSummary === undefined ? {} : { loadUniverse: loadUniverseSummary })} />
	}
	if (isTradingLookupRoute(route)) {
		const routePresentation = liveLookupRoutePresentation(route)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={routePresentation.title} description={routePresentation.description} actions={walletAction} />
				<ErrorNotice message={connectionMessage} />
				<LiveMarketBrowser
					key={listsMarkets ? 'markets' : 'security-pools'}
					lookupRoute={route}
					fetchedAtByPool={new Map((listsMarkets ? downloadedMarkets.entries : downloadedPools.entries).map(entry => [entry.id, entry.fetchedAt]))}
					markets={selectFavoriteMarkets(listsMarkets ? downloadedMarkets.entries : downloadedPools.entries, listsMarkets ? favoriteMarketIds.entries : favoritePoolIds.entries, selectedUniverseId).filter(market => (listsMarkets ? market.pair !== undefined : market.pair === undefined))}
					discoveryState={discoveryState}
					discoveryError={discoveryError}
					workflowLocked={refreshLocked}
					nowSeconds={nowSeconds}
					retry={refreshFromControl}
				/>
			</div>
		)
	}
	if (routePool !== undefined && route.startsWith('security-pool/')) {
		if (selected !== undefined)
			return (
				<LiveSecurityPoolDetails market={selected} refreshError={discoveryState === 'error' ? (discoveryError ?? liveCopy.unknownDiscovery) : undefined} refreshing={discoveryState === 'loading'} retry={refreshFromControl} workflowLocked={refreshLocked} nowSeconds={nowSeconds} connectionMessage={connectionMessage} />
			)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={appCopy.securityPool} description={appCopy.securityPoolRouteDescription} />
				<ErrorNotice message={connectionMessage} />
				<SectionBlock variant='plain' busy={discoveryState === 'loading'}>
					<SecurityPoolRouteEmptyState discoveryState={discoveryState} discoveryError={discoveryError} workflowLocked={refreshLocked} retry={refreshFromControl} />
				</SectionBlock>
			</div>
		)
	}
	if (route === 'portfolio') {
		// Balances cannot be judged empty until discovery has produced the pools they belong to.
		const discovering = discoveryState === 'loading' && visibleMarkets.length === 0
		return (
			<div className='route-view-flow'>
				<RouteHeader
					title={appCopy.portfolio}
					actions={
						<>
							<button className='secondary' type='button' disabled={discoveryState === 'loading' || freshness.refreshing} aria-busy={discoveryState === 'loading' || freshness.refreshing} onClick={refreshFromControl}>
								{discoveryState === 'loading' || freshness.refreshing ? commonCopy.refreshingData : portfolioCopy.refreshPortfolio}
							</button>
							{walletAction}
						</>
					}
				/>
				<ErrorNotice message={connectionMessage} />
				<SectionBlock variant='plain' busy={discoveryState === 'loading'}>
					{discovering ? <EmptyState live title={liveCopy.discoveringSecurityPools} /> : null}
					<ErrorNotice message={discoveryState === 'error' ? liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError) : undefined} />
					{discoveryState === 'ready' && visibleMarkets.length === 0 ? <EmptyState title={portfolioCopy.noSavedPools} detail={portfolioCopy.savePoolGuidance} /> : null}
					{(discoveryState === 'error' && visibleMarkets.length === 0) || discovering || (discoveryState === 'ready' && visibleMarkets.length === 0) ? null : (
						<LivePortfolio
							discoveryComplete={discoveryState === 'ready'}
							entries={visiblePortfolioEntries}
							balanceState={portfolioBalanceState}
							balanceError={portfolioBalanceError}
							retryBalances={retryPortfolioBalances}
							nowSeconds={nowSeconds}
							walletAction={{ label: walletActionLabel, disabled: workflowLocked, onClick: () => void connect() }}
							universeId={confirmedUniverseId === undefined ? undefined : BigInt(confirmedUniverseId)}
						/>
					)}
				</SectionBlock>
			</div>
		)
	}
	const routePresentation = liveWorkflowRoutePresentation(workflowRoute)
	// Navigation stays free while a transaction is pending; only the market it touches keeps its ticket locked until it settles.
	const ticketLocked = marketWorkflowLocked || isMarketTransactionPending(selected?.pool)
	const marketOpen = selected !== undefined && marketAcceptsNewRisk(selected, nowSeconds)
	let activeView: MarketWorkspaceView = marketOpen ? 'trade' : closedMarketView
	if (workflowRoute === 'liquidity') activeView = 'liquidity'
	const viewTabId = (view: MarketWorkspaceView) => `market-workspace-${view}-tab`
	const openView = (view: MarketWorkspaceView) => {
		if (selected === undefined) return
		if (view === 'liquidity') {
			window.location.hash = getTradingRouteHref(`#/liquidity/${selected.pool}`)
			return
		}
		setClosedMarketView(view)
		// Only a closed market offers both views; its choice stays in the hash so a refresh keeps it.
		const viewParam = marketOpen ? undefined : view
		if (workflowRoute === 'market') replaceRouteHashSearch(search => writeMarketViewParam(search, viewParam))
		else window.location.hash = marketViewHref(selected.pool, viewParam)
	}
	const viewOptions = [
		{ value: 'trade' as const, id: viewTabId('trade'), panelId: MARKET_WORKSPACE_PANEL_ID, label: appCopy.trade },
		{ value: 'liquidity' as const, id: viewTabId('liquidity'), panelId: MARKET_WORKSPACE_PANEL_ID, label: appCopy.liquidity },
		...(marketOpen ? [] : [{ value: 'settlement' as const, id: viewTabId('settlement'), panelId: MARKET_WORKSPACE_PANEL_ID, label: appCopy.settlement }]),
	]
	const odds = selected === undefined ? undefined : marketOddsPercent(selected)
	// On narrow screens the collapsed ticket offers one-tap YES / NO entry while the trade view can take a new position,
	// and a holder also gets a Sell entry on the outcome they hold (the larger holding when they hold both).
	let sellSide: 'YES' | 'NO' | undefined
	if (selectedBalances !== undefined && (selectedBalances.yes > 0n || selectedBalances.no > 0n)) sellSide = selectedBalances.no > selectedBalances.yes ? 'NO' : 'YES'
	const quickPick =
		odds !== undefined && marketOpen && activeView === 'trade' && selectedPairInitialized
			? {
					yesPercent: odds.yes,
					noPercent: odds.no,
					sellSide,
					pick: (selection: TicketSelection) => {
						setMode(selection.mode)
						setSide(selection.side)
					},
				}
			: undefined
	// Closing the sheet must not hide a running transaction: the collapsed bar shows its progress until it settles.
	let ticketActivity: TicketActivity | undefined
	const tradeActionLabel = mode === 'entry' ? ticketCopy.buyOutcome(side) : ticketCopy.sellOutcome(side)
	const tradeStatus = transactionStatusText(position.state, tradeActionLabel)
	if (tradeStatus !== undefined && (transactionInFlight(position.state) || position.state === 'confirmed')) ticketActivity = { text: tradeStatus, settled: position.state === 'confirmed' && !ticketLocked }
	else if (ticketLocked) ticketActivity = { text: marketsCopy.transactionInProgress, settled: false }
	// A loaded market's trade and liquidity pages are titled by the market question itself, with a way back to the list;
	// other states name the workflow and let the object header below carry the question. Focus lands on whichever
	// heading names the market when the addressed market changes.
	const showsMarketPage = selected !== undefined && !creatingMarket && selected.loadError === undefined
	return (
		<div className='route-view-flow'>
			{showsMarketPage ? <MarketPageHeader market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} actions={walletAction} /> : <RouteHeader title={routePresentation.title} description={selected === undefined ? routePresentation.description : undefined} actions={walletAction} />}
			<ErrorNotice message={connectionMessage} />
			<ErrorNotice message={selected !== undefined && discoveryState === 'error' ? liveCopy.securityPoolRefreshFailed(discoveryError ?? liveCopy.unknownDiscovery) : undefined} />
			<div className='market-stack'>
				{selected === undefined ? (
					<SectionBlock variant='plain' busy={discoveryState === 'loading'}>
						<SecurityPoolRouteEmptyState discoveryState={discoveryState} discoveryError={discoveryError} workflowLocked={refreshLocked} retry={refreshFromControl} />
					</SectionBlock>
				) : null}
				{(() => {
					if (selected === undefined) return null
					if (creatingMarket && selected.pair !== undefined)
						return (
							<SectionBlock variant='plain'>
								<MarketFacts market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} />
								<MarketContracts market={selected} />
							</SectionBlock>
						)
					if (selected.loadError !== undefined)
						return (
							<SectionBlock key={selected.pool} variant='plain'>
								<MarketFacts market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} />
								<ErrorNotice message={liveCopy.securityPoolCouldNotLoad(selected.loadError)} />
							</SectionBlock>
						)
					const workflowPanelProps: LiveWorkflowPanelProps = {
						configuration,
						market: selected,
						balances: selectedBalances,
						balanceState: selectedBalanceState,
						balanceError,
						account,
						walletClient,
						networkMismatchReason,
						wallet: ticketWallet,
						settings: tradeSettings,
						nowSeconds,
						externallyLocked: ticketLocked,
						// An explicit background workflow refresh supersedes any block poll already in flight.
						refresh: options => refresh(configuration, marketPage.start, 'liquidity', { ...options, ownerMarket: selected.pool, explicit: options?.background === true }),
						onKnownReceipt: refreshWalletSummaryAfterReceipt,
						executeWithCurrentWalletContext,
						createGuardedWalletWrite,
						retryBalances,
						onWorkflowLockChange: updateLiquidityWorkflowLock,
					}
					if (creatingMarket)
						return (
							<SectionBlock key={selected.pool} title={appCopy.liquidity}>
								<MarketFacts market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} />
								<LiveLiquidityControls {...workflowPanelProps} walletEthAttoEth={walletEthAttoEth} nowSeconds={nowSeconds} services={liquidityServices} />
							</SectionBlock>
						)
					const ticket = (
						<SectionBlock className='market-workspace'>
							<ViewTabs ariaLabel={appCopy.marketWorkspaceViews} semantics='tabs' size='compact' value={activeView} onChange={openView} options={viewOptions} />
							<div className='market-workspace-panel' role='tabpanel' id={MARKET_WORKSPACE_PANEL_ID} aria-labelledby={viewTabId(activeView)}>
								{activeView === 'settlement' ? <LiveSettlementControls {...workflowPanelProps} services={settlementServices} /> : null}
								{activeView === 'liquidity' ? <LiveLiquidityControls {...workflowPanelProps} walletEthAttoEth={walletEthAttoEth} nowSeconds={nowSeconds} services={liquidityServices} /> : null}
								{activeView === 'trade' && !selectedPairInitialized ? <PairInitializationAction market={selected} nowSeconds={nowSeconds} /> : null}
								{activeView === 'trade' && selectedPairInitialized ? (
									<LivePositionControls market={selected} nowSeconds={nowSeconds} settings={tradeSettings} ticket={position} wallet={ticketWallet} holdings={ticketHoldings} externallyLocked={ticketLocked} onOpenSettlement={marketOpen ? undefined : () => openView('settlement')} />
								) : null}
							</div>
						</SectionBlock>
					)
					return (
						<div key={selected.pool} className='market-layout'>
							<SectionBlock className='market-layout__main' variant='plain'>
								<MarketOverview market={selected} position={<MarketPosition market={selected} holdings={ticketHoldings} wallet={ticketWallet} disabled={workflowLocked} ownsBalanceError={activeView === 'trade'} />} />
							</SectionBlock>
							<MarketTicketSheet viewLabel={viewOptions.find(option => option.value === activeView)?.label ?? appCopy.trade} quickPick={quickPick} activity={ticketActivity} openRequested={ticketOpenRequested} onOpenRequestHandled={handleTicketOpenRequest}>
								{ticket}
							</MarketTicketSheet>
						</div>
					)
				})()}
			</div>
		</div>
	)
}
