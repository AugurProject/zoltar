import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '../lib/repPriceSource.js'
import { getCollateralizationDisplayState, getCollateralizationTone } from '../lib/trading.js'
import { UI_STRING_AWAITING_REP_ETH_PRICE, UI_STRING_COLLATERALIZATION_LABEL, UI_STRING_NO_ACTIVE_ALLOWANCE, UI_STRING_PERCENT } from '../lib/uiStrings.js'
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
			{`${UI_STRING_COLLATERALIZATION_LABEL} `}
			{renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
		</span>
	)
}
export function CollateralizationMetricField({ className, collateralizationPercent, label, repPerEthSource, repPerEthSourceUrl, securityBondAllowance, securityMultiplier, unavailableCopy = UI_STRING_AWAITING_REP_ETH_PRICE }: CollateralizationMetricFieldProps) {
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
				if (displayState === 'noActiveAllowance') return UI_STRING_NO_ACTIVE_ALLOWANCE
				if (displayState === 'unavailable') return unavailableCopy

				return <CurrencyValue value={collateralizationPercent} suffix={UI_STRING_PERCENT} copyable={false} />
			})()}
		</MetricField>
	)
}
