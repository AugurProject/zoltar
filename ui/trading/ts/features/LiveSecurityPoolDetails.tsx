import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { BackingDetails } from './BackingDetails.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatBpsMultiplier, formatMintingCapacity } from '../lib/format.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SecurityPoolIdentityFields } from './LiveMarketIdentity.js'
import { liveCopy } from '../copy/live.js'
import { questionOutcomeLabel, systemStateLabel } from '../lib/marketLabels.js'

export function PairInitializationAction({ market, nowSeconds }: { market: LiveMarket; nowSeconds: bigint }) {
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined)
		return (
			<div className='pair-initialization'>
				<p className='detail'>{liveCopy.conditionalPriceUnavailable}</p>
				<div className='actions'>
					<button className='primary' type='button' disabled>
						{liveCopy.pairInitializationUnavailable(blocker)}
					</button>
				</div>
			</div>
		)
	return (
		<div className='pair-initialization'>
			<p className='detail'>{market.pair === undefined ? liveCopy.undeployedPairDescription(formatTrimmedUnits(market.feeBps, 2, 2)) : liveCopy.uninitializedPairDescription(formatTrimmedUnits(market.feeBps, 2, 2))}</p>
			<div className='actions'>
				<a className='button-link primary' href={getTradingRouteHref(`#/${market.pair === undefined ? 'create-market' : 'liquidity'}/${market.pool}`)}>
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
	// Return to the landing whose list includes this pool: markets once a pair exists, otherwise market creation.
	const browseBack = market.pair === undefined ? { href: '#/create-market', label: appCopy.createMarket } : { href: '#/market', label: liveCopy.marketList }
	return (
		<div className='route-view-flow'>
			<RouteHeader
				eyebrow={appCopy.securityPool}
				title={market.title}
				badge={market.loadError === undefined ? undefined : <Badge tone='warning'>{appCopy.poolDataUnavailable}</Badge>}
				actions={
					<a className='button-link' href={getTradingRouteHref(browseBack.href)}>
						{browseBack.label}
					</a>
				}
			/>
			<ErrorNotice message={connectionMessage} />
			<SectionBlock title={liveCopy.marketFacts}>
				<div className='security-pool-details' aria-busy={refreshing}>
					{refreshMessage === undefined ? null : (
						<p className='detail' role='status'>
							{refreshMessage}
						</p>
					)}
					<ErrorNotice message={errorMessage} />
					{errorMessage !== undefined && !refreshing ? (
						<div className='actions'>
							<button className='secondary' type='button' disabled={workflowLocked} onClick={retry}>
								{hasLoadedDetails ? liveCopy.retryRefresh : liveCopy.retrySecurityPool}
							</button>
						</div>
					) : null}

					{market.loadError !== undefined ? (
						<ReadOnlyDetailAccordion title={liveCopy.poolDetails}>
							<DataGrid dense>
								<SecurityPoolIdentityFields market={market} />
							</DataGrid>
						</ReadOnlyDetailAccordion>
					) : (
						<>
							<div>
								<DataGrid dense>
									<MetricField label={liveCopy.questionEnd}>
										<TimestampValue timestamp={market.endTime} relative={false} />
									</MetricField>
									<MetricField label={liveCopy.systemState}>{systemStateLabel(market.systemState)}</MetricField>
									<MetricField label={liveCopy.universeFork}>
										{market.universeForkTime === 0n ? (
											liveCopy.notForked
										) : (
											<>
												{liveCopy.forkedAt} <TimestampValue timestamp={market.universeForkTime} relative={false} />
											</>
										)}
									</MetricField>
									{market.questionOutcome === 3 ? undefined : <MetricField label={liveCopy.outcome}>{questionOutcomeLabel(market.questionOutcome)}</MetricField>}
									<MetricField label={liveCopy.mintingCapacity}>{formatMintingCapacity(market.settlementCollateralAttoEth, market.mintingCapacityCeilingAttoEth)}</MetricField>
								</DataGrid>
							</div>
							{market.pair === undefined ? (
								<PairInitializationAction market={market} nowSeconds={nowSeconds} />
							) : (
								<div className='actions'>
									<a className='button-link primary' href={getTradingRouteHref(`#/market/${market.pool}`)}>
										{liveCopy.tradePool}
									</a>
								</div>
							)}
							<ReadOnlyDetailAccordion title={liveCopy.poolDetails}>
								<DataGrid dense>
									<SecurityPoolIdentityFields market={market} />
								</DataGrid>
							</ReadOnlyDetailAccordion>
							<ReadOnlyDetailAccordion title={liveCopy.capacity}>
								<DataGrid dense>
									<MetricField label={liveCopy.securityMultiplier}>{formatBpsMultiplier(market.statoblastSecurityMultiplierBps)}</MetricField>
									<MetricField label={liveCopy.initialReportPriorityFee}>{liveCopy.priorityFeePerGas(formatTrimmedUnits(market.initialReportPriorityFeeAttoEthPerGas, 9))}</MetricField>
									<MetricField label={liveCopy.registeredVaults}>{market.vaultCount.toString()}</MetricField>
									<MetricField label={liveCopy.perSecondRetentionMultiplier}>{formatTrimmedUnits(market.currentRetentionRate, 18, 12)}×</MetricField>
									<MetricField label={liveCopy.nominalCapacity}>
										{formatTrimmedUnits(market.totalCapacityOwnershipAttoRep)} {commonCopy.rep}
									</MetricField>
									<MetricField label={liveCopy.activeObligationUnits}>{market.activeObligationUnits.toString()}</MetricField>
								</DataGrid>
							</ReadOnlyDetailAccordion>
							<BackingDetails market={market} />
						</>
					)}
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
				<div className='actions'>
					<button className='secondary' type='button' disabled={workflowLocked} onClick={retry}>
						{liveCopy.retryDiscovery}
					</button>
				</div>
			</>
		)
	return <EmptyState title={liveCopy.noPoolSelected} detail={liveCopy.securityPoolUnavailableInUniverse} />
}
