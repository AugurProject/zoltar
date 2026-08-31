import { useEffect, useRef } from 'preact/hooks'
import { formatBpsMultiplier, formatCapacityOwnership, formatEthPerShare, formatMintingCapacity, formatUnits, shortAddress } from '../lib/format.js'
import { Status } from '../components/Status.js'
import { SecurityPoolAddressLink, TradingAddressValue } from '../components/TradingAddress.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, shareBalanceScope, type LiveMarket } from '../protocol/live.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import * as commonCopy from '../copy/common.js'
import * as appCopy from '../copy/app.js'
import * as liquidityCopy from '../copy/liquidity.js'
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

const ignoreWalletSummaryChange = () => undefined

export function marketRouteSubtitle(chainName: string, simulationActive: boolean) {
	return simulationActive ? commonCopy.conditionalPricesOnly : commonCopy.formatNetworkConditionalPrices(chainName)
}

export function liveWorkflowRoutePresentation(route: TradingRoute, chainName: string, simulationActive: boolean) {
	if (route === 'liquidity') return { description: liquidityCopy.routeDescription, title: appCopy.liquidity }
	return { description: marketRouteSubtitle(chainName, simulationActive), title: appCopy.markets }
}

export function portfolioRouteSubtitle(chainName: string, simulationActive: boolean) {
	return simulationActive ? undefined : chainName
}

function statusLabel(market: LiveMarket, nowSeconds: bigint) {
	if (market.loadError !== undefined) return 'Market data unavailable'
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return 'Pair not created'
	return livePairInitialized(market) ? 'Trading open' : 'Pair uninitialized'
}

function systemStateLabel(state: number) {
	if (state === 0) return 'Operational'
	if (state === 1) return 'Pool forked'
	if (state === 2) return 'Fork migration'
	if (state === 3) return 'Fork truth auction'
	return `Unknown state ${state}`
}

function questionOutcomeLabel(outcome: number) {
	if (outcome === 0) return 'INVALID'
	if (outcome === 1) return 'YES'
	if (outcome === 2) return 'NO'
	if (outcome === 3) return 'None (unresolved)'
	return `Unknown outcome ${outcome}`
}

function SecurityPoolIdentityRows({ market }: { market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId' | 'questionId'> }) {
	const scope = shareBalanceScope(market)
	return (
		<>
			<div>
				<dt>Security pool address</dt>
				<dd>
					<TradingAddressValue value={scope.pool} />
				</dd>
			</div>
			<div>
				<dt>Share token address</dt>
				<dd>
					<TradingAddressValue value={scope.shareToken} />
				</dd>
			</div>
			<div>
				<dt>Question ID</dt>
				<dd>{market.questionId.toString()}</dd>
			</div>
			<div>
				<dt>Outcome token IDs</dt>
				<dd>
					INVALID {scope.invalidTokenId.toString()} · YES {scope.yesTokenId.toString()} · NO {scope.noTokenId.toString()}
				</dd>
			</div>
		</>
	)
}

export function PairInitializationAction({ market, nowSeconds, onSelect = () => undefined }: { market: LiveMarket; nowSeconds: bigint; onSelect?(market: LiveMarket): void }) {
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined)
		return (
			<div class='operation-block'>
				<p>Conditional price unavailable until initialization.</p>
				<button class='primary-action' disabled>
					{blocker} — pair initialization unavailable
				</button>
			</div>
		)
	return (
		<div class='operation-block'>
			<p>
				{market.pair === undefined
					? `This SecurityPool is available to browse, but it does not have a trading pool yet. Deployment is combined with the initial liquidity transaction. Trading fee: ${formatUnits(market.feeBps, 2, 2)}%.`
					: `The trading pool exists but needs initial liquidity before trading can open. Trading fee: ${formatUnits(market.feeBps, 2, 2)}%.`}
			</p>
			<a class='primary-action' href={getTradingRouteHref('#/liquidity')} onClick={() => onSelect(market)}>
				{market.pair === undefined ? 'Deploy trading pool' : 'Initialize trading pool'}
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
	if (refreshing) refreshMessage = hasLoadedDetails ? 'Refreshing security pool; showing the last successful result.' : 'Retrying security pool details…'
	let errorMessage: string | undefined
	if (market.loadError !== undefined) errorMessage = refreshError === undefined ? `Security pool details could not be loaded: ${market.loadError}` : `Security pool details could not be loaded: ${market.loadError}. Latest retry failed: ${refreshError}`
	else if (refreshError !== undefined) errorMessage = `SecurityPool refresh failed; showing the last successful result: ${refreshError}`
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
								{hasLoadedDetails ? 'Retry refresh' : 'Retry security pool'}
							</button>
						)}
					</>
				)}
				{market.loadError === undefined ? (
					<>
						<dl class='fact-list'>
							<SecurityPoolIdentityRows market={market} />
							<div>
								<dt>Question end</dt>
								<dd>{formatTimestamp(market.endTime)}</dd>
							</div>
							<div>
								<dt>System state</dt>
								<dd>{systemStateLabel(market.systemState)}</dd>
							</div>
							<div>
								<dt>Universe fork</dt>
								<dd>{market.universeForkTime === 0n ? 'Not forked' : `Forked ${formatTimestamp(market.universeForkTime)}`}</dd>
							</div>
							{market.questionOutcome === 3 ? null : (
								<div>
									<dt>Outcome</dt>
									<dd>{questionOutcomeLabel(market.questionOutcome)}</dd>
								</div>
							)}
							<div>
								<dt>Security multiplier</dt>
								<dd>{formatBpsMultiplier(market.statoblastSecurityMultiplierBps)}</dd>
							</div>
							<div>
								<dt>Initial report priority fee</dt>
								<dd>{formatUnits(market.initialReportPriorityFeeAttoEthPerGas, 9)} nETH / gas</dd>
							</div>
							<div>
								<dt>Registered vaults</dt>
								<dd>{market.vaultCount.toString()}</dd>
							</div>
							<div>
								<dt>Per-second retention multiplier</dt>
								<dd>{formatUnits(market.currentRetentionRate, 18, 12)}×</dd>
							</div>
							<div>
								<dt>Total / fee-eligible capacity ownership</dt>
								<dd>{formatCapacityOwnership(market.totalCapacityOwnershipAttoRep, market.feeEligibleCapacityOwnershipAttoRep)}</dd>
							</div>
							<div>
								<dt>Minting capacity</dt>
								<dd>{formatMintingCapacity(market.settlementCollateralAttoEth, market.mintingCapacityCeilingAttoEth)}</dd>
							</div>
							<div>
								<dt>Checkpointed collateral / share ratio</dt>
								<dd>{market.shareTokenSupplyAttoShares === 0n ? 'No complete sets yet' : formatEthPerShare(market.settlementCollateralAttoEth, market.shareTokenSupplyAttoShares)}</dd>
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
	if (discoveryState === 'loading') return <p role='status'>Loading security pool details…</p>
	if (discoveryState === 'error')
		return (
			<>
				<p class='error' role='alert'>
					Security pool discovery failed: {discoveryError ?? 'unknown discovery error'}
				</p>
				<button class='secondary-action' disabled={workflowLocked} onClick={retry}>
					Retry discovery
				</button>
			</>
		)
	return (
		<p class='error' role='alert'>
			This security pool is not available in the selected universe.
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
	const { account, walletClient, connect, connectionMessage, refreshWalletSummaryAfterReceipt, walletContextIsCurrent, executeWithCurrentWalletContext, createGuardedWalletWrite } = wallet
	const { balanceError, portfolioBalanceState, portfolioBalanceError, visiblePortfolioEntries, selectedBalances, selectedBalanceState, retryBalances, retryPortfolioBalances, refreshBalancesAfterApproval } = balances
	const { visibleMarkets, selected, selectedPairInitialized, routePool, discoveryState, discoveryError, marketPage, marketListRef, marketDetailRef, nowSeconds, refresh, refreshFromControl, loadMarketPage, focusSection, selectMarket } = discovery
	const { parsedAmount, mode, setMode, side, setSide, amount, setAmount, slippage, setSlippage, transactionValidityMinutes, setTransactionValidityMinutes, quote, state, positionHash, message, positionReceiptWarning, simulate, approve, submit } = position
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
								Retry deployment
							</button>
						)
					}
				/>
			</main>
		)
	let discoveryContent
	if (discoveryState === 'loading' && visibleMarkets.length === 0) discoveryContent = <p role='status'>Discovering SecurityPools from the configured factory…</p>
	else if (discoveryState === 'error' && visibleMarkets.length === 0)
		discoveryContent = (
			<div>
				<p class='error' role='alert'>
					SecurityPool discovery failed: {discoveryError}
				</p>
				<button class='secondary-action' disabled={workflowLocked} onClick={refreshFromControl}>
					Retry discovery
				</button>
			</div>
		)
	else if (visibleMarkets.length === 0) discoveryContent = <p>No SecurityPools are deployed in the selected universe.</p>
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
						SecurityPool refresh failed; showing the last successful result: {discoveryError}
					</p>
					<button class='secondary-action' disabled={workflowLocked} onClick={refreshFromControl}>
						Retry discovery
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
					refreshError={discoveryState === 'error' ? (discoveryError ?? 'unknown discovery error') : undefined}
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
						<h2>Positions</h2>
						<button class='secondary-action' disabled={discoveryState === 'loading' || workflowLocked} onClick={refreshFromControl}>
							Refresh
						</button>
					</div>
					{discoveryState === 'loading' && visibleMarkets.length === 0 ? <p role='status'>Discovering SecurityPools…</p> : null}
					{discoveryState === 'error' ? (
						<p class='error' role='alert'>
							SecurityPool discovery failed: {discoveryError}
						</p>
					) : null}
					{discoveryState === 'ready' && visibleMarkets.length === 0 ? <p>No SecurityPools are deployed in the selected universe.</p> : null}
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
			{message === undefined && parsedAmount.error === undefined ? null : (
				<p class='error' role='alert'>
					{message ?? parsedAmount.error}
				</p>
			)}
			<div class={selected === undefined ? 'two-column two-column--single' : 'two-column'}>
				<section class='section live-focus-target' id='security-pool-list' ref={marketListRef} tabIndex={-1} aria-busy={discoveryState === 'loading'}>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>Factory discovery</span>
							<h2>SecurityPools</h2>
						</div>
						<button class='secondary-action' disabled={discoveryState === 'loading' || workflowLocked} onClick={refreshFromControl}>
							Refresh
						</button>
					</div>
					{discoveryContent}
					{marketPage.total === 0n ? null : (
						<nav class='market-pagination' aria-label='SecurityPool pages'>
							<button class='secondary-action' disabled={marketPage.previousStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.previousStart)}>
								Previous pools
							</button>
							<span>
								{(marketPage.start + 1n).toString()}–{(marketPage.start + BigInt(visibleMarkets.length)).toString()} of {marketPage.total.toString()}
							</span>
							<button class='secondary-action' disabled={marketPage.nextStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.nextStart)}>
								Next pools
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
									Back to SecurityPools
								</button>
								<div class='section-heading'>
									<div>
										<span class='section-kicker'>SecurityPool</span>
										<h2>{selected.title}</h2>
									</div>
									<Status tone='warn'>Market data unavailable</Status>
								</div>
								<p class='error' role='alert'>
									This SecurityPool could not be loaded. No trading, liquidity, or settlement action is available until its authoritative reads succeed: {selected.loadError}
								</p>
								<dl class='fact-list'>
									<div>
										<dt>Security pool</dt>
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
								Back to SecurityPools
							</button>
							<div class='section-heading'>
								<div>
									<span class='section-kicker'>SecurityPool</span>
									<h2>{selected.title}</h2>
								</div>
								<Status tone={marketAcceptsNewRisk(selected, nowSeconds) ? 'good' : 'warn'}>{statusLabel(selected, nowSeconds)}</Status>
							</div>
							{route !== 'liquidity' && !selectedPairInitialized ? <PairInitializationAction market={selected} nowSeconds={nowSeconds} onSelect={selectMarket} /> : null}
							<dl class='fact-list'>
								<div>
									<dt>Security pool</dt>
									<dd>
										<SecurityPoolAddressLink value={selected.pool} disabled={workflowLocked} />
									</dd>
								</div>
								<div>
									<dt>Pair</dt>
									<dd>{selected.pair === undefined ? appCopy.pairNotCreated : <TradingAddressValue value={selected.pair} />}</dd>
								</div>
								<div>
									<dt>Question end</dt>
									<dd>{formatTimestamp(selected.endTime)}</dd>
								</div>
								<div>
									<dt>AMM fee</dt>
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
									refreshBalancesAfterApproval={refreshBalancesAfterApproval}
									onKnownReceipt={refreshWalletSummaryAfterReceipt}
									walletContextIsCurrent={walletContextIsCurrent}
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
									balances={selectedBalances}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									account={account}
									walletClient={walletClient}
									externallyLocked={workflowLocked}
									nowSeconds={nowSeconds}
									refresh={() => refresh(configuration, marketPage.start, 'liquidity')}
									refreshBalancesAfterApproval={refreshBalancesAfterApproval}
									onKnownReceipt={refreshWalletSummaryAfterReceipt}
									walletContextIsCurrent={walletContextIsCurrent}
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
									approve={approve}
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
