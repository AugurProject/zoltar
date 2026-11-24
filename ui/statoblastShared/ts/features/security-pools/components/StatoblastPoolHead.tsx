import * as pageCopy from '../../../copy/securityPoolPage.js'
import { isAddress, formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { AddressText, AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { getLocalEntityScope, useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { setEntityFavoriteLabel } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { poolTabs, statoblastPageHref, type PoolTab, type StatoblastPoolPage } from '../../../lib/routing.js'
import type { useSecurityPool } from '../hooks/useSecurityPool.js'
import * as copy from '../../../copy/securityPool.js'
import * as capitalCopy from '../../../copy/securityPoolCapital.js'

export function StatoblastPoolHead({ page, model, wallet, priceChecking }: { page: StatoblastPoolPage; model: ReturnType<typeof useSecurityPool>; wallet: Address | undefined; priceChecking: boolean }) {
	const favorites = useFavorites('statoblast', 'pool')
	const poolLabel = favorites.entries.find(item => item.id === page.pool.toLowerCase())?.label
	const snapshot = model.presentationSnapshot
	const forked = (snapshot?.forkTime ?? 0n) > 0n
	const hasPosition = (snapshot?.ownerPrincipalAttoRep ?? 0n) > 0n || (snapshot?.ownerCommitmentAttoEth ?? 0n) > 0n
	const tabs = poolTabs.filter(tab => (tab === 'fork' ? forked : tab !== 'liquidations' || !forked))
	const collateral = (value: bigint | undefined) => <CurrencyValue value={value} suffix={snapshot?.collateral.symbol ?? ''} units={snapshot?.collateral.decimals ?? 18} />
	const currentPrice = snapshot?.priceValid === true && !priceChecking
	const priceBadge = forked || snapshot === undefined ? undefined : <Badge tone={currentPrice ? 'ok' : 'warning'}>{currentPrice ? capitalCopy.priceValid : capitalCopy.priceStale}</Badge>
	const labelForTab = (tab: PoolTab) => (forked && tab === 'price' ? pageCopy.returnFundsOnly : pageCopy.poolTabLabels[tab])
	const you = wallet !== undefined && wallet.toLowerCase() === model.ownerInput.toLowerCase()
	return (
		<>
			<header className='statoblast-pool-head'>
				<nav className='statoblast-breadcrumbs' aria-label={pageCopy.breadcrumbs}>
					<a href={statoblastPageHref({ kind: 'watchlist' })}>{pageCopy.watchlist}</a>
					<span aria-hidden='true'>›</span>
					<span aria-current='page'>{pageCopy.securityPool}</span>
				</nav>
				<a className='statoblast-back-link' href={statoblastPageHref({ kind: 'watchlist' })}>
					{pageCopy.backToWatchlist}
				</a>
				<div className='statoblast-pool-state'>
					{snapshot !== undefined && (
						<>
							<Badge tone={forked ? 'warning' : 'ok'}>{forked ? pageCopy.forked : pageCopy.active}</Badge>
							<span>
								{snapshot.collateral.symbol}
								{pageCopy.collateralTail}
								{snapshot.admission.mode === 'fixed' ? copy.admissionFixed : copy.admissionOpen}
							</span>
						</>
					)}
					<UpdatedAgo updatedAt={model.displayedAt} refreshing={model.loading} />
				</div>
				<div className='statoblast-pool-identity'>
					<FavoriteToggle app='statoblast' kind='pool' id={page.pool} entityLabel={pageCopy.formatSecurityPool(page.pool)} confirmUnfavorite={() => !hasPosition || window.confirm(pageCopy.unstarPositionConfirmation)} />
					<h1>
						<AddressValue longAbbreviation address={page.pool} />
					</h1>
				</div>
				<details className='statoblast-pool-label'>
					<summary>{poolLabel ?? pageCopy.addLabel}</summary>
					<form
						onSubmit={event => {
							event.preventDefault()
							const label = new FormData(event.currentTarget).get('label')
							if (typeof label !== 'string') return
							setEntityFavoriteLabel(getLocalEntityScope('statoblast', 'pool'), page.pool, label)
							event.currentTarget.closest('details')?.removeAttribute('open')
						}}
					>
						<label>
							{pageCopy.poolLabel} <input name='label' defaultValue={poolLabel ?? ''} maxLength={100} />
						</label>
						<button type='submit'>{pageCopy.saveLabel}</button>
					</form>
				</details>
				<details className='statoblast-position-picker'>
					<summary>
						{you ? (
							<>
								{pageCopy.positionOfLead}
								<strong>{pageCopy.you}</strong>
							</>
						) : (
							pageCopy.positionOf
						)}{' '}
						<code>
							<AddressText address={model.ownerInput} longAbbreviation />
						</code>
					</summary>
					<form
						onSubmit={event => {
							event.preventDefault()
							const owner = new FormData(event.currentTarget).get('owner')
							if (typeof owner !== 'string' || !isAddress(owner.trim())) return
							model.setOwnerInput(owner.trim())
							event.currentTarget.closest('details')?.removeAttribute('open')
						}}
					>
						<label>
							{pageCopy.positionOwnerLead}
							<input name='owner' defaultValue={model.ownerInput} key={model.ownerInput} pattern='0x[0-9a-fA-F]{40}' required />
						</label>
						<button type='submit'>{pageCopy.openPosition}</button>
						{wallet !== undefined && !you && (
							<button className='secondary' type='button' onClick={() => model.setOwnerInput(wallet)}>
								{pageCopy.myPosition}
							</button>
						)}
					</form>
				</details>
			</header>
			<div className='statoblast-pool-facts'>
				<MetricField label={pageCopy.capacityInUse}>
					{snapshot === undefined ? undefined : (
						<>
							{collateral(snapshot.demandAttoEth)}
							{pageCopy.ofTail}
							{collateral(snapshot.healthyCommitmentAttoEth)}
						</>
					)}
				</MetricField>
				<MetricField label={pageCopy.totalPledgedRep}>
					<CurrencyValue value={snapshot?.totalPledgedAttoRep} suffix={pageCopy.rep} />
				</MetricField>
				<MetricField label={pageCopy.holdingFee}>{snapshot === undefined ? undefined : pageCopy.formatAnnualFee(formatUnits(snapshot.economics.annualFeeBps, 2))}</MetricField>
				<MetricField label={pageCopy.purchaseFee}>
					{snapshot === undefined ? undefined : (
						<>
							{formatUnits(snapshot.economics.purchaseFeeBps, 2)}
							{pageCopy.minimumFeeTail}
							{collateral(snapshot.economics.minimumPurchaseFeeAttoEth)})
						</>
					)}
				</MetricField>
				<MetricField label={copy.securityMultiplier}>{snapshot === undefined ? undefined : `${formatUnits(snapshot.securityMultiplierBps, 2)}%`}</MetricField>
				<MetricField label={capitalCopy.minimumCommitment}>{collateral(snapshot?.economics.minimumCommitmentAttoEth)}</MetricField>
			</div>
			<nav className='statoblast-page-tabs statoblast-pool-tabs' aria-label={pageCopy.securityPoolViews}>
				{tabs.map(tab => (
					<a key={tab} aria-current={tab === page.tab ? 'page' : undefined} href={statoblastPageHref({ ...page, tab })}>
						{labelForTab(tab)}
						{tab === 'price' && priceBadge}
					</a>
				))}
			</nav>
			<label className='statoblast-pool-tab-select'>
				{pageCopy.pageLead}
				<select
					value={page.tab}
					onChange={event => {
						const target = tabs.find(tab => tab === event.currentTarget.value)
						if (target !== undefined) window.location.href = statoblastPageHref({ ...page, tab: target })
					}}
				>
					{tabs.map(tab => (
						<option value={tab} key={tab}>
							{labelForTab(tab)}
						</option>
					))}
				</select>
				{priceBadge}
			</label>
		</>
	)
}
