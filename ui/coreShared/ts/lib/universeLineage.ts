import * as universeCopy from '../copy/universes.js'
import { formatUniverseIdHex } from './universeLabels.js'

/** One generation of a universe's ancestry: the universe and the fork outcome that created it (genesis has none). */
export type UniverseLineageStep = Readonly<{
	outcomeLabel: string | undefined
	universeId: bigint
}>

/** The minimum universe facts needed to name a universe, its ancestors, and its children by lineage. */
export type UniverseLineageSource = Readonly<{
	childUniverses: readonly Readonly<{ outcomeLabel: string; universeId: bigint }>[]
	lineage?: readonly UniverseLineageStep[] | undefined
	universeId: bigint
}>

const LINEAGE_SEPARATOR = ' › '

/** Short, stable hex name for a universe whose fork outcome is unknown. */
export function formatShortUniverseId(universeId: bigint) {
	const universeIdHex = formatUniverseIdHex(universeId)
	if (universeIdHex.length <= 14) return universeIdHex
	return `${universeIdHex.slice(0, 8)}…${universeIdHex.slice(-4)}`
}

/** Names one lineage generation: Genesis, the fork outcome, or the short universe ID when the outcome is unknown. */
export function formatUniverseStepName(step: UniverseLineageStep) {
	if (step.universeId === 0n) return universeCopy.genesis
	const outcomeLabel = step.outcomeLabel?.trim()
	return outcomeLabel === undefined || outcomeLabel === '' ? formatShortUniverseId(step.universeId) : outcomeLabel
}

function isCompleteLineage(lineage: readonly UniverseLineageStep[], universeId: bigint) {
	const first = lineage[0]
	const last = lineage[lineage.length - 1]
	return first !== undefined && last !== undefined && first.universeId === 0n && last.universeId === universeId
}

/**
 * Names a universe by its fork ancestry, such as `Genesis › Yes › No`.
 * Without a complete lineage it falls back to `Genesis` or a short hex ID so the label never lies about ancestry.
 */
export function formatUniverseLineageLabel(lineage: readonly UniverseLineageStep[] | undefined, universeId: bigint) {
	if (universeId === 0n) return universeCopy.genesis
	if (lineage === undefined || !isCompleteLineage(lineage, universeId)) return universeCopy.formatUnknownLineageUniverse(formatShortUniverseId(universeId))
	return lineage.map(formatUniverseStepName).join(LINEAGE_SEPARATOR)
}

/** The lineage of a universe's child: the parent's lineage plus the fork outcome the child represents. */
export function extendUniverseLineage(lineage: readonly UniverseLineageStep[] | undefined, child: UniverseLineageStep): readonly UniverseLineageStep[] | undefined {
	if (lineage === undefined) return undefined
	return [...lineage, child]
}

/** Lineage names for every universe the source knows about: its ancestors, itself, and its children, keyed by decimal universe ID. */
export function buildUniverseLineageLabels(source: UniverseLineageSource | undefined): ReadonlyMap<string, string> {
	const labels = new Map<string, string>([['0', universeCopy.genesis]])
	if (source === undefined) return labels
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
