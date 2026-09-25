import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ProgressMeter } from '@zoltar/ui-core-shared/components/ProgressMeter.js'
import * as copy from '../../../copy/poolWorkspace.js'
import type { ResolvedRepPrice } from '../lib/uiPriceOracle.js'
import { RepPriceStatusLabel } from './RepPriceStatusLabel.js'

/** Open interest against estimated capacity, labelled with the REP price the capacity uses (the selected pool's price when `repPrice` is omitted). */
export function PoolCapacitySummary({ capacity, currentTimestamp, minted, repPrice }: { capacity: bigint | undefined; currentTimestamp?: bigint | undefined; minted: bigint; repPrice?: ResolvedRepPrice | undefined }) {
	const value = (
		<>
			<CurrencyValue value={minted} suffix={commonCopy.eth} copyable={false} exactWhenRoundedToZero /> <span className='pool-capacity-limit'>/ {capacity === undefined ? commonCopy.unavailable : <CurrencyValue value={capacity} suffix={commonCopy.eth} copyable={false} exactWhenRoundedToZero />}</span>
		</>
	)
	return (
		<div className='pool-capacity-summary'>
			{capacity !== undefined && capacity > 0n ? (
				<ProgressMeter label={copy.capacityLabel} maxValue={capacity} value={minted} valueText={value} />
			) : (
				<div className='pool-capacity-unavailable'>
					<span className='metric-label'>{copy.capacityLabel}</span>
					<strong>{value}</strong>
				</div>
			)}
			<RepPriceStatusLabel currentTimestamp={currentTimestamp} repPrice={repPrice} />
		</div>
	)
}
