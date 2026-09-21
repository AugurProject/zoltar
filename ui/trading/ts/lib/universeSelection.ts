export type LiveUniverses = Readonly<{ ids: readonly bigint[]; selected: bigint | undefined }>

export type UniverseSelection = Readonly<{
	/** The universe discovery is asked for and the routes filter by: the request until discovery answers, then the confirmed choice. */
	requestedUniverseId: string | undefined
	/** The universe presented as current; undefined until discovery has confirmed one, so an unknown request never renders as a universe. */
	confirmedUniverseId: string | undefined
	/** When discovery could not honour the request, the value the `universe` query parameter is rewritten to so the URL agrees with the view. */
	replaceUrlUniverseId: bigint | undefined
}>

/** Reconciles the `universe` query parameter with what discovery found on the deployment. */
export function resolveUniverseSelection(urlUniverseId: bigint | undefined, liveUniverses: LiveUniverses): UniverseSelection {
	if (liveUniverses.ids.length === 0) return { requestedUniverseId: urlUniverseId?.toString(), confirmedUniverseId: undefined, replaceUrlUniverseId: undefined }
	if (urlUniverseId !== undefined && liveUniverses.ids.includes(urlUniverseId)) return { requestedUniverseId: urlUniverseId.toString(), confirmedUniverseId: urlUniverseId.toString(), replaceUrlUniverseId: undefined }
	const confirmed = liveUniverses.selected?.toString()
	return { requestedUniverseId: confirmed, confirmedUniverseId: confirmed, replaceUrlUniverseId: urlUniverseId === undefined ? undefined : liveUniverses.selected }
}
