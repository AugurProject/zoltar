import * as universeCopy from '../copy/universes.js'
import { formatUniverseViewLabel } from '../lib/universeLineage.js'
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
export function UniverseSwitcher({ activeUniverseId, browseHref, universe, includeRelatedUniverses = universe?.relatedUniversesLoaded !== false }: UniverseSwitcherProps) {
	const loadedUniverse = universe?.universeId === activeUniverseId ? universe : undefined
	const universeLabel = formatUniverseViewLabel(loadedUniverse, activeUniverseId, includeRelatedUniverses)
	const destination = parseRouteHash(browseHref)
	const href = buildRouteHref(destination.routeHash, writeUniverseQueryParam(destination.search, activeUniverseId))
	const forked = loadedUniverse?.hasForked === true
	return (
		<a className='universe-switcher' href={href} aria-label={forked ? universeCopy.formatForkedSwitcherAriaLabel(universeLabel) : universeCopy.formatSwitcherAriaLabel(universeLabel)} title={universeLabel}>
			<UniverseIdentity universeId={activeUniverseId} variant='swatch' />
			<span className='universe-switcher-label'>{universeLabel}</span>
			{forked ? (
				<Badge className='universe-switcher-badge' tone='warning'>
					{universeCopy.forked}
				</Badge>
			) : undefined}
		</a>
	)
}
