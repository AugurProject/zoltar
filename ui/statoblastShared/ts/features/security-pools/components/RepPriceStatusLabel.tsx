import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import * as pricingCopy from '../../../copy/pricing.js'
import { describeRepPriceStatus, type ResolvedRepPrice } from '../lib/uiPriceOracle.js'

/** The REP price resolved for the selected pool; figures inside the pool workspace label themselves from it. */
export const SelectedPoolRepPriceContext = createContext<ResolvedRepPrice | undefined>(undefined)

/** Shows which price a derived figure uses and whether that price is stale. Renders nothing without a resolved price. */
export function RepPriceStatusLabel({ currentTimestamp, repPrice }: { currentTimestamp?: bigint | undefined; repPrice?: ResolvedRepPrice | undefined }) {
	const selectedPoolRepPrice = useContext(SelectedPoolRepPriceContext)
	const chainTimestamp = useChainTimestamp()
	const resolvedRepPrice = repPrice ?? selectedPoolRepPrice
	if (resolvedRepPrice === undefined) return undefined
	const status = describeRepPriceStatus(resolvedRepPrice, currentTimestamp ?? chainTimestamp)
	return (
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
}
