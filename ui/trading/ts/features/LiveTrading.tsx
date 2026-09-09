import { useEffect, useRef } from 'preact/hooks'
import { formatBpsMultiplier, formatCapacityOwnership, formatEthPerShare, formatMintingCapacity, formatUnits, shortAddress } from '../lib/format.js'
import { Status } from '../components/Status.js'
import { SecurityPoolAddressLink, TradingAddressValue } from '../components/TradingAddress.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import * as appCopy from '../copy/app.js'
import { getTradingRouteHref, type TradingRoute } from '../lib/routing.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { useLiveTradingController } from './liveTradingController.js'
import { livePairInitialized, liveTradingControllerServices } from './liveTradingControllerHelpers.js'
import type { LiveTradingControllerServices } from './live/liveTradingTypes.js'
import { LivePortfolio } from './LivePortfolio.js'
import { LivePositionControls } from './LivePositionControls.js'
import { LiveLiquidityControls, liveLiquidityServices, type LiveLiquidityServices } from './LiveLiquidityControls.js'
import { LiveSettlementControls, liveSettlementServices, type LiveSettlementServices } from './LiveSettlementControls.js'
import { DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES, formatTimestamp } from './LiveTradingTransactionUi.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { liveWorkflowRoutePresentation, portfolioRouteSubtitle } from './live/routePresentation.js'
import { SecurityPoolIdentityRows } from './LiveMarketIdentity.js'
import { liveCopy } from '../copy/live.js'

export { liveWorkflowRoutePresentation, portfolioRouteSubtitle } from './live/routePresentation.js'

const ignoreWalletSummaryChange = () => undefined

function statusLabel(market: LiveMarket, nowSeconds: bigint) {
	if (market.loadError !== undefined) return liveCopy.marketDataUnavailable
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return liveCopy.pairNotCreated
	return livePairInitialized(market) ? liveCopy.tradingOpen : liveCopy.pairUninitialized
}

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

export function PairInitializationAction({ market, nowSeconds, onSelect = () => undefined }: { market: LiveMarket; nowSeconds: bigint; onSelect?(market: LiveMarket): void }) {
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
			<a class='primary-action' href={getTradingRouteHref('#/liquidity')} onClick={() => onSelect(market)}>
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
	onSelect = () => undefined,
}: {
	market: LiveMarket
	refreshError?: string | undefined
	refreshing?: boolean
	retry(): void
	workflowLocked: boolean
	nowSeconds: bigint
	connectionMessage?: string | undefined
	onSelect?(market: LiveMarket): void
}) {
	const hasLoadedDetails = market.loadError === undefined
	let refreshMessage: string | undefined
	if (refreshing) refreshMessage = hasLoadedDetails ? liveCopy.refreshingSecurityPool : liveCopy.retryingSecurityPoolDetails
	let errorMessage: string | undefined
	if (market.loadError !== undefined) errorMessage = liveCopy.securityPoolDetailsUnavailable(market.loadError, refreshError)
	else if (refreshError !== undefined) errorMessage = liveCopy.securityPoolRefreshFailed(refreshError)
	return (
		<main class='route' id='main-content'>
			<RouteHeader eyebrow={<a href={getTradingRouteHref('#/markets')}>{appCopy.backToMarkets}</a>} title={appCopy.securityPool} description={market.title} badge={market.loadError === undefined ? undefined : <Status tone='warn'>{appCopy.poolDataUnavailable}</Status>} />
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
							<div>
								<dt>{liveCopy.checkpointedCollateralShareRatio}</dt>
								<dd>{market.shareTokenSupplyAttoShares === 0n ? liveCopy.noCompleteSetsYet : formatEthPerShare(market.settlementCollateralAttoEth, market.shareTokenSupplyAttoShares)}</dd>
							</div>
						</dl>
						{market.pair === undefined ? <PairInitializationAction market={market} nowSeconds={nowSeconds} onSelect={onSelect} /> : null}
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
	onDeploymentRetry = () => undefined,
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
	onDeploymentRetry?(): void
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
		services: controllerServices,
	})
	const { account, walletClient, connect, connectionMessage, refreshWalletSummaryAfterReceipt, executeWithCurrentWalletContext, createGuardedWalletWrite } = wallet
	const { balanceError, portfolioBalanceState, portfolioBalanceError, visiblePortfolioEntries, selectedBalances, selectedBalanceState, retryBalances, retryPortfolioBalances } = balances
	const { visibleMarkets, selected, selectedPairInitialized, routePool, discoveryState, discoveryError, marketPage, marketListRef, marketDetailRef, nowSeconds, refresh, refreshFromControl, loadMarketPage, focusSection, selectMarket } = discovery
	const { parsedAmount, mode, setMode, side, setSide, amount, setAmount, slippage, setSlippage, transactionValidityMinutes, setTransactionValidityMinutes, quote, state, positionHash, message, positionReceiptWarning, simulate, submit } = position
	const { workflowLocked, updateLiquidityWorkflowLock } = workflow
	const previousWalletConnectRequestNonce = useRef(walletConnectRequestNonce)
	useEffect(() => {
		if (walletConnectRequestNonce === undefined) return
		if (previousWalletConnectRequestNonce.current === walletConnectRequestNonce) return
		previousWalletConnectRequestNonce.current = walletConnectRequestNonce
		void connect()
	}, [connect, walletConnectRequestNonce])
	if (configuration === undefined)
		return (
			<main class='route' id='main-content'>
				<RouteHeader
					eyebrow={appCopy.standaloneLiveClient}
					title={appCopy.contractsUnavailable}
					description={
						<span class={configurationError === undefined ? undefined : 'error'} role={configurationError === undefined ? 'status' : 'alert'}>
							{configurationError ?? message ?? appCopy.checkingContracts}
						</span>
					}
					actions={
						configurationError === undefined ? undefined : (
							<button class='secondary-action' type='button' onClick={onDeploymentRetry}>
								{liveCopy.retryDeployment}
							</button>
						)
					}
				/>
			</main>
		)
	let discoveryContent
	if (discoveryState === 'loading' && visibleMarkets.length === 0) discoveryContent = <p role='status'>{liveCopy.discoveringSecurityPoolsFromFactory}</p>
	else if (discoveryState === 'error' && visibleMarkets.length === 0)
		discoveryContent = (
			<div>
				<p class='error' role='alert'>
					{liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)}
				</p>
				<button class='secondary-action' disabled={workflowLocked} onClick={refreshFromControl}>
					{liveCopy.retryDiscovery}
				</button>
			</div>
		)
	else if (visibleMarkets.length === 0) discoveryContent = <p>{liveCopy.noSecurityPoolsInUniverse}</p>
	else {
		const marketButtons = visibleMarkets.map(market => (
			<button key={market.pool} class='live-market-button' aria-pressed={selected?.pool === market.pool} disabled={workflowLocked} onClick={() => selectMarket(market)}>
				<strong>{market.title}</strong>
				<span>{statusLabel(market, nowSeconds)}</span>
			</button>
		))
		discoveryContent =
			discoveryState === 'error' ? (
				<div>
					<p class='error' role='alert'>
						{discoveryError === undefined ? undefined : liveCopy.securityPoolRefreshFailed(discoveryError)}
					</p>
					<button class='secondary-action' disabled={workflowLocked} onClick={refreshFromControl}>
						{liveCopy.retryDiscovery}
					</button>
					{marketButtons}
				</div>
			) : (
				marketButtons
			)
	}
	if (routePool !== undefined) {
		if (selected !== undefined)
			return (
				<LiveSecurityPoolDetails
					market={selected}
					refreshError={discoveryState === 'error' ? (discoveryError ?? liveCopy.unknownDiscovery) : undefined}
					refreshing={discoveryState === 'loading'}
					retry={refreshFromControl}
					workflowLocked={workflowLocked}
					nowSeconds={nowSeconds}
					connectionMessage={connectionMessage}
					onSelect={selectMarket}
				/>
			)
		return (
			<main class='route' id='main-content'>
				<RouteHeader eyebrow={<a href={getTradingRouteHref('#/markets')}>{appCopy.backToMarkets}</a>} title={appCopy.securityPool} />
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
				<RouteHeader
					eyebrow={appCopy.positionsByPool}
					title={appCopy.portfolio}
					description={subtitle}
					actions={
						walletConnectRequestNonce === undefined ? (
							<button class='wallet-button' disabled={workflowLocked} onClick={connect}>
								{account === undefined ? appCopy.connectWallet : shortAddress(account)}
							</button>
						) : undefined
					}
				/>
				{message === undefined ? null : (
					<p class='error' role='alert'>
						{message}
					</p>
				)}
				<section class='portfolio-section' aria-busy={discoveryState === 'loading'}>
					<div class='section-heading'>
						<h2>{liveCopy.positions}</h2>
						<button class='secondary-action' disabled={discoveryState === 'loading' || workflowLocked} onClick={refreshFromControl}>
							{liveCopy.refresh}
						</button>
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
	const routePresentation = liveWorkflowRoutePresentation(route, configuration.chainName, getActiveSimulationController() !== undefined)
	return (
		<main class='route' id='main-content'>
			<RouteHeader
				title={routePresentation.title}
				description={routePresentation.description}
				actions={
					walletConnectRequestNonce === undefined ? (
						<button class='wallet-button' disabled={workflowLocked} onClick={connect}>
							{account === undefined ? appCopy.connectWallet : shortAddress(account)}
						</button>
					) : undefined
				}
			/>
			{connectionMessage === undefined && message === undefined && parsedAmount.error === undefined ? null : (
				<p class='error' role='alert'>
					{connectionMessage ?? message ?? parsedAmount.error}
				</p>
			)}
			<div class='market-stack'>
				<section class='market-list live-focus-target' id='security-pool-list' ref={marketListRef} tabIndex={-1} aria-busy={discoveryState === 'loading'}>
					<div class='section-heading'>
						<h2>{liveCopy.securityPools}</h2>
						<button class='secondary-action' disabled={discoveryState === 'loading' || workflowLocked} onClick={refreshFromControl}>
							{liveCopy.refresh}
						</button>
					</div>
					{discoveryContent}
					{marketPage.total === 0n ? null : (
						<nav class='market-pagination' aria-label={liveCopy.securityPoolPages}>
							<button class='secondary-action' disabled={marketPage.previousStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.previousStart)}>
								{liveCopy.previousPools}
							</button>
							<span>{liveCopy.poolPageRange(marketPage.start + 1n, marketPage.start + BigInt(visibleMarkets.length), marketPage.total)}</span>
							<button class='secondary-action' disabled={marketPage.nextStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.nextStart)}>
								{liveCopy.nextPools}
							</button>
						</nav>
					)}
				</section>
				{(() => {
					if (selected === undefined) return null
					if (selected.loadError !== undefined)
						return (
							<section class='section live-focus-target' key={selected.pool} ref={marketDetailRef} tabIndex={-1}>
								<button class='secondary-action mobile-return' onClick={() => focusSection(marketListRef)}>
									{liveCopy.backToSecurityPools}
								</button>
								<div class='section-heading'>
									<div>
										<span class='section-kicker'>{liveCopy.securityPool}</span>
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
						<section class='section live-focus-target' key={selected.pool} ref={marketDetailRef} tabIndex={-1}>
							<button class='secondary-action mobile-return' onClick={() => focusSection(marketListRef)}>
								{liveCopy.backToSecurityPools}
							</button>
							<div class='section-heading'>
								<div>
									<span class='section-kicker'>{liveCopy.securityPool}</span>
									<h2>{selected.title}</h2>
								</div>
								<Status tone={marketAcceptsNewRisk(selected, nowSeconds) ? 'good' : 'warn'}>{statusLabel(selected, nowSeconds)}</Status>
							</div>
							{route !== 'liquidity' && !selectedPairInitialized ? <PairInitializationAction market={selected} nowSeconds={nowSeconds} onSelect={selectMarket} /> : null}
							<dl class='fact-list'>
								<div>
									<dt>{liveCopy.securityPoolLabel}</dt>
									<dd>
										<SecurityPoolAddressLink value={selected.pool} disabled={workflowLocked} />
									</dd>
								</div>
								<div>
									<dt>{liveCopy.pair}</dt>
									<dd>{selected.pair === undefined ? appCopy.pairNotCreated : <TradingAddressValue value={selected.pair} />}</dd>
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
							{route === 'liquidity' || marketAcceptsNewRisk(selected, nowSeconds) ? null : (
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
							{route === 'liquidity' ? (
								<LiveLiquidityControls
									configuration={configuration}
									market={selected}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									account={account}
									walletClient={walletClient}
									externallyLocked={workflowLocked}
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
							{route !== 'liquidity' && selectedPairInitialized ? (
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
