import { BackingDetails } from './BackingDetails.js'
import { formatBpsMultiplier, formatCapacityOwnership, formatMintingCapacity, formatUnits } from '../lib/format.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { formatTimestamp } from './LiveTradingTransactionUi.js'
import { SecurityPoolIdentityFields } from './LiveMarketIdentity.js'
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
			<div class='pair-initialization'>
				<p class='detail'>{liveCopy.conditionalPriceUnavailable}</p>
				<div class='actions'>
					<button class='primary' type='button' disabled>
						{liveCopy.pairInitializationUnavailable(blocker)}
					</button>
				</div>
			</div>
		)
	return (
		<div class='pair-initialization'>
			<p class='detail'>{market.pair === undefined ? liveCopy.undeployedPairDescription(formatUnits(market.feeBps, 2, 2)) : liveCopy.uninitializedPairDescription(formatUnits(market.feeBps, 2, 2))}</p>
			<div class='actions'>
				<a class='button-link primary' href={getTradingRouteHref(`#/${market.pair === undefined ? 'create-market' : 'liquidity'}/${market.pool}`)}>
					{market.pair === undefined ? liveCopy.deployTradingPool : liveCopy.initializeTradingPool}
				</a>
			</div>
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
	// Return to the list that includes this pool: markets once a pair exists, otherwise SecurityPools awaiting one.
	const browseBack = market.pair === undefined ? { href: '#/security-pools', label: liveCopy.browseSecurityPools } : { href: '#/markets', label: liveCopy.browseMarkets }
	return (
		<div class='route'>
			<RouteHeader
				eyebrow={appCopy.securityPool}
				title={market.title}
				description={appCopy.securityPoolRouteDescription}
				badge={market.loadError === undefined ? undefined : <Badge tone='warning'>{appCopy.poolDataUnavailable}</Badge>}
				actions={
					<a class='button-link' href={getTradingRouteHref(browseBack.href)}>
						{browseBack.label}
					</a>
				}
			/>
			<ErrorNotice message={connectionMessage} />
			<SectionBlock title={liveCopy.marketFacts}>
				<div class='security-pool-details' aria-busy={refreshing}>
					{refreshMessage === undefined ? null : (
						<p class='detail' role='status'>
							{refreshMessage}
						</p>
					)}
					<ErrorNotice message={errorMessage} />
					{errorMessage !== undefined && !refreshing ? (
						<div class='actions'>
							<button class='secondary' type='button' disabled={workflowLocked} onClick={retry}>
								{hasLoadedDetails ? liveCopy.retryRefresh : liveCopy.retrySecurityPool}
							</button>
						</div>
					) : null}
					<DataGrid dense>
						<SecurityPoolIdentityFields market={market} />
					</DataGrid>
					{market.loadError === undefined ? (
						<>
							<WorkflowSubsection title={liveCopy.lifecycle}>
								<DataGrid dense>
									<MetricField label={liveCopy.questionEnd}>{formatTimestamp(market.endTime)}</MetricField>
									<MetricField label={liveCopy.systemState}>{systemStateLabel(market.systemState)}</MetricField>
									<MetricField label={liveCopy.universeFork}>{market.universeForkTime === 0n ? liveCopy.notForked : liveCopy.forkedAt(formatTimestamp(market.universeForkTime))}</MetricField>
									{market.questionOutcome === 3 ? undefined : <MetricField label={liveCopy.outcome}>{questionOutcomeLabel(market.questionOutcome)}</MetricField>}
								</DataGrid>
							</WorkflowSubsection>
							<WorkflowSubsection title={liveCopy.capacity}>
								<DataGrid dense>
									<MetricField label={liveCopy.securityMultiplier}>{formatBpsMultiplier(market.statoblastSecurityMultiplierBps)}</MetricField>
									<MetricField label={liveCopy.initialReportPriorityFee}>{liveCopy.priorityFeePerGas(formatUnits(market.initialReportPriorityFeeAttoEthPerGas, 9))}</MetricField>
									<MetricField label={liveCopy.registeredVaults}>{market.vaultCount.toString()}</MetricField>
									<MetricField label={liveCopy.perSecondRetentionMultiplier}>{formatUnits(market.currentRetentionRate, 18, 12)}×</MetricField>
									<MetricField label={liveCopy.totalAndFeeEligibleCapacityOwnership}>{formatCapacityOwnership(market.totalCapacityOwnershipAttoRep, market.feeEligibleCapacityOwnershipAttoRep)}</MetricField>
									<MetricField label={liveCopy.mintingCapacity}>{formatMintingCapacity(market.settlementCollateralAttoEth, market.mintingCapacityCeilingAttoEth)}</MetricField>
								</DataGrid>
							</WorkflowSubsection>
							<BackingDetails market={market} />
							{market.pair === undefined ? (
								<PairInitializationAction market={market} nowSeconds={nowSeconds} />
							) : (
								<div class='actions'>
									<a class='button-link primary' href={getTradingRouteHref(`#/market/${market.pool}`)}>
										{liveCopy.tradePool}
									</a>
								</div>
							)}
						</>
					) : null}
				</div>
			</SectionBlock>
		</div>
	)
}

export function SecurityPoolRouteEmptyState({ discoveryState, discoveryError, workflowLocked, retry }: { discoveryState: 'loading' | 'ready' | 'error'; discoveryError: string | undefined; workflowLocked: boolean; retry(): void }) {
	if (discoveryState === 'loading') return <EmptyState live title={liveCopy.loadingSecurityPoolDetails} />
	if (discoveryState === 'error')
		return (
			<>
				<ErrorNotice message={liveCopy.securityPoolDiscoveryFailed(discoveryError ?? liveCopy.unknownDiscovery)} />
				<div class='actions'>
					<button class='secondary' type='button' disabled={workflowLocked} onClick={retry}>
						{liveCopy.retryDiscovery}
					</button>
				</div>
			</>
		)
	return <EmptyState title={liveCopy.noPoolSelected} detail={liveCopy.securityPoolUnavailableInUniverse} />
}
