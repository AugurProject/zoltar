import { formatBpsMultiplier, formatCapacityOwnership, formatMintingCapacity, formatUnits } from '../lib/format.js'
import { Status } from '../components/Status.js'
import { marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { formatTimestamp } from './LiveTradingTransactionUi.js'
import { SecurityPoolIdentityRows } from './LiveMarketIdentity.js'
import { liveCopy } from '../copy/live.js'

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
