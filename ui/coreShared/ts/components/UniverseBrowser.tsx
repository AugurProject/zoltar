import type { ComponentChildren } from 'preact'
import * as commonCopy from '../copy/common.js'
import * as universeCopy from '../copy/universes.js'
import { formatUniverseIdHex } from '../lib/universeLabels.js'
import { formatUniverseLineageLabel, formatUniverseStepName, type UniverseLineageStep } from '../lib/universeLineage.js'
import type { BadgeTone } from '../types/components.js'
import type { ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '../types/contracts.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { MetricField } from './MetricField.js'
import { MetricGrid } from './MetricGrid.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { UniverseLink } from './UniverseLink.js'

type UniverseBrowserProps = {
	/** Actions that apply to the browsed universe, such as Fork or Migrate. Only pass actions that currently apply. */
	actions?: ComponentChildren
	navigation?: ComponentChildren
	activeUniverseId: bigint
	/** Application facts about the browsed universe, such as pool metrics or the fork question. */
	children?: ComponentChildren
	/** Application facts shown on each child universe record. */
	renderChildSummary?: ((childUniverse: ZoltarChildUniverseSummary) => ComponentChildren) | undefined
	universe: ZoltarUniverseSummary
}

function getChildBadge(childUniverse: ZoltarChildUniverseSummary, activeUniverseId: bigint): { label: string; tone: BadgeTone } {
	if (childUniverse.universeId === activeUniverseId) return { label: commonCopy.selected, tone: 'warning' }
	if (!childUniverse.exists) return { label: commonCopy.notDeployed, tone: 'muted' }
	if (childUniverse.forkTime > 0n) return { label: commonCopy.forked, tone: 'warning' }
	return { label: commonCopy.deployed, tone: 'ok' }
}

function resolveLineage(universe: ZoltarUniverseSummary): readonly UniverseLineageStep[] {
	const lineage = universe.lineage
	if (lineage !== undefined && lineage.length > 0) return lineage
	return [{ outcomeLabel: undefined, universeId: universe.universeId }]
}

function UniverseLineageTrail({ lineage }: { lineage: readonly UniverseLineageStep[] }) {
	if (lineage.length <= 1) return undefined
	return (
		<nav aria-label={universeCopy.lineageAriaLabel} className='universe-lineage'>
			<ol>
				{lineage.map((step, index) => {
					const name = formatUniverseStepName(step)
					if (index === lineage.length - 1)
						return (
							<li key={step.universeId.toString()}>
								<span aria-current='location'>{name}</span>
							</li>
						)
					return <li key={step.universeId.toString()}>{index === lineage.length - 2 ? <UniverseLink universeId={step.universeId}>{name}</UniverseLink> : <span>{name}</span>}</li>
				})}
			</ol>
		</nav>
	)
}

function ChildUniverseRecords({ activeUniverseId, renderChildSummary, universe }: Pick<UniverseBrowserProps, 'activeUniverseId' | 'renderChildSummary' | 'universe'>) {
	if (!universe.hasForked) return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.universe, badgeTone: 'muted', detail: universeCopy.childrenBeforeForkDetail }} />
	if (universe.childUniverses.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.universe, badgeTone: 'muted', detail: commonCopy.childUniversesEmpty }} />
	return (
		<div className='entity-card-list decision-card-list'>
			{universe.childUniverses.map(childUniverse => {
				const badge = getChildBadge(childUniverse, activeUniverseId)
				const canOpen = childUniverse.exists && childUniverse.universeId !== activeUniverseId
				return (
					<EntityCard
						key={childUniverse.universeId.toString()}
						badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
						headerActions={
							canOpen ? (
								<UniverseLink className='button-link secondary-link' universeId={childUniverse.universeId}>
									{universeCopy.openUniverse}
								</UniverseLink>
							) : undefined
						}
						title={childUniverse.outcomeLabel}
						variant='record'
					>
						<div className='decision-summary'>
							{renderChildSummary?.(childUniverse)}
							<MetricGrid columns={2}>
								{childUniverse.reputationTokenSymbol === undefined ? undefined : <MetricField label={commonCopy.reputationToken}>{childUniverse.reputationTokenSymbol}</MetricField>}
								<MetricField label={universeCopy.universeId}>
									<span className='universe-id-value'>{formatUniverseIdHex(childUniverse.universeId)}</span>
								</MetricField>
							</MetricGrid>
						</div>
					</EntityCard>
				)
			})}
		</div>
	)
}

/**
 * Browses the universe tree around one universe: its lineage back to Genesis, whether it has forked, and the child
 * universes its fork created. Opening the parent or a child changes the shared `universe` query parameter.
 */
export function UniverseBrowser({ actions, activeUniverseId, children, navigation, renderChildSummary, universe }: UniverseBrowserProps) {
	const lineage = resolveLineage(universe)
	const currentStep = lineage[lineage.length - 1]
	// The lineage trail already names the ancestors, so the heading names only this generation.
	const lineageName = lineage.length > 1 && currentStep !== undefined ? formatUniverseStepName(currentStep) : formatUniverseLineageLabel(universe.lineage, universe.universeId)
	const universeName = universe.outcomeLabel?.trim() || lineageName
	return (
		<div className='route-view-flow universe-browser'>
			<SectionBlock variant='plain'>
				<div className='decision-summary'>
					<UniverseLineageTrail lineage={lineage} />
					<div className='decision-heading'>
						<h3>{universeName}</h3>
						<Badge tone={universe.hasForked ? 'warning' : 'ok'}>{universe.hasForked ? commonCopy.forked : commonCopy.operational}</Badge>
					</div>
					{universe.hasForked && universe.forkTime > 0n ? (
						<p className='detail'>
							{universeCopy.forkedOnLabel} <TimestampValue timestamp={universe.forkTime} />
						</p>
					) : undefined}
					{actions === undefined ? undefined : <div className='actions'>{actions}</div>}
					{children}
					<MetricGrid columns={2}>
						<MetricField label={universeCopy.universeId}>
							<span className='universe-id-value'>{formatUniverseIdHex(universe.universeId)}</span>
						</MetricField>
						<MetricField label={universeCopy.parentUniverse}>{universe.universeId === 0n ? commonCopy.none : <UniverseLink universeId={universe.parentUniverseId} />}</MetricField>
						<MetricField label={universe.reputationTokenName ?? universeCopy.repSupply}>
							<CurrencyValue value={universe.totalTheoreticalSupplyAttoRep} suffix={universe.reputationTokenSymbol ?? commonCopy.rep} />
						</MetricField>
					</MetricGrid>
				</div>
			</SectionBlock>
			{universe.universeId === 0n ? undefined : (
				<div className='actions'>
					<UniverseLink className='button-link secondary-link' universeId={universe.parentUniverseId}>
						{universeCopy.parentUniverse}
					</UniverseLink>
				</div>
			)}
			{navigation}
			{universe.relatedUniversesLoaded === false ? undefined : (
				<SectionBlock title={commonCopy.childUniverses} variant='plain'>
					<ChildUniverseRecords activeUniverseId={activeUniverseId} renderChildSummary={renderChildSummary} universe={universe} />
				</SectionBlock>
			)}
		</div>
	)
}
