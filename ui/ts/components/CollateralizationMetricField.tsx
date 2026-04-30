import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getCollateralizationDisplayState, getCollateralizationTone } from '../lib/trading.js'

type UniswapPriceSource = 'v4' | 'v3'

type CollateralizationMetricFieldProps = {
	className?: string | undefined
	collateralizationPercent: bigint | undefined
	repEthSource: UniswapPriceSource | undefined
	repEthSourceUrl: string | undefined
	securityBondAllowance: bigint | undefined
	securityMultiplier: bigint | undefined
}

function renderSourceLink(source: UniswapPriceSource, sourceUrl: string | undefined) {
	const label = `u${source === 'v4' ? '4' : '3'}`
	if (sourceUrl === undefined) return `(${label})`
	return (
		<a href={sourceUrl} title={source === 'v4' ? 'Price from Uniswap V4' : 'Price from Uniswap V3'} target='_blank' rel='noreferrer'>
			{`(${label})`}
		</a>
	)
}

export function CollateralizationMetricField({ className, collateralizationPercent, repEthSource, repEthSourceUrl, securityBondAllowance, securityMultiplier }: CollateralizationMetricFieldProps) {
	const displayState = getCollateralizationDisplayState(securityBondAllowance, collateralizationPercent)
	const tone = displayState === 'noActiveAllowance' ? undefined : getCollateralizationTone(collateralizationPercent, securityMultiplier)
	const valueClassName = tone === 'success' ? 'metric-value-success' : tone === 'danger' ? 'metric-value-danger' : undefined

	return (
		<MetricField className={className} label={<span title='Uses the live Uniswap REP/ETH quote.'>Collateralization {repEthSource === undefined ? undefined : renderSourceLink(repEthSource, repEthSourceUrl)}</span>} valueClassName={valueClassName} valueTagName={displayState === 'noActiveAllowance' ? 'span' : undefined}>
			{displayState === 'noActiveAllowance' ? 'No active allowance' : <CurrencyValue value={collateralizationPercent} suffix='%' copyable={false} />}
		</MetricField>
	)
}
