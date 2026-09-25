import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as appCopy from '../../../copy/app.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { getQuestionTitle, Question } from '@zoltar/ui-core-shared/components/Question.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { formatUniverseIdHex } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import { useUniverseName } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { getSecurityPoolStatusBadgeLabel, getSecurityPoolStatusBadgeTone } from '../lib/securityPoolLabels.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { getOracleManagerPriceValidUntilTimestamp } from '../../../protocol/oracleTiming.js'
import { PoolCapacitySummary } from './PoolCapacitySummary.js'
import * as copy from '../../../copy/poolWorkspace.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

export function PoolDirectoryRow({
	pool,
	activeUniverseId,
	lifecycleState,
	capacity,
	currentTimestamp,
	onSelect,
}: {
	activeUniverseId: bigint
	pool: ListedSecurityPool
	lifecycleState: SecurityPoolLifecycleState | undefined
	capacity: bigint | undefined
	currentTimestamp: bigint | undefined
	onSelect: ((address: string, universeId: bigint) => void) | undefined
}) {
	const title = getQuestionTitle(pool.marketDetails)
	const poolUniverseName = useUniverseName(pool.universeId)
	const status = getSecurityPoolStatusBadgeLabel({ hasForkActivity: pool.hasForkActivity, questionOutcome: pool.questionOutcome, lifecycleState })
	const params = new URLSearchParams(getRouteHashSearch())
	params.set('securityPool', pool.securityPoolAddress)
	params.set('universe', formatUniverseIdHex(pool.universeId))
	params.set('securityPoolsView', 'operate')
	const href = buildRouteHref('#/security-pools', `?${params.toString()}`)
	const validUntil = getOracleManagerPriceValidUntilTimestamp(pool.lastOracleSettlementTimestamp)
	const oracleExpired = validUntil !== undefined && currentTimestamp !== undefined && currentTimestamp >= validUntil
	const oracleMissing = pool.lastOracleSettlementTimestamp === 0n || pool.lastOraclePrice === undefined

	return (
		<article className='security-pool-overview-record pool-directory-row'>
			<div className='pool-directory-identity'>
				<Badge ariaLabel={status} tone={getSecurityPoolStatusBadgeTone(lifecycleState)}>
					{status}
				</Badge>
				<h3>{title}</h3>
				<div className='pool-directory-meta'>
					<AddressValue address={pool.securityPoolAddress} responsiveAbbreviation />
					<span>
						{appCopy.statoblastSecurityMultiplierBps}: {formatStatoblastSecurityMultiplier(pool.statoblastSecurityMultiplierBps)}×
					</span>
				</div>
				<div className='pool-directory-meta'>
					<span>
						{currentTimestamp !== undefined && currentTimestamp >= pool.marketDetails.endTime ? securityPoolCopy.ended : commonCopy.ends} <TimestampValue timestamp={pool.marketDetails.endTime} {...(currentTimestamp === undefined ? {} : { currentTimestamp })} />
					</span>
					<span>{copy.vaults(pool.vaultCount)}</span>
				</div>
				{pool.universeId === activeUniverseId ? undefined : <p className='detail'>{securityPoolCopy.formatBrowsePoolUniverseMismatch(poolUniverseName)}</p>}
				{oracleExpired || oracleMissing ? <span className='pool-oracle-warning'>{oracleExpired ? copy.poolPriceExpired : copy.poolPriceUnavailable}</span> : undefined}
			</div>
			<PoolCapacitySummary capacity={capacity} minted={pool.settlementCollateralAttoEth} />
			<a
				className='secondary pool-open-link'
				href={href}
				aria-label={securityPoolCopy.formatOpenPoolLabel(title, pool.securityPoolAddress)}
				onClick={event => {
					if (onSelect === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
					event.preventDefault()
					onSelect(pool.securityPoolAddress, pool.universeId)
				}}
			>
				{securityPoolCopy.openPool}
			</a>
			<div className='pool-directory-details decision-summary'>
				<ReadOnlyDetailAccordion title={copy.poolDetails}>
					<MetricField label={commonCopy.initialReportPriorityFee}>
						<CurrencyValue value={pool.initialReportPriorityFeeAttoEthPerGas} suffix={commonCopy.eth} precision='exact' />
					</MetricField>
					<MetricField label={securityPoolCopy.openInterestFeeYear}>
						<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
					</MetricField>
					<Question question={pool.marketDetails} variant='preview' showTitle={false} />
				</ReadOnlyDetailAccordion>
			</div>
		</article>
	)
}
