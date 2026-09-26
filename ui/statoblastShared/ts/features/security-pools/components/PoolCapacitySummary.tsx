import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ProgressMeter } from '@zoltar/ui-core-shared/components/ProgressMeter.js'
import * as copy from '../../../copy/poolWorkspace.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getRemainingMintCapacity } from '../../markets/lib/trading.js'

/** Share of capacity already used as open interest, in tenths of a percent; values above capacity stay visible. */
function formatCapacityUsedPercent(minted: bigint, capacity: bigint) {
	if (capacity <= 0n) return undefined
	const tenths = (minted * 1000n) / capacity
	return `${(tenths / 10n).toString()}.${(tenths % 10n).toString()}`
}

export function PoolCapacitySummary({ capacity, minted, shareTokenSupplyAttoShares, showUnavailableReason = true, showUsage = false }: { capacity: bigint | undefined; minted: bigint; shareTokenSupplyAttoShares?: bigint; showUnavailableReason?: boolean; showUsage?: boolean }) {
	const value = (
		<>
			<CurrencyValue value={minted} suffix={commonCopy.eth} copyable={false} exactWhenRoundedToZero /> <span className='pool-capacity-limit'>/ {capacity === undefined ? commonCopy.unavailable : <CurrencyValue value={capacity} suffix={commonCopy.eth} copyable={false} exactWhenRoundedToZero />}</span>
		</>
	)
	const usedPercent = capacity === undefined ? undefined : formatCapacityUsedPercent(minted, capacity)
	// Same rule as the remaining-capacity sort: an undefined complete-set exchange rate blocks minting entirely.
	const remaining = getRemainingMintCapacity(capacity, minted, shareTokenSupplyAttoShares) ?? 0n
	const usage =
		showUsage && usedPercent !== undefined && capacity !== undefined
			? {
					detail: (
						<>
							<CurrencyValue value={remaining} suffix={commonCopy.eth} copyable={false} exactWhenRoundedToZero /> {securityPoolCopy.capacityRemaining}
						</>
					),
					secondaryValue: securityPoolCopy.formatCapacityUsed(usedPercent),
				}
			: {}
	return (
		<div className={['pool-capacity-summary', showUsage ? 'is-prominent' : ''].filter(Boolean).join(' ')}>
			{capacity !== undefined && capacity > 0n ? (
				<ProgressMeter label={copy.capacityLabel} maxValue={capacity} value={minted} valueText={value} tone={showUsage && capacity <= minted ? 'warning' : 'default'} {...usage} />
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
