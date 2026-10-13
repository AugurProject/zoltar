import * as universeCopy from '../copy/universes.js'
import { formatUniverseLineageLabel, formatUniverseStepName, formatUniverseViewLabel } from '../lib/universeLineage.js'
import { buildRouteHref, parseRouteHash } from '../navigation/routing.js'
import { writeUniverseQueryParam } from '../navigation/urlParams.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { Badge } from './Badge.js'
import { UniverseIdentity } from './UniverseIdentity.js'

type UniverseSwitcherProps = {
	activeUniverseId: bigint
	includeRelatedUniverses?: boolean
	browseHref: string
	universe: (Pick<ZoltarUniverseSummary, 'outcomeLabel' | 'lineage' | 'universeId' | 'relatedUniversesLoaded'> & Partial<Pick<ZoltarUniverseSummary, 'hasForked'>>) | undefined
}

/** The active universe links directly to its browser, where users select another universe; a forked universe says so in the header on every route. */
export function UniverseSwitcher({ activeUniverseId, browseHref, universe, includeRelatedUniverses = true }: UniverseSwitcherProps) {
	const loadedUniverse = universe?.universeId === activeUniverseId ? universe : undefined
	let universeLabel = formatUniverseViewLabel(loadedUniverse, activeUniverseId, includeRelatedUniverses)
	let labelParts: { parent: string; leaf: string } | undefined
	if (includeRelatedUniverses && loadedUniverse !== undefined && activeUniverseId !== 0n) {
		const lineage = loadedUniverse.lineage
		const parentStep = lineage?.at(-2)
		const leafStep = lineage?.at(-1)
		if (lineage !== undefined && lineage[0]?.universeId === 0n && parentStep !== undefined && leafStep?.universeId === activeUniverseId) {
			labelParts = { parent: formatUniverseLineageLabel(lineage.slice(0, -1), parentStep.universeId), leaf: formatUniverseStepName(leafStep) }
		} else {
			const rootLabel = formatUniverseLineageLabel(undefined, 0n)
			labelParts = { parent: universeCopy.formatSwitcherContextRootLabel(rootLabel), leaf: formatUniverseViewLabel(loadedUniverse, activeUniverseId, false) }
			universeLabel = universeCopy.formatSwitcherContextLabel(rootLabel, labelParts.leaf)
		}
	}
	const destination = parseRouteHash(browseHref)
	const href = buildRouteHref(destination.routeHash, writeUniverseQueryParam(destination.search, activeUniverseId))
	const forked = loadedUniverse?.hasForked === true
	return (
		<a className='universe-switcher' href={href} aria-label={forked ? universeCopy.formatForkedSwitcherAriaLabel(universeLabel) : universeCopy.formatSwitcherAriaLabel(universeLabel)} title={universeLabel}>
			<UniverseIdentity universeId={activeUniverseId} variant='swatch' />
			<span className='universe-switcher-label'>
				{labelParts === undefined ? (
					universeLabel
				) : (
					<>
						<span className='universe-switcher-label-parent'>{labelParts.parent}</span>
						<span className='universe-switcher-label-leaf'>{labelParts.leaf}</span>
					</>
				)}
			</span>
			{forked ? (
				<Badge className='universe-switcher-badge' tone='warning'>
					{universeCopy.forked}
				</Badge>
			) : undefined}
		</a>
	)
}
