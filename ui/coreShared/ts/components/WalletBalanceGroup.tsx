import * as commonCopy from '../copy/common.js'
import { CurrencyValue } from './CurrencyValue.js'
import { HeaderMetricGroup } from './HeaderMetricStrip.js'
import { MetricField } from './MetricField.js'

export type WalletBalanceMetric = {
	/** Asset symbol shown as the metric label and exposed as `data-wallet-asset` for tests and styling hooks. */
	asset: string
	exactWhenRoundedToZero?: boolean
	loading: boolean
	value: bigint | undefined
}

/** The "Balances" group of the account popover: one fixed row per asset the application uses. */
export function WalletBalanceGroup({ balances }: { balances: readonly WalletBalanceMetric[] }) {
	return (
		<HeaderMetricGroup label={commonCopy.balances}>
			{balances.map(balance => (
				<MetricField key={balance.asset} label={balance.asset}>
					<span data-wallet-asset={balance.asset}>
						<CurrencyValue value={balance.value} loading={balance.loading} compactWhenOverflow exactWhenRoundedToZero={balance.exactWhenRoundedToZero === true} />
					</span>
				</MetricField>
			))}
		</HeaderMetricGroup>
	)
}
