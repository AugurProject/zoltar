import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '../lib/repPriceSource.js'
import { getCollateralizationDisplayState, getCollateralizationTone } from '../lib/trading.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'
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
	return (
		<span title={repPriceSourceCopy.tooltip}>
			{TSX_STRINGS.componentsCollateralizationMetricField.copy001}
			{renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
		</span>
	)
}
export function CollateralizationMetricField({ className, collateralizationPercent, label, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityMultiplier, unavailableCopy = TSX_STRINGS.componentsCollateralizationMetricField.copy002 }: CollateralizationMetricFieldProps) {
	const displayState = getCollateralizationDisplayState(securityBondAllowance, collateralizationPercent)
	const tone = displayState === 'noActiveAllowance' ? undefined : getCollateralizationTone(collateralizationPercent, securityMultiplier)
	const valueClassName = (() => {
		if (tone === 'success') return 'metric-value-success'
		if (tone === 'danger') return 'metric-value-danger'

		return undefined
	})()
	return (
		<MetricField className={className} label={label ?? getDefaultLabel(repPerEthSource, repPerEthSourceUrl)} valueClassName={valueClassName}>
			{(() => {
				if (displayState === 'noActiveAllowance') return TSX_STRINGS.componentsCollateralizationMetricField.copy003
				if (displayState === 'unavailable') return unavailableCopy

				return <CurrencyValue value={collateralizationPercent} suffix={TSX_STRINGS.componentsCollateralizationMetricField.copy004} copyable={false} />
			})()}
		</MetricField>
	)
}
