import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '../../../copy/securityPoolTakeover.js'
import type { LiquidationHealth, LiquidationTarget } from '../hooks/useLiquidationTarget.js'

export type LiquidationPositionRow = {
	id: string
	position: Pick<LiquidationTarget['position'], 'owner' | 'rep' | 'commitment'> | undefined
	started: bigint | undefined
	health: LiquidationHealth | undefined
	savedAt?: number | undefined
}

export function LiquidationPositionsTable({ rows, selected, collateral, disabled, onOpen }: { rows: readonly LiquidationPositionRow[]; selected: bigint | undefined; collateral: { symbol: string; decimals: number }; disabled: boolean; onOpen(id: string): void }) {
	if (rows.length === 0) return undefined
	return (
		<div className='statoblast-liquidation-positions'>
			<table className='statoblast-liquidation-table' role='table'>
				<caption className='visually-hidden'>{copy.knownPositions}</caption>
				<thead>
					<tr>
						<th scope='col'>{copy.positionColumn}</th>
						<th scope='col'>{copy.ownerColumn}</th>
						<th scope='col'>{copy.pledgedColumn}</th>
						<th scope='col'>{copy.commitmentColumn}</th>
						<th scope='col'>{copy.healthColumn}</th>
						<th scope='col'>{copy.started}</th>
						<th scope='col'>{copy.actionColumn}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(row => {
						const selectedRow = selected?.toString() === row.id
						const health = row.health
						const scale = health !== undefined && health.threshold > 10_000n ? health.threshold : 10_000n
						return (
							<tr key={row.id} role='row' data-selected={selectedRow || undefined} tabIndex={-1}>
								<th scope='row' role='rowheader'>
									{copy.formatPosition(row.id)}
								</th>
								<td role='cell' data-label={copy.ownerColumn}>
									<AddressValue address={row.position?.owner} longAbbreviation />
								</td>
								<td role='cell' data-label={copy.pledgedColumn}>
									<CurrencyValue value={row.position?.rep} suffix={common.rep} />
								</td>
								<td role='cell' data-label={copy.commitmentColumn}>
									<CurrencyValue value={row.position?.commitment} units={collateral.decimals} suffix={collateral.symbol} />
								</td>
								<td role='cell' data-label={copy.healthColumn}>
									{health === undefined ? (
										copy.healthUnavailable
									) : (
										<div className='statoblast-liquidation-health' data-distressed={health.belowLiquidation || undefined}>
											<strong>{copy.formatHealth(formatUnits(health.bps, 2))}</strong>
											<meter aria-label={copy.healthColumn} aria-valuetext={copy.formatHealth(formatUnits(health.bps, 2))} min={0} max={Number(scale)} low={Number(health.threshold)} optimum={Number(scale)} value={Number(health.bps < scale ? health.bps : scale)} />
											<small>{copy.formatLiquidationThreshold(copy.formatHealth(formatUnits(health.threshold, 2)))}</small>
										</div>
									)}
									{row.savedAt !== undefined && <UpdatedAgo updatedAt={row.savedAt} />}
								</td>
								<td role='cell' data-label={copy.started}>
									<TimestampValue timestamp={row.started} relative='first' zeroText={copy.notStarted} />
								</td>
								<td role='cell'>
									{selectedRow ? (
										common.selected
									) : (
										<button
											type='button'
											className='secondary'
											disabled={disabled}
											aria-label={copy.formatOpenPosition(row.id)}
											onClick={event => {
												// The row stays mounted when its Open button changes to Selected.
												event.currentTarget.closest('tr')?.focus()
												onOpen(row.id)
											}}
										>
											{copy.openRow}
										</button>
									)}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}
