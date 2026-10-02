import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as pricingCopy from '../../../copy/pricing.js'
import { describeRepPriceStatus, type ResolvedRepPrice } from '../lib/uiPriceOracle.js'

/** The REP price resolved for the selected pool; figures inside the pool workspace label themselves from it. */
export const SelectedPoolRepPriceContext = createContext<ResolvedRepPrice | undefined>(undefined)

export const RepPriceRefreshContext = createContext<{ onRefresh: () => void; busy: boolean } | undefined>(undefined)

/** Shows which price a derived figure uses and whether that price is stale. Renders nothing without a resolved price. */
export function RepPriceStatusLabel({ currentTimestamp, repPrice, refreshable = false }: { refreshable?: boolean; currentTimestamp?: bigint | undefined; repPrice?: ResolvedRepPrice | undefined }) {
	const selectedPoolRepPrice = useContext(SelectedPoolRepPriceContext)
	const chainTimestamp = useChainTimestamp()
	const refresh = useContext(RepPriceRefreshContext)
	const resolvedRepPrice = repPrice ?? selectedPoolRepPrice
	if (resolvedRepPrice === undefined) return undefined
	const status = describeRepPriceStatus(resolvedRepPrice, currentTimestamp ?? chainTimestamp)
	const label = (
		<span className={`rep-price-status ${status.state}`}>
			{status.state === 'stale' ? (
				<span className='rep-price-status-icon' aria-hidden='true'>
					{pricingCopy.stalePriceIcon}
				</span>
			) : undefined}
			<span className='rep-price-status-title'>{status.title}</span>
			{status.detail === undefined ? undefined : (
				<span className='rep-price-status-detail'>
					{pricingCopy.repPriceStatusSeparator}
					{status.detail}
				</span>
			)}
		</span>
	)
	if (!refreshable || refresh === undefined || resolvedRepPrice.setting === 'open-oracle') return label
	return (
		<span className='rep-price-refresh'>
			{label}
			<button type='button' className='quiet metric-label-refresh' onClick={refresh.onRefresh} disabled={refresh.busy} aria-label={appCopy.refreshRepPrices} aria-busy={refresh.busy} title={refresh.busy ? appCopy.refreshingRepPrices : appCopy.refreshRepPrices}>
				<span aria-hidden='true'>↻</span>
			</button>
		</span>
	)
}
