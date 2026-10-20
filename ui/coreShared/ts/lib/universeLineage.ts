import * as universeCopy from '../copy/universes.js'
import { formatRootUniverseName, formatShortUniverseId } from './universeLabels.js'

/** One generation of a universe's ancestry: the universe and the fork outcome that created it (genesis has none). */
export type UniverseLineageStep = Readonly<{
	outcomeLabel: string | undefined
	universeId: bigint
}>

/** The minimum universe facts needed to name a universe, its ancestors, and its children by lineage. */
export type UniverseLineageSource = Readonly<{
	outcomeLabel?: string | undefined
	childUniverses: readonly Readonly<{ outcomeLabel: string; universeId: bigint }>[]
	lineage?: readonly UniverseLineageStep[] | undefined
	universeId: bigint
}>

const LINEAGE_SEPARATOR = ' › '

/** Names one lineage generation: the selected root, the fork outcome, or the short universe ID when the outcome is unknown. */
export function formatUniverseStepName(step: UniverseLineageStep) {
	if (step.universeId === 0n) return formatRootUniverseName()
	const outcomeLabel = step.outcomeLabel?.trim()
	return outcomeLabel === undefined || outcomeLabel === '' ? formatShortUniverseId(step.universeId) : outcomeLabel
}

function isCompleteLineage(lineage: readonly UniverseLineageStep[], universeId: bigint) {
	const first = lineage[0]
	const last = lineage[lineage.length - 1]
	return first !== undefined && last !== undefined && first.universeId === 0n && last.universeId === universeId
}

/**
 * Names a universe by its fork ancestry, such as `Augur v2 › Yes › No`.
 * Without a complete lineage it falls back to the selected root name or a short hex ID.
 */
export function formatUniverseLineageLabel(lineage: readonly UniverseLineageStep[] | undefined, universeId: bigint) {
	if (universeId === 0n) return formatRootUniverseName()
	if (lineage === undefined || !isCompleteLineage(lineage, universeId)) return universeCopy.formatUnknownLineageUniverse(formatShortUniverseId(universeId))
	return lineage.map(formatUniverseStepName).join(LINEAGE_SEPARATOR)
}

/** Summary views name one generation even when a cached migration read includes its ancestry. */
export function formatUniverseViewLabel(universe: Pick<UniverseLineageSource, 'outcomeLabel' | 'lineage'> | undefined, universeId: bigint, includeRelatedUniverses: boolean) {
	if (includeRelatedUniverses || universeId === 0n) return formatUniverseLineageLabel(universe?.lineage, universeId)
	const currentStep = universe?.lineage?.at(-1)
	const outcomeLabel = universe?.outcomeLabel?.trim() || (currentStep?.universeId === universeId ? currentStep.outcomeLabel?.trim() : undefined)
	return outcomeLabel || formatUniverseLineageLabel(undefined, universeId)
}

/** The lineage of a universe's child: the parent's lineage plus the fork outcome the child represents. */
export function extendUniverseLineage(lineage: readonly UniverseLineageStep[] | undefined, child: UniverseLineageStep): readonly UniverseLineageStep[] | undefined {
	if (lineage === undefined) return undefined
	return [...lineage, child]
}

/** Lineage names for every universe the source knows about: its ancestors, itself, and its children, keyed by decimal universe ID. */
export function buildUniverseLineageLabels(source: UniverseLineageSource | undefined, includeRelatedUniverses = true): ReadonlyMap<string, string> {
	const labels = new Map<string, string>([['0', formatRootUniverseName()]])
	if (source === undefined) return labels
	if (!includeRelatedUniverses) {
		labels.set(source.universeId.toString(), formatUniverseViewLabel(source, source.universeId, false))
		return labels
	}
	const outcomeLabel = source.outcomeLabel?.trim()
	if (outcomeLabel && source.universeId !== 0n) labels.set(source.universeId.toString(), outcomeLabel)
	const lineage = source.lineage
	if (lineage !== undefined && isCompleteLineage(lineage, source.universeId)) {
		lineage.forEach((step, index) => {
			labels.set(step.universeId.toString(), formatUniverseLineageLabel(lineage.slice(0, index + 1), step.universeId))
		})
		for (const child of source.childUniverses) {
			labels.set(child.universeId.toString(), formatUniverseLineageLabel(extendUniverseLineage(lineage, { outcomeLabel: child.outcomeLabel, universeId: child.universeId }), child.universeId))
		}
	}
	return labels
}
