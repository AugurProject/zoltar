import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ProgressMeter } from '@zoltar/ui-core-shared/components/ProgressMeter.js'
import * as copy from '../../../copy/poolWorkspace.js'

export function PoolCapacitySummary({ capacity, minted, showUnavailableReason = true }: { capacity: bigint | undefined; minted: bigint; showUnavailableReason?: boolean }) {
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
					{capacity === undefined && showUnavailableReason ? <p className='detail'>{copy.capacityUnavailable}</p> : undefined}
				</div>
			)}
		</div>
	)
}
