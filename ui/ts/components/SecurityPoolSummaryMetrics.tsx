import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { UniverseLink } from './UniverseLink.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import type { ListedSecurityPool } from '../types/contracts.js'

type SecurityPoolSummaryMetricsProps = {
	children?: ComponentChildren
	className?: string
	pool: ListedSecurityPool
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'mock' | 'v3' | 'v4' | undefined
	repPerEthSourceUrl: string | undefined
	showPoolAddress?: boolean
	showTotalBacking?: boolean
	showUniverse?: boolean
}

export function SecurityPoolSummaryMetrics({ children, className = 'workflow-metric-grid', pool, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, showPoolAddress = false, showTotalBacking = false, showUniverse = false }: SecurityPoolSummaryMetricsProps) {
	return (
		<div className={className}>
			{showPoolAddress ? (
				<MetricField label='Pool Address'>
					<AddressValue address={pool.securityPoolAddress} />
				</MetricField>
			) : undefined}
			{showUniverse ? (
				<MetricField label='Universe'>
					<UniverseLink universeId={pool.universeId} />
				</MetricField>
			) : undefined}
			<MetricField label='Vaults'>{pool.vaultCount.toString()}</MetricField>
			<MetricField label='Security Multiplier'>{pool.securityMultiplier.toString()}</MetricField>
			<MetricField label='Open Interest Fee / Year'>
				<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix='%' />
			</MetricField>
			{showTotalBacking ? (
				<MetricField label='Total REP Collateral'>
					<CurrencyValue value={pool.totalRepDeposit} suffix='REP' />
				</MetricField>
			) : undefined}
			<OpenInterestCapacityMetrics
				completeSetCollateralAmount={pool.completeSetCollateralAmount}
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				securityMultiplier={pool.securityMultiplier}
				totalRepDeposit={pool.totalRepDeposit}
				totalSecurityBondAllowance={pool.totalSecurityBondAllowance}
			/>
			{children}
		</div>
	)
}
