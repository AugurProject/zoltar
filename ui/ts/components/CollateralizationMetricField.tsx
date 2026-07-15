import * as commonCopy from '../copy/common.js'
import * as pricingCopy from '../copy/pricing.js'
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
	return (
		<span title={repPriceSourceCopy.tooltip}>
			{`${pricingCopy.collateralizationLabel} `}
			{renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
		</span>
	)
}
export function CollateralizationMetricField({ className, collateralizationPercent, label, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityMultiplier, unavailableCopy = pricingCopy.awaitingRepEthPrice }: CollateralizationMetricFieldProps) {
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
				if (displayState === 'noActiveAllowance') return pricingCopy.noActiveAllowance
				if (displayState === 'unavailable') return unavailableCopy

				return <CurrencyValue value={collateralizationPercent} suffix={commonCopy.percent} copyable={false} />
			})()}
		</MetricField>
	)
}
