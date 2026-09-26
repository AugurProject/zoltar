import type { Address } from '@zoltar/core-shared/evm/ethereum'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as portfolioCopy from '../../../copy/portfolio.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { POOLS_ROUTE_HASH } from '../../../lib/statoblastLocation.js'
import { PoolActionRow } from '../../security-pools/components/PoolStagePanel.js'
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js'
import { getSecurityPoolStatusBadgeLabel, getSecurityPoolStatusBadgeTone } from '../../security-pools/lib/securityPoolLabels.js'
import type { PortfolioLoadState } from '../hooks/usePortfolio.js'
import { derivePortfolioViewModel, type PortfolioHolding } from '../lib/portfolioViewModel.js'

export type PortfolioSectionProps = {
	accountAddress: Address | undefined
	currentTimestamp: bigint | undefined
	isConnectingWallet: boolean
	onConnect: () => void
	portfolio: PortfolioLoadState
	walletBootstrapComplete: boolean
}

function HoldingStatusBadge({ holding }: { holding: PortfolioHolding }) {
	const label = getSecurityPoolStatusBadgeLabel({ hasForkActivity: holding.pool.hasForkActivity, lifecycleState: holding.lifecycleState, questionOutcome: holding.pool.questionOutcome })
	return (
		<Badge ariaLabel={label} tone={getSecurityPoolStatusBadgeTone(holding.lifecycleState)}>
			{label}
		</Badge>
	)
}

function HoldingRecord({ holding }: { holding: PortfolioHolding }) {
	const { pool, shareBalances, vault } = holding
	const title = getQuestionTitle(pool.marketDetails)
	return (
		<article className='portfolio-holding'>
			<div className='portfolio-holding-identity'>
				<HoldingStatusBadge holding={holding} />
				<h4>{title}</h4>
				<p className='pool-directory-meta'>
					<AddressValue address={pool.securityPoolAddress} responsiveAbbreviation />
				</p>
			</div>
			<div className='portfolio-holding-metrics'>
				{vault === undefined ? undefined : (
					<>
						<MetricField label={portfolioCopy.vaultRep}>
							<CurrencyValue value={vault.repAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={portfolioCopy.claimableFees}>
							<CurrencyValue value={vault.claimableFeesAttoEth} suffix={commonCopy.eth} />
						</MetricField>
						{vault.disputeStakedAttoRep === 0n ? undefined : (
							<MetricField label={portfolioCopy.escalationStake}>
								<CurrencyValue value={vault.disputeStakedAttoRep} suffix={commonCopy.rep} />
							</MetricField>
						)}
					</>
				)}
				{shareBalances === undefined ? undefined : (
					<MetricField label={portfolioCopy.shares} valueTagName='span'>
						<span className='portfolio-share-balances'>
							<span>
								{portfolioCopy.yesShares} <CurrencyValue value={shareBalances.yesAttoShares} />
							</span>
							<span>
								{portfolioCopy.noShares} <CurrencyValue value={shareBalances.noAttoShares} />
							</span>
							<span>
								{portfolioCopy.invalidShares} <CurrencyValue value={shareBalances.invalidAttoShares} />
							</span>
						</span>
					</MetricField>
				)}
			</div>
			<SecurityPoolLink ariaLabel={securityPoolCopy.formatOpenPoolLabel(title, pool.securityPoolAddress)} className='button-link secondary-link pool-open-link' securityPoolAddress={pool.securityPoolAddress} selectedPoolView='' universeId={pool.universeId}>
				{securityPoolCopy.openPool}
			</SecurityPoolLink>
		</article>
	)
}

function PortfolioContent({ accountAddress, currentTimestamp, portfolio }: { accountAddress: Address; currentTimestamp: bigint | undefined; portfolio: PortfolioLoadState }) {
	if (portfolio.snapshots === undefined) {
		if (portfolio.error !== undefined)
			return (
				<SectionBlock variant='plain'>
					<ErrorNotice message={portfolio.error} />
					<div className='actions'>
						<button className='secondary' type='button' onClick={portfolio.onRetry}>
							{commonCopy.retry}
						</button>
					</div>
				</SectionBlock>
			)
		return (
			<p className='detail' role='status'>
				<LoadingText>{portfolioCopy.loadingPositions}</LoadingText>
			</p>
		)
	}
	const { actionEntries, holdings } = derivePortfolioViewModel({ accountAddress, now: currentTimestamp, snapshots: portfolio.snapshots })
	if (holdings.length === 0)
		return (
			<EmptyState
				actions={
					<a className='button-link' href={buildRouteHref(POOLS_ROUTE_HASH, getRouteHashSearch())}>
						{commonCopy.browsePoolsAction}
					</a>
				}
				detail={portfolioCopy.noPositionsDetail}
				title={portfolioCopy.noPositions}
			/>
		)
	return (
		<>
			{portfolio.error === undefined ? undefined : <ErrorNotice message={portfolio.error} />}
			<SectionBlock busy={portfolio.loading} className='portfolio-attention' description={actionEntries.length === 0 ? portfolioCopy.nothingNeedsAttention : undefined} title={portfolioCopy.needsAttention} variant='plain'>
				{actionEntries.length === 0 ? undefined : (
					<ul className='pool-action-list'>
						{actionEntries.map(({ holding, item }) => (
							<PoolActionRow
								context={getQuestionTitle(holding.pool.marketDetails)}
								control={
									<SecurityPoolLink className='button-link secondary-link' securityPoolAddress={holding.pool.securityPoolAddress} selectedPoolView={item.tab ?? ''} universeId={holding.pool.universeId}>
										{item.tab === undefined ? securityPoolCopy.openPool : workspaceCopy.actionButtonLabels[item.tab]}
									</SecurityPoolLink>
								}
								currentTimestamp={currentTimestamp}
								item={item}
								key={`${holding.pool.securityPoolAddress}-${item.id}`}
							/>
						))}
					</ul>
				)}
			</SectionBlock>
			<SectionBlock busy={portfolio.loading} className='portfolio-holdings' title={portfolioCopy.yourPositions} variant='plain'>
				<div className='portfolio-holding-list'>
					{holdings.map(holding => (
						<HoldingRecord holding={holding} key={holding.pool.securityPoolAddress} />
					))}
				</div>
			</SectionBlock>
		</>
	)
}

function DisconnectedPortfolio({ isConnectingWallet, onConnect, walletBootstrapComplete }: Pick<PortfolioSectionProps, 'isConnectingWallet' | 'onConnect' | 'walletBootstrapComplete'>) {
	if (!walletBootstrapComplete)
		return (
			<p className='detail' role='status'>
				<LoadingText>{portfolioCopy.loadingWallet}</LoadingText>
			</p>
		)
	return (
		<EmptyState
			actions={
				<button className='primary' type='button' disabled={isConnectingWallet} onClick={onConnect}>
					{isConnectingWallet ? <LoadingText>{portfolioCopy.connectingWallet}</LoadingText> : portfolioCopy.connectWallet}
				</button>
			}
			title={portfolioCopy.connectWalletTitle}
		/>
	)
}

/** The account's home: positions across every pool and the actions they need, soonest deadline first, before any protocol browsing. */
export function PortfolioSection({ accountAddress, currentTimestamp, isConnectingWallet, onConnect, portfolio, walletBootstrapComplete }: PortfolioSectionProps) {
	return (
		<div className='route-view-flow portfolio-route'>
			<RouteHeader title={statoblastAppCopy.portfolio} />
			{accountAddress === undefined ? <DisconnectedPortfolio isConnectingWallet={isConnectingWallet} onConnect={onConnect} walletBootstrapComplete={walletBootstrapComplete} /> : <PortfolioContent accountAddress={accountAddress} currentTimestamp={currentTimestamp} portfolio={portfolio} />}
		</div>
	)
}
