import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { UniverseContextSummary } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseContextSummary.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import * as universeCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseLink } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseLink.js'
import { formatUniverseLabel } from '@zoltar/ui-zoltar-shared/features/universes/lib/universe.js'
import type { ListedSecurityPool, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UniverseDirectorySectionProps = {
	activeUniverseId: bigint
	loadingSecurityPools?: boolean | undefined
	onRetry?: (() => void) | undefined
	securityPoolError?: string | undefined
	securityPools?: ListedSecurityPool[] | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

function getUniversePoolMetrics(universeId: bigint, securityPools: ListedSecurityPool[]) {
	return securityPools.reduce(
		(metrics, pool) => {
			if (pool.universeId !== universeId) return metrics
			return {
				poolCount: metrics.poolCount + 1n,
				totalPoolHeldAttoRep: metrics.totalPoolHeldAttoRep + pool.totalPoolHeldAttoRep,
				vaultCount: metrics.vaultCount + pool.vaultCount,
			}
		},
		{ poolCount: 0n, totalPoolHeldAttoRep: 0n, vaultCount: 0n },
	)
}

export function UniverseDirectorySection({ activeUniverseId, loadingSecurityPools = false, onRetry, securityPoolError, securityPools, zoltarUniverse }: UniverseDirectorySectionProps) {
	if (zoltarUniverse === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails }} />
	if (securityPoolError !== undefined && securityPools === undefined) return <RetryableNotice onRetry={onRetry} retryLabel={securityPoolCopy.retryLoadingPools} disabled={loadingSecurityPools} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: securityPoolError }} />
	if (loadingSecurityPools || securityPools === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: securityPoolCopy.loadingSecurityPools }} />

	const getUniverseBadge = (universeId: bigint, exists: boolean) => {
		if (universeId === activeUniverseId) return { label: commonCopy.selected, tone: 'warning' as const }
		if (exists) return { label: commonCopy.deployed, tone: 'ok' as const }
		return { label: commonCopy.notDeployed, tone: 'muted' as const }
	}
	const activeUniversePoolMetrics = getUniversePoolMetrics(zoltarUniverse.universeId, securityPools)

	return (
		<div className='route-view-flow'>
			<SectionBlock variant='plain'>
				<UniverseContextSummary universe={zoltarUniverse}>
					<p className='decision-amount'>
						<CurrencyValue value={activeUniversePoolMetrics.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
					</p>
					<p className='detail'>{securityPoolCopy.totalPoolHeldAttoRep}</p>
					<p className='inline-facts'>
						<span>{securityPoolCopy.universePoolCount(activeUniversePoolMetrics.poolCount)}</span>
						<span>{securityPoolCopy.universeVaultCount(activeUniversePoolMetrics.vaultCount)}</span>
					</p>
				</UniverseContextSummary>
			</SectionBlock>

			<SectionBlock title={securityPoolCopy.childUniversesTitle} variant='plain'>
				{zoltarUniverse.childUniverses.length === 0 ? (
					<StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.universe, badgeTone: 'muted', detail: securityPoolCopy.childUniversesEmptyDetail }} />
				) : (
					<div className='entity-card-list decision-card-list'>
						{zoltarUniverse.childUniverses.map(childUniverse => {
							const badge = getUniverseBadge(childUniverse.universeId, childUniverse.exists)
							const childUniversePoolMetrics = getUniversePoolMetrics(childUniverse.universeId, securityPools)
							return (
								<EntityCard
									key={childUniverse.universeId.toString()}
									headerActions={
										childUniverse.universeId === activeUniverseId || !childUniverse.exists ? undefined : (
											<UniverseLink className='button-link secondary-link' universeId={childUniverse.universeId}>
												{commonCopy.select}
											</UniverseLink>
										)
									}
									badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
									title={childUniverse.outcomeLabel}
									variant='record'
								>
									<div className='decision-summary'>
										<p className='decision-amount'>
											<CurrencyValue value={childUniversePoolMetrics.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
										</p>
										<p className='detail'>{securityPoolCopy.totalPoolHeldAttoRep}</p>
										<p className='inline-facts'>
											<span>{securityPoolCopy.universePoolCount(childUniversePoolMetrics.poolCount)}</span>
											<span>{securityPoolCopy.universeVaultCount(childUniversePoolMetrics.vaultCount)}</span>
										</p>
										<ReadOnlyDetailAccordion title={universeCopy.universeDetails}>
											{childUniverse.reputationTokenSymbol === undefined ? undefined : <MetricField label={commonCopy.reputationToken}>{childUniverse.reputationTokenSymbol}</MetricField>}
											<MetricField label={commonCopy.universe}>{formatUniverseLabel(childUniverse.universeId)}</MetricField>
											<MetricField label={marketCopy.parentUniverse}>
												<UniverseLink universeId={childUniverse.parentUniverseId} />
											</MetricField>
										</ReadOnlyDetailAccordion>
									</div>
								</EntityCard>
							)
						})}
					</div>
				)}
			</SectionBlock>
		</div>
	)
}
