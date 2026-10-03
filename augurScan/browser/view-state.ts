import { captureActivityDetailFocus, restoreActivityDetailFocus, type ActivityDetailFocusSnapshot } from './activity-detail-dom.ts'

export interface ViewStateSnapshot {
	readonly focus: ActivityDetailFocusSnapshot | undefined
	readonly openDetails: ReadonlySet<string>
}

const disclosureKeys = (container: ParentNode): Array<readonly [HTMLDetailsElement, string]> => {
	const occurrences = new Map<string, number>()
	return [...container.querySelectorAll<HTMLDetailsElement>('details')].map(details => {
		const explicit = details.dataset['detailKey']
		if (explicit !== undefined) return [details, `key:${explicit}`] as const
		// Unkeyed disclosures are identified by their owning live record, their label, and their order among identical siblings.
		const base = `${details.closest<HTMLElement>('[data-live-key]')?.dataset['liveKey'] ?? ''}|${details.querySelector('summary')?.textContent ?? ''}`
		const occurrence = occurrences.get(base) ?? 0
		occurrences.set(base, occurrence + 1)
		return [details, `auto:${base}|${occurrence}`] as const
	})
}

/** Records the focused control and the open disclosures of a container that is about to be re-rendered. */
export const captureViewState = (container: HTMLElement): ViewStateSnapshot => ({
	focus: document.activeElement !== null && container.contains(document.activeElement) ? captureActivityDetailFocus(container, document.activeElement) : undefined,
	openDetails: new Set(disclosureKeys(container).flatMap(([details, key]) => (details.open ? [key] : []))),
})

/** Reopens the recorded disclosures and returns focus to the control that corresponds to the previously focused one. */
export const restoreViewState = (container: HTMLElement, snapshot: ViewStateSnapshot): void => {
	for (const [details, key] of disclosureKeys(container)) if (snapshot.openDetails.has(key)) details.open = true
	if (snapshot.focus !== undefined) restoreActivityDetailFocus(container, snapshot.focus)
}
