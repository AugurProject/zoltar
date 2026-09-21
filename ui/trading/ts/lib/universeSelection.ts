/** What a discovery request was for, captured when it began, so its answer is attributed to that request and not to whatever the URL says when it lands. */
export type UniverseDiscoveryScope = Readonly<{ requestedUniverseId: bigint | undefined; addressedPool: string | undefined }>

export type LiveUniverses = Readonly<{
	ids: readonly bigint[]
	selected: bigint | undefined
	/** The `universe` parameter value that was current when this answer arrived; only that request may be rewritten from it. */
	forRequest: bigint | undefined
	/** The addressed pool whose market produced this answer; an addressed answer speaks only for that pool's route. */
	forPool: string | undefined
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
	/** The pool of an addressed route: its market's universe is authoritative there and the parameter follows it. */
	addressedPool: string | undefined
}>

/** Reconciles the `universe` query parameter with what discovery found on the deployment. */
export function resolveUniverseSelection(request: UniverseRequest, liveUniverses: LiveUniverses): UniverseSelection {
	const urlUniverseId = request.universeId
	if (liveUniverses.ids.length === 0) return { requestedUniverseId: urlUniverseId?.toString(), confirmedUniverseId: undefined, replaceUrlUniverseId: undefined }
	if (request.addressedPool !== undefined) {
		if (liveUniverses.forPool === request.addressedPool && liveUniverses.selected !== undefined) {
			// Genesis is the default, so an absent parameter only needs rewriting when the market lives elsewhere.
			const urlAgrees = urlUniverseId === liveUniverses.selected || (!request.present && liveUniverses.selected === 0n)
			return { requestedUniverseId: liveUniverses.selected.toString(), confirmedUniverseId: liveUniverses.selected.toString(), replaceUrlUniverseId: urlAgrees ? undefined : liveUniverses.selected }
		}
		// Another route's answer says nothing about this pool; wait for its own discovery.
		return { requestedUniverseId: urlUniverseId?.toString(), confirmedUniverseId: undefined, replaceUrlUniverseId: undefined }
	}
	if (urlUniverseId !== undefined && liveUniverses.ids.includes(urlUniverseId)) return { requestedUniverseId: urlUniverseId.toString(), confirmedUniverseId: urlUniverseId.toString(), replaceUrlUniverseId: undefined }
	// An addressed market's answer names only its own universe; a list route must wait for its own discovery rather than follow it.
	if (liveUniverses.forPool !== undefined) return { requestedUniverseId: urlUniverseId?.toString(), confirmedUniverseId: undefined, replaceUrlUniverseId: undefined }
	// An answer produced for another request (for example an addressed market's single universe, still held after
	// navigating back to a list route) confirms nothing for this one and must not rewrite its URL.
	if (liveUniverses.forRequest !== urlUniverseId) return { requestedUniverseId: urlUniverseId?.toString(), confirmedUniverseId: undefined, replaceUrlUniverseId: undefined }
	const confirmed = liveUniverses.selected?.toString()
	return { requestedUniverseId: confirmed, confirmedUniverseId: confirmed, replaceUrlUniverseId: request.present ? liveUniverses.selected : undefined }
}
