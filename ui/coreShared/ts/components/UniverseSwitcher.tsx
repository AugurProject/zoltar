import * as universeCopy from '../copy/universes.js'
import { formatUniverseViewLabel } from '../lib/universeLineage.js'
import { buildRouteHref, parseRouteHash } from '../navigation/routing.js'
import { writeUniverseQueryParam } from '../navigation/urlParams.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { UniverseIdentity } from './UniverseIdentity.js'

type UniverseSwitcherProps = {
	activeUniverseId: bigint
	includeRelatedUniverses?: boolean
	browseHref: string
	universe: Pick<ZoltarUniverseSummary, 'outcomeLabel' | 'lineage' | 'universeId' | 'relatedUniversesLoaded'> | undefined
}

/** The active universe links directly to its browser, where users select another universe. */
export function UniverseSwitcher({ activeUniverseId, browseHref, universe, includeRelatedUniverses = universe?.relatedUniversesLoaded !== false }: UniverseSwitcherProps) {
	const loadedUniverse = universe?.universeId === activeUniverseId ? universe : undefined
	const universeLabel = formatUniverseViewLabel(loadedUniverse, activeUniverseId, includeRelatedUniverses)
	const destination = parseRouteHash(browseHref)
	const href = buildRouteHref(destination.routeHash, writeUniverseQueryParam(destination.search, activeUniverseId))
	return (
		<a className='universe-switcher' href={href} aria-label={universeCopy.formatSwitcherAriaLabel(universeLabel)} title={universeLabel}>
			<UniverseIdentity universeId={activeUniverseId} variant='swatch' />
			<span className='universe-switcher-label'>{universeLabel}</span>
		</a>
	)
}
