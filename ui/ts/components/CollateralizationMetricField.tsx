import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '../lib/repPriceSource.js'
import { getCollateralizationDisplayState, getCollateralizationTone } from '../lib/trading.js'

type CollateralizationMetricFieldProps = {
	className?: string | undefined
	collateralizationPercent: bigint | undefined
	label?: ComponentChildren
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	securityBondAllowance: bigint | undefined
	securityMultiplier: bigint | undefined
	unavailableCopy?: string | undefined
}

function getDefaultLabel(repPerEthSource: RepPriceSource | undefined, repPerEthSourceUrl: string | undefined) {
	const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource)

	return <span title={repPriceSourceCopy.tooltip}>Collateralization {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}</span>
}

export function CollateralizationMetricField({ className, collateralizationPercent, label, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityMultiplier, unavailableCopy = 'Awaiting REP/ETH price' }: CollateralizationMetricFieldProps) {
	const displayState = getCollateralizationDisplayState(securityBondAllowance, collateralizationPercent)
	const tone = displayState === 'noActiveAllowance' ? undefined : getCollateralizationTone(collateralizationPercent, securityMultiplier)
	const valueClassName = tone === 'success' ? 'metric-value-success' : tone === 'danger' ? 'metric-value-danger' : undefined

	return (
		<MetricField className={className} label={label ?? getDefaultLabel(repPerEthSource, repPerEthSourceUrl)} valueClassName={valueClassName}>
			{displayState === 'noActiveAllowance' ? 'No active allowance' : displayState === 'unavailable' ? unavailableCopy : <CurrencyValue value={collateralizationPercent} suffix='%' copyable={false} />}
		</MetricField>
	)
}
