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
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { UniverseLink } from './UniverseLink.js'

type UniverseBrowserProps = {
	/** Actions that apply to the browsed universe, such as Fork or Migrate. Only pass actions that currently apply. */
	actions?: ComponentChildren
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
				{lineage.map((step, index) => (
					<li key={step.universeId.toString()}>{index === lineage.length - 1 ? <span aria-current='location'>{formatUniverseStepName(step)}</span> : <UniverseLink universeId={step.universeId}>{formatUniverseStepName(step)}</UniverseLink>}</li>
				))}
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
							<ReadOnlyDetailAccordion title={universeCopy.universeDetails}>
								{childUniverse.reputationTokenSymbol === undefined ? undefined : <MetricField label={commonCopy.reputationToken}>{childUniverse.reputationTokenSymbol}</MetricField>}
								<MetricField label={universeCopy.universeId}>
									<span className='universe-id-value'>{formatUniverseIdHex(childUniverse.universeId)}</span>
								</MetricField>
							</ReadOnlyDetailAccordion>
						</div>
					</EntityCard>
				)
			})}
		</div>
	)
}

/**
 * Browses the universe tree around one universe: its lineage back to Genesis, whether it has forked, and the child
 * universes its fork created. Opening an ancestor or child changes the shared `universe` query parameter.
 */
export function UniverseBrowser({ actions, activeUniverseId, children, renderChildSummary, universe }: UniverseBrowserProps) {
	const lineage = resolveLineage(universe)
	const currentStep = lineage[lineage.length - 1]
	// The lineage trail already names the ancestors, so the heading names only this generation.
	const universeName = lineage.length > 1 && currentStep !== undefined ? formatUniverseStepName(currentStep) : formatUniverseLineageLabel(universe.lineage, universe.universeId)
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
					<ReadOnlyDetailAccordion title={universeCopy.universeDetails}>
						<MetricField label={universeCopy.universeId}>
							<span className='universe-id-value'>{formatUniverseIdHex(universe.universeId)}</span>
						</MetricField>
						<MetricField label={universeCopy.parentUniverse}>{universe.universeId === 0n ? commonCopy.none : <UniverseLink universeId={universe.parentUniverseId} />}</MetricField>
						<MetricField label={universe.reputationTokenName ?? universeCopy.repSupply}>
							<CurrencyValue value={universe.totalTheoreticalSupplyAttoRep} suffix={universe.reputationTokenSymbol ?? commonCopy.rep} />
						</MetricField>
					</ReadOnlyDetailAccordion>
				</div>
			</SectionBlock>
			<SectionBlock title={commonCopy.childUniverses} variant='plain'>
				<ChildUniverseRecords activeUniverseId={activeUniverseId} renderChildSummary={renderChildSummary} universe={universe} />
			</SectionBlock>
		</div>
	)
}
