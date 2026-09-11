import { useEffect, useRef, useState } from 'preact/hooks'
import { formatBpsMultiplier, formatCapacityOwnership, formatMintingCapacity, formatUnits, shortAddress } from '../lib/format.js'
import { Status } from '../components/Status.js'
import { SecurityPoolAddressLink, TradingAddressValue } from '../components/TradingAddress.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import * as appCopy from '../copy/app.js'
import { getTradingRouteHref, isTradingBrowseRoute, isTradingLookupRoute, tradingWorkflowRoute, type TradingRoute } from '../lib/routing.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { useLiveTradingController } from './liveTradingController.js'
import { liveTradingControllerServices } from './liveTradingControllerHelpers.js'
import type { LiveTradingControllerServices } from './live/liveTradingTypes.js'
import { LivePortfolio } from './LivePortfolio.js'
import { LivePositionControls } from './LivePositionControls.js'
import { LiveLiquidityControls, liveLiquidityServices, type LiveLiquidityServices } from './LiveLiquidityControls.js'
import { LiveSettlementControls, liveSettlementServices, type LiveSettlementServices } from './LiveSettlementControls.js'
import { DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES, formatTimestamp } from './LiveTradingTransactionUi.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { liveWorkflowRoutePresentation, portfolioRouteSubtitle } from './live/routePresentation.js'
import { SecurityPoolIdentityRows } from './LiveMarketIdentity.js'
import { LiveMarketBrowser, marketStatusLabel } from './LiveMarketBrowser.js'
import { LiveMarketLookup } from './LiveMarketLookup.js'
import { liveCopy } from '../copy/live.js'

export { liveWorkflowRoutePresentation, portfolioRouteSubtitle } from './live/routePresentation.js'

const ignoreWalletSummaryChange = () => undefined

function systemStateLabel(state: number) {
	if (state === 0) return liveCopy.operational
	if (state === 1) return liveCopy.poolForked
	if (state === 2) return liveCopy.forkMigration
	if (state === 3) return liveCopy.forkTruthAuction
	return liveCopy.unknownSystemState(state)
}

function questionOutcomeLabel(outcome: number) {
	if (outcome === 0) return liveCopy.invalid
	if (outcome === 1) return liveCopy.yes
	if (outcome === 2) return liveCopy.no
	if (outcome === 3) return liveCopy.unresolvedOutcome
	return liveCopy.unknownQuestionOutcome(outcome)
}

export function PairInitializationAction({ market, nowSeconds }: { market: LiveMarket; nowSeconds: bigint }) {
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined)
		return (
			<div class='operation-block'>
				<p>{liveCopy.conditionalPriceUnavailable}</p>
				<button class='primary-action' disabled>
					{liveCopy.pairInitializationUnavailable(blocker)}
				</button>
			</div>
		)
	return (
		<div class='operation-block'>
			<p>{market.pair === undefined ? liveCopy.undeployedPairDescription(formatUnits(market.feeBps, 2, 2)) : liveCopy.uninitializedPairDescription(formatUnits(market.feeBps, 2, 2))}</p>
			<a class='primary-action' href={getTradingRouteHref(`#/${market.pair === undefined ? 'create-market' : 'liquidity'}/${market.pool}`)}>
				{market.pair === undefined ? liveCopy.deployTradingPool : liveCopy.initializeTradingPool}
			</a>
		</div>
	)
}

export function LiveSecurityPoolDetails({
	market,
	refreshError,
	refreshing = false,
	retry,
	workflowLocked,
	nowSeconds,
	connectionMessage,
}: {
	market: LiveMarket
	refreshError?: string | undefined
	refreshing?: boolean
	retry(): void
	workflowLocked: boolean
	nowSeconds: bigint
	connectionMessage?: string | undefined
}) {
	const hasLoadedDetails = market.loadError === undefined
	let refreshMessage: string | undefined
	if (refreshing) refreshMessage = hasLoadedDetails ? liveCopy.refreshingSecurityPool : liveCopy.retryingSecurityPoolDetails
	let errorMessage: string | undefined
	if (market.loadError !== undefined) errorMessage = liveCopy.securityPoolDetailsUnavailable(market.loadError, refreshError)
	else if (refreshError !== undefined) errorMessage = liveCopy.securityPoolRefreshFailed(refreshError)
	// Return to the browse list that includes this pool: markets once a pair exists, otherwise SecurityPools awaiting one.
	const browseBack = market.pair === undefined ? { href: '#/security-pools', label: liveCopy.backToBrowseSecurityPools } : { href: '#/markets', label: liveCopy.backToBrowseMarkets }
	return (
		<main class='route' id='main-content'>
			<RouteHeader eyebrow={<a href={getTradingRouteHref(browseBack.href)}>{browseBack.label}</a>} title={appCopy.securityPool} description={market.title} badge={market.loadError === undefined ? undefined : <Status tone='warn'>{appCopy.poolDataUnavailable}</Status>} />
			{connectionMessage === undefined ? null : (
				<p class='error' role='alert'>
					{connectionMessage}
				</p>
			)}
			<section class='section' aria-busy={refreshing}>
				{refreshMessage === undefined ? null : <p role='status'>{refreshMessage}</p>}
				{errorMessage === undefined ? null : (
					<>
						<p class='error' role='alert'>
							{errorMessage}
						</p>
						{refreshing ? null : (
							<button class='secondary-action' disabled={workflowLocked} onClick={retry}>
								{hasLoadedDetails ? liveCopy.retryRefresh : liveCopy.retrySecurityPool}
							</button>
						)}
					</>
				)}
				{market.loadError === undefined ? (
					<>
						<dl class='fact-list'>
							<SecurityPoolIdentityRows market={market} />
							<div>
								<dt>{liveCopy.questionEnd}</dt>
								<dd>{formatTimestamp(market.endTime)}</dd>
							</div>
							<div>
								<dt>{liveCopy.systemState}</dt>
								<dd>{systemStateLabel(market.systemState)}</dd>
							</div>
							<div>
								<dt>{liveCopy.universeFork}</dt>
								<dd>{market.universeForkTime === 0n ? liveCopy.notForked : liveCopy.forkedAt(formatTimestamp(market.universeForkTime))}</dd>
							</div>
							{market.questionOutcome === 3 ? null : (
								<div>
									<dt>{liveCopy.outcome}</dt>
									<dd>{questionOutcomeLabel(market.questionOutcome)}</dd>
								</div>
							)}
							<div>
								<dt>{liveCopy.securityMultiplier}</dt>
								<dd>{formatBpsMultiplier(market.statoblastSecurityMultiplierBps)}</dd>
							</div>
							<div>
								<dt>{liveCopy.initialReportPriorityFee}</dt>
								<dd>{liveCopy.priorityFeePerGas(formatUnits(market.initialReportPriorityFeeAttoEthPerGas, 9))}</dd>
							</div>
							<div>
								<dt>{liveCopy.registeredVaults}</dt>
								<dd>{market.vaultCount.toString()}</dd>
							</div>
							<div>
								<dt>{liveCopy.perSecondRetentionMultiplier}</dt>
								<dd>{formatUnits(market.currentRetentionRate, 18, 12)}×</dd>
							</div>
							<div>
								<dt>{liveCopy.totalAndFeeEligibleCapacityOwnership}</dt>
								<dd>{formatCapacityOwnership(market.totalCapacityOwnershipAttoRep, market.feeEligibleCapacityOwnershipAttoRep)}</dd>
							</div>
							<div>
								<dt>{liveCopy.mintingCapacity}</dt>
								<dd>{formatMintingCapacity(market.settlementCollateralAttoEth, market.mintingCapacityCeilingAttoEth)}</dd>
							</div>
						</dl>
						{market.pair === undefined ? (
							<PairInitializationAction market={market} nowSeconds={nowSeconds} />
						) : (
							<a class='primary-action' href={getTradingRouteHref(`#/market/${market.pool}`)}>
								{liveCopy.tradePool}
							</a>
						)}
					</>
				) : (
					<dl class='fact-list'>
						<SecurityPoolIdentityRows market={market} />
					</dl>
				)}
			</section>
		</main>
	)
}

export function SecurityPoolRouteEmptyState({ discoveryState, discoveryError, workflowLocked, retry }: { discoveryState: 'loading' | 'ready' | 'error'; discoveryError: string | undefined; workflowLocked: boolean; retry(): void }) {
	if (discoveryState === 'loading') return <p role='status'>{liveCopy.loadingSecurityPoolDetails}</p>
	if (discoveryState === 'error')
		return (
			<>
				<p class='error' role='alert'>
					{liveCopy.securityPoolDiscoveryFailed(discoveryError ?? liveCopy.unknownDiscovery)}
				</p>
				<button class='secondary-action' disabled={workflowLocked} onClick={retry}>
					{liveCopy.retryDiscovery}
				</button>
			</>
		)
	return (
		<p class='error' role='alert'>
			{liveCopy.securityPoolUnavailableInUniverse}
		</p>
	)
}

export function LiveTrading({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
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
	onUniversesChange?(universeIds: readonly bigint[], selectedUniverseId: bigint | undefined): void
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
		onUniversesChange,
		onWorkflowLockChange,
		onWalletSummaryChange,
		walletSummaryRetryNonce,
		defaultSlippage: DEFAULT_SLIPPAGE_PERCENT,
		defaultValidityMinutes: DEFAULT_TRANSACTION_VALIDITY_MINUTES,
		refreshIntervalMilliseconds,
		services: controllerServices,
	})
	const { account, walletClient, connect, connectionMessage, refreshWalletSummaryAfterReceipt, executeWithCurrentWalletContext, createGuardedWalletWrite } = wallet
	const { balanceError, portfolioBalanceState, portfolioBalanceError, visiblePortfolioEntries, selectedBalances, selectedBalanceState, retryBalances, retryPortfolioBalances } = balances
	const { visibleMarkets, listedMarkets, selected, selectedPairInitialized, routePool, discoveryState, discoveryError, marketPage, nowSeconds, refresh, refreshFromControl, loadMarketPage } = discovery
	const { parsedAmount, mode, setMode, side, setSide, amount, setAmount, slippage, setSlippage, transactionValidityMinutes, setTransactionValidityMinutes, quote, state, positionHash, message, positionReceiptWarning, simulate, submit } = position
	const { workflowLocked, updateLiquidityWorkflowLock } = workflow
	const workflowRoute = tradingWorkflowRoute(route)
	const creatingMarket = workflowRoute === 'create-market'
	const [createdMarketTitle, setCreatedMarketTitle] = useState<string>()
	useEffect(() => setCreatedMarketTitle(undefined), [route])
	const previousWalletConnectRequestNonce = useRef(walletConnectRequestNonce)
	useEffect(() => {
		if (walletConnectRequestNonce === undefined) return
		if (previousWalletConnectRequestNonce.current === walletConnectRequestNonce) return
		previousWalletConnectRequestNonce.current = walletConnectRequestNonce
		void connect()
	}, [connect, walletConnectRequestNonce])
	// A failed deployment lookup switches the application to the deployment setup route, which owns the
	// error surface, so this route only ever renders while the deployment is still resolving.
	if (configuration === undefined)
		return (
			<main class='route' id='main-content'>
				<RouteHeader eyebrow={appCopy.standaloneLiveClient} title={<span role='status'>{appCopy.loadingContracts}</span>} />
			</main>
		)
	const walletAction =
		walletConnectRequestNonce === undefined ? (
			<button class='wallet-button' disabled={workflowLocked} onClick={connect}>
				{account === undefined ? appCopy.connectWallet : shortAddress(account)}
			</button>
		) : undefined
	if (isTradingBrowseRoute(route))
		return (
			<LiveMarketBrowser
				route={route}
				markets={listedMarkets}
				pageMarketCount={visibleMarkets.length}
				discoveryState={discoveryState}
				discoveryError={discoveryError}
				marketPage={marketPage}
				workflowLocked={workflowLocked}
				nowSeconds={nowSeconds}
				connectionMessage={connectionMessage}
				retry={refreshFromControl}
				loadMarketPage={loadMarketPage}
			/>
		)
	if (routePool !== undefined && route.startsWith('security-pool/')) {
		if (selected !== undefined)
			return (
				<LiveSecurityPoolDetails market={selected} refreshError={discoveryState === 'error' ? (discoveryError ?? liveCopy.unknownDiscovery) : undefined} refreshing={discoveryState === 'loading'} retry={refreshFromControl} workflowLocked={workflowLocked} nowSeconds={nowSeconds} connectionMessage={connectionMessage} />
			)
		return (
			<main class='route' id='main-content'>
				<RouteHeader eyebrow={<a href={getTradingRouteHref('#/market')}>{liveCopy.backToMarket}</a>} title={appCopy.securityPool} />
				{connectionMessage === undefined ? null : (
					<p class='error' role='alert'>
						{connectionMessage}
					</p>
				)}
				<section class='section' aria-busy={discoveryState === 'loading'}>
					<SecurityPoolRouteEmptyState discoveryState={discoveryState} discoveryError={discoveryError} workflowLocked={workflowLocked} retry={refreshFromControl} />
				</section>
			</main>
		)
	}
	if (route === 'portfolio') {
		const subtitle = portfolioRouteSubtitle(configuration.chainName, getActiveSimulationController() !== undefined)
		return (
			<main class='route' id='main-content'>
				<RouteHeader eyebrow={appCopy.positionsByPool} title={appCopy.portfolio} description={subtitle} actions={walletAction} />
				{message === undefined ? null : (
					<p class='error' role='alert'>
						{message}
					</p>
				)}
				<section class='portfolio-section' aria-busy={discoveryState === 'loading'}>
					<div class='section-heading'>
						<h2>{liveCopy.positions}</h2>
					</div>
					{discoveryState === 'loading' && visibleMarkets.length === 0 ? <p role='status'>{liveCopy.discoveringSecurityPools}</p> : null}
					{discoveryState === 'error' ? (
						<p class='error' role='alert'>
							{liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)}
						</p>
					) : null}
					{discoveryState === 'ready' && visibleMarkets.length === 0 ? <p>{liveCopy.noSecurityPoolsInUniverse}</p> : null}
					{discoveryState === 'error' ? null : <LivePortfolio entries={visiblePortfolioEntries} balanceState={portfolioBalanceState} balanceError={portfolioBalanceError} retryBalances={retryPortfolioBalances} />}
				</section>
			</main>
		)
	}
	const routePresentation = liveWorkflowRoutePresentation(workflowRoute, configuration.chainName, getActiveSimulationController() !== undefined)
	// The position controls surface workflow messages beside their action; other addressed views keep them at the top.
	const positionControlsVisible = workflowRoute === 'market' && selected !== undefined && selected.loadError === undefined && selectedPairInitialized
	const routeMessage = connectionMessage ?? (positionControlsVisible ? undefined : message) ?? parsedAmount.error
	if (isTradingLookupRoute(route))
		return (
			<main class='route' id='main-content'>
				<RouteHeader title={routePresentation.title} description={routePresentation.description} actions={walletAction} />
				{connectionMessage === undefined ? null : (
					<p class='error' role='alert'>
						{connectionMessage}
					</p>
				)}
				<LiveMarketLookup route={route} disabled={workflowLocked} />
			</main>
		)
	return (
		<main class='route' id='main-content'>
			<RouteHeader title={routePresentation.title} description={routePresentation.description} actions={walletAction} />
			{routeMessage === undefined ? null : (
				<p class='error' role='alert'>
					{routeMessage}
				</p>
			)}
			{createdMarketTitle === undefined ? null : (
				<p role='status'>
					{liveCopy.marketCreated(createdMarketTitle)} <a href={getTradingRouteHref(routePool === undefined ? '#/liquidity' : `#/liquidity/${routePool}`)}>{appCopy.liquidity}</a>
				</p>
			)}
			{selected !== undefined && discoveryState === 'error' ? (
				<p class='error' role='alert'>
					{liveCopy.securityPoolRefreshFailed(discoveryError ?? liveCopy.unknownDiscovery)}
				</p>
			) : null}
			<div class='market-stack'>
				{selected === undefined ? (
					<section class='section' aria-busy={discoveryState === 'loading'}>
						<SecurityPoolRouteEmptyState discoveryState={discoveryState} discoveryError={discoveryError} workflowLocked={workflowLocked} retry={refreshFromControl} />
					</section>
				) : null}
				{(() => {
					if (selected === undefined) return null
					if (creatingMarket && selected.pair !== undefined)
						return (
							<p>
								{liveCopy.poolAlreadyExists} <a href={getTradingRouteHref(`#/liquidity/${selected.pool}`)}>{appCopy.liquidity}</a>
							</p>
						)
					if (selected.loadError !== undefined)
						return (
							<section class='section' key={selected.pool}>
								<div class='section-heading'>
									<div>
										<span class='section-kicker'>{creatingMarket ? liveCopy.securityPool : appCopy.market}</span>
										<h2>{selected.title}</h2>
									</div>
									<Status tone='warn'>{liveCopy.marketDataUnavailable}</Status>
								</div>
								<p class='error' role='alert'>
									{liveCopy.securityPoolCouldNotLoad(selected.loadError)}
								</p>
								<dl class='fact-list'>
									<div>
										<dt>{liveCopy.securityPoolLabel}</dt>
										<dd>
											<SecurityPoolAddressLink value={selected.pool} disabled={workflowLocked} />
										</dd>
									</div>
								</dl>
							</section>
						)
					return (
						<section class='section' key={selected.pool}>
							<div class='section-heading'>
								<div>
									<span class='section-kicker'>{creatingMarket ? liveCopy.securityPool : appCopy.market}</span>
									<h2>{selected.title}</h2>
								</div>
								{creatingMarket ? null : <Status tone={marketAcceptsNewRisk(selected, nowSeconds) ? 'good' : 'warn'}>{marketStatusLabel(selected, nowSeconds)}</Status>}
							</div>
							{workflowRoute !== 'liquidity' && !creatingMarket && !selectedPairInitialized ? <PairInitializationAction market={selected} nowSeconds={nowSeconds} /> : null}
							<dl class='fact-list'>
								<div>
									<dt>{liveCopy.securityPoolLabel}</dt>
									<dd>
										<SecurityPoolAddressLink value={selected.pool} disabled={workflowLocked} />
									</dd>
								</div>
								<div>
									<dt>{liveCopy.pair}</dt>
									<dd>{selected.pair === undefined ? liveCopy.notDeployed : <TradingAddressValue value={selected.pair} />}</dd>
								</div>
								<div>
									<dt>{liveCopy.questionEnd}</dt>
									<dd>{formatTimestamp(selected.endTime)}</dd>
								</div>
								<div>
									<dt>{liveCopy.ammFee}</dt>
									<dd>{formatUnits(selected.feeBps, 2, 2)}%</dd>
								</div>
							</dl>
							{workflowRoute === 'liquidity' || creatingMarket || marketAcceptsNewRisk(selected, nowSeconds) ? null : (
								<LiveSettlementControls
									configuration={configuration}
									market={selected}
									balances={selectedBalances}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									account={account}
									walletClient={walletClient}
									externallyLocked={workflowLocked}
									refresh={() => refresh(configuration, marketPage.start, 'liquidity')}
									onKnownReceipt={refreshWalletSummaryAfterReceipt}
									executeWithCurrentWalletContext={executeWithCurrentWalletContext}
									createGuardedWalletWrite={createGuardedWalletWrite}
									retryBalances={retryBalances}
									onWorkflowLockChange={updateLiquidityWorkflowLock}
									services={settlementServices}
								/>
							)}
							{workflowRoute === 'liquidity' || creatingMarket ? (
								<LiveLiquidityControls
									configuration={configuration}
									market={selected}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									account={account}
									walletClient={walletClient}
									externallyLocked={workflowLocked}
									nowSeconds={nowSeconds}
									refresh={async () => {
										await refresh(configuration, marketPage.start, 'liquidity')
										if (creatingMarket) setCreatedMarketTitle(selected.title)
									}}
									onKnownReceipt={refreshWalletSummaryAfterReceipt}
									executeWithCurrentWalletContext={executeWithCurrentWalletContext}
									createGuardedWalletWrite={createGuardedWalletWrite}
									retryBalances={retryBalances}
									onWorkflowLockChange={updateLiquidityWorkflowLock}
									services={liquidityServices}
								/>
							) : null}
							{workflowRoute !== 'liquidity' && !creatingMarket && selectedPairInitialized ? (
								<LivePositionControls
									market={selected}
									balances={selectedBalances}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									mode={mode}
									side={side}
									amount={amount}
									slippage={slippage}
									transactionValidityMinutes={transactionValidityMinutes}
									quote={quote}
									state={state}
									message={message}
									receiptWarning={positionReceiptWarning}
									transactionHash={positionHash}
									externallyLocked={workflowLocked}
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
						</section>
					)
				})()}
			</div>
		</main>
	)
}
