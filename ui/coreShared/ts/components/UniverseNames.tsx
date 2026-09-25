import { createContext, type ComponentChildren } from 'preact'
import { useContext, useMemo } from 'preact/hooks'
import { buildUniverseLineageLabels, formatUniverseLineageLabel, type UniverseLineageSource } from '../lib/universeLineage.js'

const UniverseNamesContext = createContext<ReadonlyMap<string, string> | undefined>(undefined)

/** Publishes lineage names for the active universe, its ancestors, and its children to every universe label below it. */
export function UniverseNamesProvider({ children, universe }: { children: ComponentChildren; universe: UniverseLineageSource | undefined }) {
	const names = useMemo(() => buildUniverseLineageLabels(universe), [universe])
	return <UniverseNamesContext.Provider value={names}>{children}</UniverseNamesContext.Provider>
}

/** The lineage name of a universe when the application knows it, otherwise `Genesis` or a short hex fallback. */
export function useUniverseName(universeId: bigint) {
	const names = useContext(UniverseNamesContext)
	return names?.get(universeId.toString()) ?? formatUniverseLineageLabel(undefined, universeId)
}

/** Inline universe name for prose and dense rows that should not link. */
export function UniverseName({ universeId }: { universeId: bigint }) {
	return <>{useUniverseName(universeId)}</>
}
