import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ProgressMeter } from '@zoltar/ui-core-shared/components/ProgressMeter.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as copy from '../../../copy/poolWorkspace.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

/** An amount as a share of its limit, in tenths of a percent; values above the limit stay visible. Undefined without a positive limit. */
export function formatPercentOfLimit(amount: bigint, limit: bigint) {
	if (limit <= 0n) return undefined
	return formatTrimmedUnits((amount * 1000n) / limit, 1)
}

/** "amount / limit" for a strip meter, the limit set quietly so it wraps as one unit. */
export function AmountOfLimit({ amount, limit }: { amount: bigint; limit: bigint | undefined }) {
	return (
		<>
			<CurrencyValue value={amount} suffix={commonCopy.eth} exactWhenRoundedToZero /> <span className='pool-capacity-limit'>/ {limit === undefined ? commonCopy.unavailable : <CurrencyValue value={limit} suffix={commonCopy.eth} exactWhenRoundedToZero />}</span>
		</>
	)
}

/**
 * `remainingCapacity` is the mintable remainder from `getPoolRemainingMintCapacity`, which is zero while an escalation game is open or the complete-set exchange rate is undefined, so every caller states the same figure as the pool directory and the Mint action.
 * While an escalation game pauses minting, `mintingPaused` names that reason in place of the zero remainder, which would otherwise contradict a low usage.
 */
export function PoolCapacitySummary({ capacity, minted, mintingPaused = false, remainingCapacity, showUnavailableReason = true, showUsage = false }: { capacity: bigint | undefined; minted: bigint; mintingPaused?: boolean; remainingCapacity: bigint | undefined; showUnavailableReason?: boolean; showUsage?: boolean }) {
	const value = <AmountOfLimit amount={minted} limit={capacity} />
	const usedPercent = capacity === undefined ? undefined : formatPercentOfLimit(minted, capacity)
	const remaining = remainingCapacity ?? 0n
	const usage =
		showUsage && usedPercent !== undefined && capacity !== undefined
			? {
					detail: mintingPaused ? (
						securityPoolCopy.mintingPaused
					) : (
						<>
							<CurrencyValue value={remaining} suffix={commonCopy.eth} copyable={false} exactWhenRoundedToZero /> {securityPoolCopy.capacityRemaining}
						</>
					),
					secondaryValue: securityPoolCopy.formatCapacityUsed(usedPercent),
				}
			: {}
	return (
		<div className={['pool-meter pool-capacity-summary', showUsage ? 'is-prominent' : ''].filter(Boolean).join(' ')}>
			{capacity !== undefined && capacity > 0n ? (
				<ProgressMeter label={copy.capacityLabel} maxValue={capacity} value={minted} valueText={value} tone={showUsage && capacity <= minted ? 'warning' : 'default'} {...usage} />
			) : (
				<div className='pool-capacity-unavailable'>
					<span className='metric-label'>{copy.capacityLabel}</span>
					<strong>{value}</strong>
					{capacity === undefined && showUnavailableReason ? <UserMessage className='detail' detail={copy.capacityUnavailable} /> : undefined}
				</div>
			)}
		</div>
	)
}
