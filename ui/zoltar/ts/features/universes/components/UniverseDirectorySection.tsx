import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseLink } from './UniverseLink.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { Address } from '@zoltar/shared/ethereum'
import { getChildDeploymentAvailabilityReason } from './ChildUniverseDeploymentSection.js'

type UniverseDirectorySectionProps = {
	activeUniverseId: bigint
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	onDeployChildUniverse: (outcomeIndex: bigint) => void
	pendingOutcomeIndex: bigint | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function UniverseDirectorySection({ activeUniverseId, accountAddress, isOnActiveAppChain, onDeployChildUniverse, pendingOutcomeIndex, zoltarUniverse }: UniverseDirectorySectionProps) {
	if (zoltarUniverse === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails }} />

	const getUniverseBadge = (universeId: bigint, exists: boolean) => {
		if (universeId === activeUniverseId) return { label: commonCopy.selected, tone: 'warning' as const }
		if (exists) return { label: commonCopy.deployed, tone: 'ok' as const }
		return { label: commonCopy.notDeployed, tone: 'muted' as const }
	}

	return (
		<div className='route-view-flow'>
			<SectionBlock variant='plain'>
				<DataGrid>
					<MetricField label={commonCopy.universe}>{formatUniverseLabel(zoltarUniverse.universeId)}</MetricField>
					<MetricField label={commonCopy.status}>{zoltarUniverse.hasForked ? commonCopy.forked : marketCopy.unforked}</MetricField>
					{zoltarUniverse.universeId === 0n ? <MetricField label={marketCopy.parentUniverse}>{commonCopy.none}</MetricField> : undefined}
					<MetricField label={commonCopy.rep}>
						<CurrencyValue value={zoltarUniverse.totalTheoreticalSupplyAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</DataGrid>
				{zoltarUniverse.forkQuestionDetails === undefined ? undefined : (
					<div className='loaded-question-preview'>
						<Question question={zoltarUniverse.forkQuestionDetails} variant='preview' />
					</div>
				)}
			</SectionBlock>

			<SectionBlock title={marketCopy.childUniverses} variant='plain'>
				{zoltarUniverse.childUniverses.length === 0 ? (
					<StateHint presentation={{ key: 'empty', badgeLabel: marketCopy.noChildUniverses, badgeTone: 'muted', detail: marketCopy.deployedChildUniversesEmpty }} />
				) : (
					<div className='entity-card-list'>
						{zoltarUniverse.childUniverses.map(childUniverse => {
							const badge = getUniverseBadge(childUniverse.universeId, childUniverse.exists)
							const deploymentReason = getChildDeploymentAvailabilityReason({ accountAddress, exists: childUniverse.exists, hasForked: zoltarUniverse.hasForked, isOnActiveAppChain })

							return (
								<EntityCard
									key={childUniverse.universeId.toString()}
									actions={
										childUniverse.exists ? undefined : (
											<TransactionActionButton
												idleLabel={marketCopy.deployUniverse}
												pendingLabel={marketCopy.deployingUniverse}
												pending={pendingOutcomeIndex === childUniverse.outcomeIndex}
												onClick={() => onDeployChildUniverse(childUniverse.outcomeIndex)}
												availability={{ disabled: pendingOutcomeIndex !== undefined || deploymentReason !== undefined, reason: deploymentReason }}
												showDisabledReason
											/>
										)
									}
									badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
									title={childUniverse.outcomeLabel}
									variant='record'
								>
									<DataGrid dense>
										<MetricField label={commonCopy.universe}>{childUniverse.exists ? <UniverseLink universeId={childUniverse.universeId}>{formatUniverseLabel(childUniverse.universeId)}</UniverseLink> : formatUniverseLabel(childUniverse.universeId)}</MetricField>
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
