import type { ComponentChildren } from 'preact'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as universeCopy from '../../../copy/zoltar.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { formatUniverseLabel } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import type { BadgeTone } from '@zoltar/ui-core-shared/types/components.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { UniverseLink } from './UniverseLink.js'

type ChildUniverseListProps = {
	activeUniverseId: bigint
	childUniverses: readonly ZoltarChildUniverseSummary[]
	/** Application facts shown above the child's universe details, such as pool or market metrics. */
	renderSummary?: (childUniverse: ZoltarChildUniverseSummary) => ComponentChildren
}

function getChildUniverseBadge(childUniverse: ZoltarChildUniverseSummary, activeUniverseId: bigint): { label: string; tone: BadgeTone } {
	if (childUniverse.universeId === activeUniverseId) return { label: commonCopy.selected, tone: 'warning' }
	if (childUniverse.exists) return { label: commonCopy.deployed, tone: 'ok' }
	return { label: commonCopy.notDeployed, tone: 'muted' }
}

/** The child universes of a fork as selectable records: the outcome each one represents, whether it exists, and a Select action that sets the shared universe parameter. */
export function ChildUniverseList({ activeUniverseId, childUniverses, renderSummary }: ChildUniverseListProps) {
	return (
		<SectionBlock title={commonCopy.childUniverses} variant='plain'>
			{childUniverses.length === 0 ? (
				<StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.universe, badgeTone: 'muted', detail: commonCopy.childUniversesEmpty }} />
			) : (
				<div className='entity-card-list decision-card-list'>
					{childUniverses.map(childUniverse => {
						const badge = getChildUniverseBadge(childUniverse, activeUniverseId)
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
									{renderSummary?.(childUniverse)}
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
	)
}
