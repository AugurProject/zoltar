import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getRepPriceTooltip, renderRepPriceSourceLabel, type RepPriceSource } from '../lib/repPriceSource.js'
import { getCollateralizationDisplayState, getCollateralizationTone } from '../lib/trading.js'

type CollateralizationMetricFieldProps = {
	className?: string | undefined
	collateralizationPercent: bigint | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	securityBondAllowance: bigint | undefined
	securityMultiplier: bigint | undefined
}

export function CollateralizationMetricField({ className, collateralizationPercent, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityMultiplier }: CollateralizationMetricFieldProps) {
	const displayState = getCollateralizationDisplayState(securityBondAllowance, collateralizationPercent)
	const tone = displayState === 'noActiveAllowance' ? undefined : getCollateralizationTone(collateralizationPercent, securityMultiplier)
	const valueClassName = tone === 'success' ? 'metric-value-success' : tone === 'danger' ? 'metric-value-danger' : undefined

	return (
		<MetricField className={className} label={<span title={getRepPriceTooltip(repPerEthSource)}>Collateralization {repPerEthSource === undefined ? undefined : renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}</span>} valueClassName={valueClassName}>
			{displayState === 'noActiveAllowance' ? 'No active allowance' : displayState === 'unavailable' ? 'Awaiting REP/ETH price' : <CurrencyValue value={collateralizationPercent} suffix='%' copyable={false} />}
		</MetricField>
	)
}
