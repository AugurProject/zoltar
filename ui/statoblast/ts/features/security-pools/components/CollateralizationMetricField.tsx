import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as pricingCopy from '@zoltar/ui-core-shared/copy/pricing.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '@zoltar/ui-zoltar/features/open-oracle/lib/repPriceSource.js'
import { getCollateralizationDisplayState, getCollateralizationTone } from '../../markets/lib/trading.js'
type CollateralizationMetricFieldProps = {
	className?: string | undefined
	collateralizationPercent: bigint | undefined
	label?: ComponentChildren
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	capacityOwnershipAttoRep: bigint | undefined
	statoblastSecurityMultiplierBps: bigint | undefined
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
export function CollateralizationMetricField({ className, collateralizationPercent, label, repPerEthSource, repPerEthSourceUrl, capacityOwnershipAttoRep, statoblastSecurityMultiplierBps, unavailableCopy = pricingCopy.awaitingRepEthPrice }: CollateralizationMetricFieldProps) {
	const displayState = getCollateralizationDisplayState(capacityOwnershipAttoRep, collateralizationPercent)
	const tone = displayState === 'noActiveCapacityOwnership' ? undefined : getCollateralizationTone(collateralizationPercent, statoblastSecurityMultiplierBps)
	const valueClassName = (() => {
		if (tone === 'success') return 'metric-value-success'
		if (tone === 'danger') return 'metric-value-danger'

		return undefined
	})()
	return (
		<MetricField className={className} label={label ?? getDefaultLabel(repPerEthSource, repPerEthSourceUrl)} valueClassName={valueClassName}>
			{(() => {
				if (displayState === 'noActiveCapacityOwnership') return pricingCopy.noActiveCapacityOwnership
				if (displayState === 'unavailable') return unavailableCopy

				return <CurrencyValue value={collateralizationPercent} suffix={commonCopy.percent} copyable={false} />
			})()}
		</MetricField>
	)
}
