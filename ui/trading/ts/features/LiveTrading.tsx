import { LiveLiquidityWorkspace } from './LiveLiquidityWorkspace.js'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { isMarketTransactionPending } from './live/marketTransactionActivity.js'
import { parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, type LiveMarket } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
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
import { liveLiquidityServices, type LiveLiquidityServices } from './LiveLiquidityControls.js'
import { LiveSettlementControls, liveSettlementServices, type LiveSettlementServices } from './LiveSettlementControls.js'
import { DEFAULT_TRADE_SETTINGS, type TradeSettings } from '../lib/tradeSettings.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { liveLookupRoutePresentation, liveRouteLoadingPresentation, liveWorkflowRoutePresentation } from './live/routePresentation.js'
import { LiveSecurityPoolDetails, PairInitializationAction, SecurityPoolRouteEmptyState } from './LiveSecurityPoolDetails.js'
import { UniverseDirectory } from './UniverseDirectory.js'
import type { LoadUniverseSummary } from './useUniverseSummary.js'
import type { UniverseDiscoveryScope } from '../lib/universeSelection.js'
import { LiveMarketBrowser } from './LiveMarketBrowser.js'
import { MarketContracts, MarketFacts, MarketOverview, MarketPageHeader } from './MarketOverview.js'
import { MarketPosition } from './MarketPosition.js'
import { MarketTicketSheet } from './MarketTicketSheet.js'
import { marketOddsPercent } from '../lib/marketListing.js'
import { hashWithoutTicketSide, readTicketSideParam } from '../lib/ticketSide.js'
import { liveCopy } from '../copy/live.js'
import * as availabilityCopy from '../copy/availability.js'
import { useFocusOnKeyChange } from './live/useFocusOnKeyChange.js'
import { useDownloadedEntities, useFavorites, useRememberOpenedEntity } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { getRememberableMarket, marketDownloadStore, selectBrowseMarkets, selectMarketCacheUpdates } from '../lib/favoriteMarkets.js'

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
	onDiscoveryStateChange?: ((state: 'loading' | 'ready' | 'error') => void) | undefined
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
	const { discoveryRows, visibleMarkets, listedMarkets, selected, selectedPairInitialized, routePool, discoveryState, discoveryError, discoveryFreshness, marketPage, nowSeconds, refresh, refreshFromControl, refreshLocked, loadMarketPage } = discovery
	const { setMode, setSide } = position
	const { workflowLocked, marketWorkflowLocked, updateLiquidityWorkflowLock } = workflow
	const workflowRoute = tradingWorkflowRoute(route)
	const creatingMarket = workflowRoute === 'create-market'
	const [createdMarketTitle, setCreatedMarketTitle] = useState<string>()
	useEffect(() => setCreatedMarketTitle(undefined), [route])
	// Trade and settlement share the `#/market/<address>` hash, so the chosen one is local state; liquidity is its own hash.
	const [closedMarketView, setClosedMarketView] = useState<'trade' | 'settlement'>('settlement')
	useEffect(() => setClosedMarketView('settlement'), [routePool])
	// Moving between addressed markets keeps the same page title, so focus the new market heading here instead of relying on the app heading.
	const marketHeadingRef = useFocusOnKeyChange<HTMLHeadingElement>(selected?.pool, false)
	const favoriteMarketIds = useFavorites('trading', 'market')
	const listedPools = new Set(listedMarkets.map(market => market.pool))
	const listedDiscoveryRows = discoveryRows?.filter(market => market === undefined || listedPools.has(market.pool))
	const downloadedMarkets = useDownloadedEntities('trading', 'market', marketDownloadStore)
	// The market list browses every downloaded market; discovered pages join the cache, other routes only refresh cached favorites.
	const listsMarkets = tradingListKindFor(route) === 'markets'
	// Only the market workflows (trade and liquidity) count as opening a market; pool details and market creation do not.
	const rememberedMarket = route.startsWith('market/') || route.startsWith('liquidity/') ? getRememberableMarket(selected) : undefined
	useRememberOpenedEntity('trading', 'market', marketDownloadStore, rememberedMarket?.pool, rememberedMarket)
	const recordedMarkets = useRef(new Map<string, LiveMarket>())
	const marketCacheUpdates = selectMarketCacheUpdates(listedMarkets, recordedMarkets.current, favoriteMarketIds.entries, listsMarkets)
	useEffect(() => {
		// A workflow can revoke partial discovery; persist only the completed list.
		if (discoveryState !== 'ready' || marketCacheUpdates.length === 0) return
		for (const update of marketCacheUpdates) recordedMarkets.current.set(update.id, update.data)
		downloadedMarkets.record(marketCacheUpdates)
	})
	// A market-card outcome button opens the ticket on that side once; the parameter is then dropped from the hash so later navigation does not carry it.
	const [ticketOpenRequested, setTicketOpenRequested] = useState(false)
	const positionInputRef = useRef({ setMode, setSide })
	positionInputRef.current = { setMode, setSide }
	useEffect(() => {
		// A request left unconsumed by a market that never loaded must not open the sheet on the next market.
		setTicketOpenRequested(false)
		if (routePool === undefined || workflowRoute !== 'market') return
		const requestedSide = readTicketSideParam(parseRouteHash(window.location.hash).search)
		if (requestedSide === undefined) return
		positionInputRef.current.setMode('entry')
		positionInputRef.current.setSide(requestedSide)
		window.history.replaceState(window.history.state, '', hashWithoutTicketSide(window.location.hash))
		setTicketOpenRequested(true)
	}, [routePool, workflowRoute])
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
	if (account === undefined && networkMismatchReason !== undefined) walletActionLabel = availabilityCopy.formatSwitchNetworkAction(configuration.chainName)
	// The workflow panels' first step: connect, or switch a connected wallet back to the deployment chain.
	const ticketWallet = {
		connected: account !== undefined && walletClient !== undefined,
		networkMismatchReason,
		actionLabel: networkMismatchReason === undefined ? appCopy.connectWallet : availabilityCopy.formatSwitchNetworkAction(configuration.chainName),
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
					<RouteHeader title={appCopy.universe} description={appCopy.universeRouteDescription} />
					<ErrorNotice message={connectionMessage} />
					{discoveryState === 'error' ? (
						<RetryableNotice message={liveCopy.describeDiscoveryFailure(liveCopy.discoveryFailureLead(route), discoveryError)} retryLabel={commonCopy.retry} onRetry={refreshFromControl} disabled={refreshLocked} />
					) : (
						<StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails, detailIsLoading: true }} />
					)}
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
					discoveryRows={listedDiscoveryRows}
					lookupRoute={route}
					markets={listsMarkets ? selectBrowseMarkets(downloadedMarkets.entries, listedMarkets, selectedUniverseId) : listedMarkets}
					favorites={favoriteMarketIds.entries}
					pageMarketCount={visibleMarkets.length}
					discoveryState={discoveryState}
					discoveryError={discoveryError}
					freshness={discoveryFreshness}
					marketPage={marketPage}
					workflowLocked={refreshLocked}
					nowSeconds={nowSeconds}
					retry={refreshFromControl}
					loadMarketPage={loadMarketPage}
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
				<RouteHeader title={appCopy.portfolio} actions={walletAction} />
				<ErrorNotice message={connectionMessage} />
				<SectionBlock variant='plain' busy={discoveryState === 'loading'}>
					{discovering ? <EmptyState live title={liveCopy.discoveringSecurityPools} /> : null}
					<ErrorNotice message={discoveryState === 'error' ? liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError) : undefined} />
					{discoveryState === 'ready' && visibleMarkets.length === 0 ? <EmptyState title={liveCopy.noSecurityPoolsInUniverse} /> : null}
					{discoveryState === 'error' || discovering || (discoveryState === 'ready' && visibleMarkets.length === 0) ? null : (
						<LivePortfolio entries={visiblePortfolioEntries} balanceState={portfolioBalanceState} balanceError={portfolioBalanceError} retryBalances={retryPortfolioBalances} nowSeconds={nowSeconds} walletAction={{ label: walletActionLabel, disabled: workflowLocked, onClick: () => void connect() }} />
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
		if (view !== 'liquidity') setClosedMarketView(view === 'settlement' ? 'settlement' : 'trade')
		window.location.hash = getTradingRouteHref(`#/${view === 'liquidity' ? 'liquidity' : 'market'}/${selected.pool}`)
	}
	const viewOptions = [
		{ value: 'trade' as const, id: viewTabId('trade'), panelId: MARKET_WORKSPACE_PANEL_ID, label: appCopy.trade },
		{ value: 'liquidity' as const, id: viewTabId('liquidity'), panelId: MARKET_WORKSPACE_PANEL_ID, label: appCopy.liquidity },
		...(marketOpen ? [] : [{ value: 'settlement' as const, id: viewTabId('settlement'), panelId: MARKET_WORKSPACE_PANEL_ID, label: appCopy.settlement }]),
	]
	const odds = selected === undefined ? undefined : marketOddsPercent(selected)
	// On narrow screens the collapsed ticket offers one-tap YES / NO entry while the trade view can take a new position.
	const quickPick =
		odds !== undefined && marketOpen && activeView === 'trade' && selectedPairInitialized
			? {
					yesPercent: odds.yes,
					noPercent: odds.no,
					pick: (pickedSide: 'YES' | 'NO') => {
						setMode('entry')
						setSide(pickedSide)
					},
				}
			: undefined
	// A loaded market's trade and liquidity pages are titled by the market question itself, with a way back to the list;
	// other states name the workflow and let the object header below carry the question. Focus lands on whichever
	// heading names the market when the addressed market changes.
	const showsMarketPage = selected !== undefined && !creatingMarket && selected.loadError === undefined
	return (
		<div className='route-view-flow'>
			{showsMarketPage ? <MarketPageHeader market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} actions={walletAction} /> : <RouteHeader title={routePresentation.title} description={selected === undefined ? routePresentation.description : undefined} actions={walletAction} />}
			<ErrorNotice message={connectionMessage} />
			{createdMarketTitle === undefined ? null : (
				<p className='detail' role='status'>
					{liveCopy.marketCreated(createdMarketTitle)} <a href={getTradingRouteHref(routePool === undefined ? '#/liquidity' : `#/liquidity/${routePool}`)}>{appCopy.liquidity}</a>
				</p>
			)}
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
								<p className='detail'>
									{liveCopy.poolAlreadyExists} <a href={getTradingRouteHref(`#/liquidity/${selected.pool}`)}>{appCopy.liquidity}</a>
								</p>
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
						externallyLocked: ticketLocked,
						refresh: () => refresh(configuration, marketPage.start, 'liquidity'),
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
								<LiveLiquidityWorkspace
									{...workflowPanelProps}
									walletEthAttoEth={walletEthAttoEth}
									nowSeconds={nowSeconds}
									refresh={async () => {
										await refresh(configuration, marketPage.start, 'liquidity')
										setCreatedMarketTitle(selected.title)
									}}
									services={liquidityServices}
								/>
							</SectionBlock>
						)
					const ticket = (
						<SectionBlock className='market-workspace'>
							<ViewTabs ariaLabel={appCopy.marketWorkspaceViews} semantics='tabs' size='compact' value={activeView} onChange={openView} options={viewOptions} />
							<div className='market-workspace-panel' role='tabpanel' id={MARKET_WORKSPACE_PANEL_ID} aria-labelledby={viewTabId(activeView)}>
								{activeView === 'settlement' ? <LiveSettlementControls {...workflowPanelProps} services={settlementServices} /> : null}
								{activeView === 'liquidity' ? <LiveLiquidityWorkspace {...workflowPanelProps} walletEthAttoEth={walletEthAttoEth} nowSeconds={nowSeconds} services={liquidityServices} /> : null}
								{activeView === 'trade' && !selectedPairInitialized ? <PairInitializationAction market={selected} nowSeconds={nowSeconds} /> : null}
								{activeView === 'trade' && selectedPairInitialized ? <LivePositionControls market={selected} nowSeconds={nowSeconds} settings={tradeSettings} ticket={position} wallet={ticketWallet} holdings={ticketHoldings} externallyLocked={ticketLocked} /> : null}
							</div>
						</SectionBlock>
					)
					return (
						<div key={selected.pool} className='market-layout'>
							<SectionBlock className='market-layout__main' variant='plain'>
								<MarketOverview market={selected} position={<MarketPosition market={selected} holdings={ticketHoldings} wallet={ticketWallet} disabled={workflowLocked} ownsBalanceError={activeView === 'trade'} />} />
							</SectionBlock>
							<MarketTicketSheet viewLabel={viewOptions.find(option => option.value === activeView)?.label ?? appCopy.trade} quickPick={quickPick} openRequested={ticketOpenRequested} onOpenRequestHandled={handleTicketOpenRequest}>
								{ticket}
							</MarketTicketSheet>
						</div>
					)
				})()}
			</div>
		</div>
	)
}
