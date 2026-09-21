export type LiveUniverses = Readonly<{
	ids: readonly bigint[]
	selected: bigint | undefined
	/** The `universe` parameter value that was current when this answer arrived; only that request may be rewritten from it. */
	forRequest: bigint | undefined
}>

export type UniverseSelection = Readonly<{
	/** The universe discovery is asked for and the routes filter by: the request until discovery answers, then the confirmed choice. */
	requestedUniverseId: string | undefined
	/** The universe presented as current; undefined until discovery has confirmed one, so an unknown request never renders as a universe. */
	confirmedUniverseId: string | undefined
	/** When discovery could not honour the request, the value the `universe` query parameter is rewritten to so the URL agrees with the view. */
	replaceUrlUniverseId: bigint | undefined
}>

export type UniverseRequest = Readonly<{
	/** The parsed `universe` parameter; undefined when absent or malformed. */
	universeId: bigint | undefined
	/** Whether a `universe` parameter is present at all, so a malformed value is rewritten like an unknown one. */
	present: boolean
	/** An addressed pool route: the market's own universe is authoritative and the parameter follows it. */
	addressed: boolean
}>

/** Reconciles the `universe` query parameter with what discovery found on the deployment. */
export function resolveUniverseSelection(request: UniverseRequest, liveUniverses: LiveUniverses): UniverseSelection {
	const urlUniverseId = request.universeId
	if (liveUniverses.ids.length === 0) return { requestedUniverseId: urlUniverseId?.toString(), confirmedUniverseId: undefined, replaceUrlUniverseId: undefined }
	if (request.addressed && liveUniverses.selected !== undefined) {
		// Genesis is the default, so an absent parameter only needs rewriting when the market lives elsewhere.
		const urlAgrees = urlUniverseId === liveUniverses.selected || (!request.present && liveUniverses.selected === 0n)
		return { requestedUniverseId: liveUniverses.selected.toString(), confirmedUniverseId: liveUniverses.selected.toString(), replaceUrlUniverseId: urlAgrees ? undefined : liveUniverses.selected }
	}
	if (urlUniverseId !== undefined && liveUniverses.ids.includes(urlUniverseId)) return { requestedUniverseId: urlUniverseId.toString(), confirmedUniverseId: urlUniverseId.toString(), replaceUrlUniverseId: undefined }
	// An answer produced for another request (for example an addressed market's single universe, still held after
	// navigating back to a list route) confirms nothing for this one and must not rewrite its URL.
	if (liveUniverses.forRequest !== urlUniverseId) return { requestedUniverseId: urlUniverseId?.toString(), confirmedUniverseId: undefined, replaceUrlUniverseId: undefined }
	const confirmed = liveUniverses.selected?.toString()
	return { requestedUniverseId: confirmed, confirmedUniverseId: confirmed, replaceUrlUniverseId: request.present ? liveUniverses.selected : undefined }
}
