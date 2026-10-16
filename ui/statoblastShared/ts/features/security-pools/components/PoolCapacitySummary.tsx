import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ProgressMeter } from '@zoltar/ui-core-shared/components/ProgressMeter.js'
import * as copy from '../../../copy/poolWorkspace.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ListedSecurityPool } from '../../../types/contracts.js'
import { getPoolRemainingMintCapacity } from '../../markets/lib/trading.js'
import { formatPercentOfLimit } from '../lib/poolStrip.js'
import { isMintingPausedByEscalation } from '../lib/poolLifecycle.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'

/** "amount / limit" for a strip meter, the limit set quietly so it wraps as one unit. */
export function AmountOfLimit({ amount, limit }: { amount: bigint; limit: bigint }) {
	return (
		<>
			<CurrencyValue value={amount} suffix={commonCopy.eth} exactWhenRoundedToZero />{' '}
			<span className='pool-capacity-limit'>
				/ <CurrencyValue value={limit} suffix={commonCopy.eth} exactWhenRoundedToZero />
			</span>
		</>
	)
}

/**
 * The pool's settlement collateral against its commitments. The remainder is the mintable figure from `getPoolRemainingMintCapacity`, which is zero while an escalation game is open or the complete-set exchange rate is undefined, so it matches the Mint action.
 * While an escalation game pauses minting, the caption names that reason in place of the zero remainder, which would otherwise contradict a low usage.
 */
export function PoolCapacitySummary({ lifecycleState, pool }: { lifecycleState: SecurityPoolLifecycleState | undefined; pool: ListedSecurityPool }) {
	const capacity = pool.totalUnderwritingLimitAttoEth
	const minted = pool.settlementCollateralAttoEth
	const value = <AmountOfLimit amount={minted} limit={capacity} />
	// Undefined while the pool has no commitment, so there is no meter to fill.
	const usedPercent = formatPercentOfLimit(minted, capacity)
	return (
		<div className='pool-meter pool-capacity-summary'>
			{usedPercent === undefined ? (
				<div className='pool-capacity-empty'>
					<span className='metric-label'>{copy.capacityLabel}</span>
					<strong>{value}</strong>
				</div>
			) : (
				<ProgressMeter
					label={copy.capacityLabel}
					maxValue={capacity}
					value={minted}
					valueText={value}
					tone={capacity <= minted ? 'warning' : 'default'}
					detail={
						isMintingPausedByEscalation(pool, lifecycleState) ? (
							securityPoolCopy.mintingPaused
						) : (
							<>
								<CurrencyValue value={getPoolRemainingMintCapacity(pool) ?? 0n} suffix={commonCopy.eth} copyable={false} exactWhenRoundedToZero /> {securityPoolCopy.capacityRemaining}
							</>
						)
					}
					secondaryValue={securityPoolCopy.formatCapacityUsed(usedPercent)}
				/>
			)}
		</div>
	)
}
