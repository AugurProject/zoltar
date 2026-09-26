import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { isMarketTransactionPending } from './live/marketTransactionActivity.js'
import type { RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { SecurityPoolLink } from '../components/SecurityPoolLink.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, type LiveMarket } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
import { getTradingRouteHref, isTradingLookupRoute, tradingWorkflowRoute, type TradingRoute } from '../lib/routing.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { useLiveTradingController } from './liveTradingController.js'
import { liveTradingControllerServices } from './liveTradingControllerHelpers.js'
import type { LiveTradingControllerServices } from './live/liveTradingTypes.js'
import { LivePortfolio } from './LivePortfolio.js'
import { LivePositionControls } from './LivePositionControls.js'
import { LiveLiquidityControls, liveLiquidityServices, type LiveLiquidityServices } from './LiveLiquidityControls.js'
import { LiveSettlementControls, liveSettlementServices, type LiveSettlementServices } from './LiveSettlementControls.js'
import { DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES } from './LiveTradingTransactionUi.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { liveRouteLoadingPresentation, liveWorkflowRoutePresentation } from './live/routePresentation.js'
import { LiveSecurityPoolDetails, PairInitializationAction, SecurityPoolRouteEmptyState } from './LiveSecurityPoolDetails.js'
import { UniverseDirectory, type LoadUniverseSummary } from './UniverseDirectory.js'
import type { UniverseDiscoveryScope } from '../lib/universeSelection.js'
import { LiveMarketBrowser, marketStatusLabel, marketStatusTone } from './LiveMarketBrowser.js'
import { liveCopy } from '../copy/live.js'
import * as availabilityCopy from '../copy/availability.js'
import { useFocusOnKeyChange } from './live/useFocusOnKeyChange.js'

const ignoreWalletSummaryChange = () => undefined

type MarketWorkspaceView = 'trade' | 'liquidity' | 'settlement'

const MARKET_WORKSPACE_PANEL_ID = 'market-workspace-panel'

function MarketFacts({ market, nowSeconds, headingRef }: { market: LiveMarket; nowSeconds: bigint; headingRef: RefObject<HTMLHeadingElement> }) {
	return (
		<StickyObjectContext
			variant='embedded-context-strip'
			sticky={false}
			title={market.title}
			titleRef={headingRef}
			badge={<Badge tone={marketStatusTone(market, nowSeconds)}>{marketStatusLabel(market, nowSeconds)}</Badge>}
			items={[
				{ label: liveCopy.securityPoolLabel, value: <SecurityPoolLink value={market.pool} /> },
				...(market.loadError === undefined
					? [
							{ label: liveCopy.questionEnd, value: <TimestampValue timestamp={market.endTime} relative={false} /> },
							{ label: liveCopy.ammFee, value: `${formatTrimmedUnits(market.feeBps, 2, 2)}%` },
							{ label: liveCopy.pair, value: market.pair === undefined ? liveCopy.notDeployed : <ReadOnlyAddressValue address={market.pair} responsiveAbbreviation /> },
						]
					: []),
			]}
		/>
	)
}

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
	refreshIntervalMilliseconds,
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
	refreshIntervalMilliseconds?: number | undefined
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
		defaultSlippage: DEFAULT_SLIPPAGE_PERCENT,
		defaultValidityMinutes: DEFAULT_TRANSACTION_VALIDITY_MINUTES,
		refreshIntervalMilliseconds,
		services: controllerServices,
	})
	const { account, walletClient, walletEthAttoEth, networkMismatchReason, connect, connectionMessage, refreshWalletSummaryAfterReceipt, executeWithCurrentWalletContext, createGuardedWalletWrite } = wallet
	const { balanceError, portfolioBalanceState, portfolioBalanceError, visiblePortfolioEntries, selectedBalances, selectedBalanceState, retryBalances, retryPortfolioBalances } = balances
	const { visibleMarkets, listedMarkets, selected, selectedPairInitialized, routePool, discoveryState, discoveryError, marketPage, nowSeconds, refresh, refreshFromControl, loadMarketPage } = discovery
	const { parsedAmount, mode, setMode, side, setSide, amount, setAmount, slippage, setSlippage, transactionValidityMinutes, setTransactionValidityMinutes, quote, state, positionHash, message, positionReceiptWarning, simulate, submit } = position
	const { workflowLocked, updateLiquidityWorkflowLock } = workflow
	const workflowRoute = tradingWorkflowRoute(route)
	const creatingMarket = workflowRoute === 'create-market'
	const [createdMarketTitle, setCreatedMarketTitle] = useState<string>()
	useEffect(() => setCreatedMarketTitle(undefined), [route])
	// Trade and settlement share the `#/market/<address>` hash, so the chosen one is local state; liquidity is its own hash.
	const [closedMarketView, setClosedMarketView] = useState<'trade' | 'settlement'>('settlement')
	useEffect(() => setClosedMarketView('settlement'), [routePool])
	// Moving between addressed markets keeps the same page title, so focus the new market heading here instead of relying on the app heading.
	const marketHeadingRef = useFocusOnKeyChange<HTMLHeadingElement>(selected?.pool, false)
	const previousWalletConnectRequestNonce = useRef(walletConnectRequestNonce)
	useEffect(() => onDiscoveryStateChange?.(discoveryState), [discoveryState, onDiscoveryStateChange])
	useEffect(() => {
		if (walletConnectRequestNonce === undefined) return
		if (previousWalletConnectRequestNonce.current === walletConnectRequestNonce) return
		previousWalletConnectRequestNonce.current = walletConnectRequestNonce
		void connect()
	}, [connect, walletConnectRequestNonce])
	// A failed deployment lookup switches the application to the deployment setup route, which owns the
	// error surface, so this route only ever renders while the deployment is still resolving.
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
	let walletActionLabel = account === undefined ? appCopy.connectWallet : abbreviateAddress(account, 6, 4)
	if (account === undefined && networkMismatchReason !== undefined) walletActionLabel = availabilityCopy.formatSwitchNetworkAction(configuration.chainName)
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
						<RetryableNotice message={liveCopy.describeDiscoveryFailure(liveCopy.discoveryFailureLead(route), discoveryError)} retryLabel={commonCopy.retry} onRetry={refreshFromControl} disabled={workflowLocked} />
					) : (
						<StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails, detailIsLoading: true }} />
					)}
				</div>
			)
		return <UniverseDirectory configuration={configuration} connectionMessage={connectionMessage} universeId={BigInt(confirmedUniverseId)} {...(loadUniverseSummary === undefined ? {} : { loadUniverse: loadUniverseSummary })} />
	}
	if (isTradingLookupRoute(route)) {
		const routePresentation = liveWorkflowRoutePresentation(route)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={routePresentation.title} description={routePresentation.description} actions={walletAction} />
				<ErrorNotice message={connectionMessage} />
				<LiveMarketBrowser lookupRoute={route} markets={listedMarkets} pageMarketCount={visibleMarkets.length} discoveryState={discoveryState} discoveryError={discoveryError} marketPage={marketPage} workflowLocked={workflowLocked} nowSeconds={nowSeconds} retry={refreshFromControl} loadMarketPage={loadMarketPage} />
			</div>
		)
	}
	if (routePool !== undefined && route.startsWith('security-pool/')) {
		if (selected !== undefined)
			return (
				<LiveSecurityPoolDetails market={selected} refreshError={discoveryState === 'error' ? (discoveryError ?? liveCopy.unknownDiscovery) : undefined} refreshing={discoveryState === 'loading'} retry={refreshFromControl} workflowLocked={workflowLocked} nowSeconds={nowSeconds} connectionMessage={connectionMessage} />
			)
		return (
			<div className='route-view-flow'>
				<RouteHeader title={appCopy.securityPool} description={appCopy.securityPoolRouteDescription} />
				<ErrorNotice message={connectionMessage} />
				<SectionBlock variant='plain' busy={discoveryState === 'loading'}>
					<SecurityPoolRouteEmptyState discoveryState={discoveryState} discoveryError={discoveryError} workflowLocked={workflowLocked} retry={refreshFromControl} />
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
					{discoveryState === 'error' || discovering || (discoveryState === 'ready' && visibleMarkets.length === 0) ? null : <LivePortfolio entries={visiblePortfolioEntries} balanceState={portfolioBalanceState} balanceError={portfolioBalanceError} retryBalances={retryPortfolioBalances} />}
				</SectionBlock>
			</div>
		)
	}
	const routePresentation = liveWorkflowRoutePresentation(workflowRoute)
	// Navigation stays free while a transaction is pending; the market it touches keeps its ticket locked until it settles.
	const ticketLocked = workflowLocked || isMarketTransactionPending(selected?.pool)
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
	// The route header names the workflow; the object header below carries the market question, status, and facts, so
	// neither repeats the other. Focus lands on the object header when the addressed market changes.
	return (
		<div className='route-view-flow'>
			<RouteHeader title={routePresentation.title} description={selected === undefined ? routePresentation.description : undefined} actions={walletAction} />
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
						<SecurityPoolRouteEmptyState discoveryState={discoveryState} discoveryError={discoveryError} workflowLocked={workflowLocked} retry={refreshFromControl} />
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
							</SectionBlock>
						)
					if (selected.loadError !== undefined)
						return (
							<SectionBlock key={selected.pool} variant='plain'>
								<MarketFacts market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} />
								<ErrorNotice message={liveCopy.securityPoolCouldNotLoad(selected.loadError)} />
							</SectionBlock>
						)
					if (creatingMarket)
						return (
							<SectionBlock key={selected.pool} title={appCopy.liquidity}>
								<MarketFacts market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} />
								<LiveLiquidityControls
									configuration={configuration}
									market={selected}
									balances={selectedBalances}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									account={account}
									walletClient={walletClient}
									networkMismatchReason={networkMismatchReason}
									walletEthAttoEth={walletEthAttoEth}
									externallyLocked={ticketLocked}
									nowSeconds={nowSeconds}
									refresh={async () => {
										await refresh(configuration, marketPage.start, 'liquidity')
										setCreatedMarketTitle(selected.title)
									}}
									onKnownReceipt={refreshWalletSummaryAfterReceipt}
									executeWithCurrentWalletContext={executeWithCurrentWalletContext}
									createGuardedWalletWrite={createGuardedWalletWrite}
									retryBalances={retryBalances}
									onWorkflowLockChange={updateLiquidityWorkflowLock}
									services={liquidityServices}
								/>
							</SectionBlock>
						)
					return (
						<SectionBlock key={selected.pool} className='market-workspace'>
							<MarketFacts market={selected} nowSeconds={nowSeconds} headingRef={marketHeadingRef} />
							<ViewTabs ariaLabel={appCopy.marketWorkspaceViews} semantics='tabs' size='compact' value={activeView} onChange={openView} options={viewOptions} />
							<div className='market-workspace-panel' role='tabpanel' id={MARKET_WORKSPACE_PANEL_ID} aria-labelledby={viewTabId(activeView)}>
								{activeView === 'settlement' ? (
									<LiveSettlementControls
										configuration={configuration}
										market={selected}
										balances={selectedBalances}
										balanceState={selectedBalanceState}
										balanceError={balanceError}
										account={account}
										walletClient={walletClient}
										networkMismatchReason={networkMismatchReason}
										externallyLocked={ticketLocked}
										refresh={() => refresh(configuration, marketPage.start, 'liquidity')}
										onKnownReceipt={refreshWalletSummaryAfterReceipt}
										executeWithCurrentWalletContext={executeWithCurrentWalletContext}
										createGuardedWalletWrite={createGuardedWalletWrite}
										retryBalances={retryBalances}
										onWorkflowLockChange={updateLiquidityWorkflowLock}
										services={settlementServices}
									/>
								) : null}
								{activeView === 'liquidity' ? (
									<LiveLiquidityControls
										configuration={configuration}
										market={selected}
										balances={selectedBalances}
										balanceState={selectedBalanceState}
										balanceError={balanceError}
										account={account}
										walletClient={walletClient}
										networkMismatchReason={networkMismatchReason}
										walletEthAttoEth={walletEthAttoEth}
										externallyLocked={ticketLocked}
										nowSeconds={nowSeconds}
										refresh={() => refresh(configuration, marketPage.start, 'liquidity')}
										onKnownReceipt={refreshWalletSummaryAfterReceipt}
										executeWithCurrentWalletContext={executeWithCurrentWalletContext}
										createGuardedWalletWrite={createGuardedWalletWrite}
										retryBalances={retryBalances}
										onWorkflowLockChange={updateLiquidityWorkflowLock}
										services={liquidityServices}
									/>
								) : null}
								{activeView === 'trade' && !selectedPairInitialized ? <PairInitializationAction market={selected} nowSeconds={nowSeconds} /> : null}
								{activeView === 'trade' && selectedPairInitialized ? (
									<LivePositionControls
										market={selected}
										balances={selectedBalances}
										balanceState={selectedBalanceState}
										balanceError={balanceError}
										walletConnected={account !== undefined && walletClient !== undefined}
										networkMismatchReason={networkMismatchReason}
										walletEthAttoEth={walletEthAttoEth}
										mode={mode}
										side={side}
										amount={amount}
										amountError={parsedAmount.error}
										slippage={slippage}
										transactionValidityMinutes={transactionValidityMinutes}
										quote={quote}
										state={state}
										message={message}
										receiptWarning={positionReceiptWarning}
										transactionHash={positionHash}
										externallyLocked={ticketLocked}
										nowSeconds={nowSeconds}
										setMode={setMode}
										setSide={setSide}
										setAmount={setAmount}
										setSlippage={setSlippage}
										setTransactionValidityMinutes={setTransactionValidityMinutes}
										simulate={simulate}
										submit={submit}
										retryBalances={retryBalances}
									/>
								) : null}
							</div>
						</SectionBlock>
					)
				})()}
			</div>
		</div>
	)
}
