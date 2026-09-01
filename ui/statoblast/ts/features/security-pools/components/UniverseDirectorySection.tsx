import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js'
import { formatUniverseLabel } from '@zoltar/ui-zoltar/features/universes/lib/universe.js'
import type { ListedSecurityPool, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UniverseDirectorySectionProps = {
	activeUniverseId: bigint
	securityPools: ListedSecurityPool[]
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function UniverseDirectorySection({ activeUniverseId, securityPools, zoltarUniverse }: UniverseDirectorySectionProps) {
	if (zoltarUniverse === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails }} />

	const poolsInUniverse = securityPools.filter(pool => pool.universeId === activeUniverseId)
	const getUniverseBadge = (universeId: bigint, exists: boolean) => {
		if (universeId === activeUniverseId) return { label: commonCopy.selected, tone: 'warning' as const }
		if (exists) return { label: commonCopy.deployed, tone: 'ok' as const }
		return { label: commonCopy.notDeployed, tone: 'muted' as const }
	}

	return (
		<div className='route-view-flow'>
			<SectionBlock title={commonCopy.universe} variant='plain'>
				<DataGrid>
					<MetricField label={commonCopy.universe}>{formatUniverseLabel(zoltarUniverse.universeId)}</MetricField>
					<MetricField label={commonCopy.status}>{zoltarUniverse.hasForked ? commonCopy.forked : commonCopy.operational}</MetricField>
					<MetricField label={commonCopy.securityPools}>{poolsInUniverse.length}</MetricField>
					<MetricField label={commonCopy.rep}>
						<CurrencyValue value={zoltarUniverse.totalTheoreticalSupplyAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</DataGrid>
			</SectionBlock>

			<SectionBlock title={securityPoolCopy.childUniversesTitle} variant='plain'>
				{zoltarUniverse.childUniverses.length === 0 ? (
					<StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.universe, badgeTone: 'muted', detail: securityPoolCopy.childUniversesEmptyDetail }} />
				) : (
					<div className='entity-card-list'>
						{zoltarUniverse.childUniverses.map(childUniverse => {
							const childPoolCount = securityPools.filter(pool => pool.universeId === childUniverse.universeId).length
							const badge = getUniverseBadge(childUniverse.universeId, childUniverse.exists)
							return (
								<EntityCard
									key={childUniverse.universeId.toString()}
									actions={
										childUniverse.universeId === activeUniverseId ? undefined : (
											<UniverseLink className='secondary' universeId={childUniverse.universeId}>
												{commonCopy.select}
											</UniverseLink>
										)
									}
									badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
									title={childUniverse.outcomeLabel}
									variant='record'
								>
									<DataGrid dense>
										<MetricField label={commonCopy.universe}>{formatUniverseLabel(childUniverse.universeId)}</MetricField>
										<MetricField label={commonCopy.securityPools}>{childPoolCount}</MetricField>
										<MetricField label={securityPoolCopy.totalPoolHeldAttoRep}>
											<CurrencyValue value={securityPools.filter(pool => pool.universeId === childUniverse.universeId).reduce((total, pool) => total + pool.totalPoolHeldAttoRep, 0n)} suffix={commonCopy.rep} />
										</MetricField>
									</DataGrid>
								</EntityCard>
							)
						})}
					</div>
				)}
			</SectionBlock>
		</div>
	)
}
