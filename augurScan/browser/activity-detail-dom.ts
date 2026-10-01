export interface TransactionDialogSnapshot {
	expandedKeys: string[]
	anchorKey?: string | undefined
	anchorTop?: number | undefined
	focusKey?: string | undefined
	focusIndex: number
	outsideFocus?: string | undefined
	scrollTop?: number | undefined
}

const activityDetailAnchorIndex = (rowKeys: readonly string[], triggerKey: string | undefined): number | undefined => {
	if (triggerKey === undefined) return undefined
	const index = rowKeys.indexOf(triggerKey)
	return index >= 0 ? index : undefined
}

interface ActivityDetailRowLike {
	after(node: unknown): void
	dataset: DOMStringMap
}

interface ActivityDetailFeedLike {
	querySelectorAll(selectors: string): ArrayLike<ActivityDetailRowLike>
}

interface ActivityDetailDrawerLike {
	dataset: DOMStringMap
}

export const placeActivityDetailDrawer = (feed: ActivityDetailFeedLike, drawer: ActivityDetailDrawerLike): boolean => {
	const rows = Array.from(feed.querySelectorAll('.log-row[data-live-key]'))
	const rowKeys = rows.flatMap(row => (row.dataset['liveKey'] === undefined ? [] : [row.dataset['liveKey']]))
	const anchorIndex = activityDetailAnchorIndex(rowKeys, drawer.dataset['triggerKey'])
	const anchor = anchorIndex === undefined ? undefined : rows[anchorIndex]
	if (anchor === undefined) return false
	anchor.after(drawer)
	return true
}

export interface ActivityDetailFocusSnapshot {
	drawerFocused: boolean
	focusIndex: number
	focusKey?: string | undefined
	focusKeyOccurrence?: number | undefined
	focusTop?: number | undefined
}

interface ActivityDetailFocusableLike {
	readonly tagName: string
	readonly textContent: string | null
	getAttribute(name: string): string | null
	getBoundingClientRect(): { readonly top: number }
	focus(options?: FocusOptions): void
}

interface ActivityDetailFocusDrawerLike extends ActivityDetailFocusableLike {
	querySelectorAll(selectors: string): ArrayLike<ActivityDetailFocusableLike>
}

const activityDetailFocusable = (drawer: ActivityDetailFocusDrawerLike): ActivityDetailFocusableLike[] => Array.from(drawer.querySelectorAll('a, button, summary'))

const activityDetailFocusKey = (node: ActivityDetailFocusableLike): string => `${node.tagName}:${node.tagName === 'A' ? (node.getAttribute('href') ?? '') : ''}:${node.getAttribute('aria-label') ?? node.textContent ?? ''}`

export const captureActivityDetailFocus = (drawer: ActivityDetailFocusDrawerLike, activeElement: unknown): ActivityDetailFocusSnapshot => {
	const focusable = activityDetailFocusable(drawer)
	let focusIndex = -1
	for (const [index, candidate] of focusable.entries()) {
		if (candidate !== activeElement) continue
		focusIndex = index
		break
	}
	const focused = focusIndex < 0 ? undefined : focusable[focusIndex]
	const focusKey = focused === undefined ? undefined : activityDetailFocusKey(focused)
	return {
		drawerFocused: activeElement === drawer,
		focusIndex,
		focusKey,
		focusKeyOccurrence: focusKey === undefined ? undefined : focusable.slice(0, focusIndex + 1).filter(candidate => activityDetailFocusKey(candidate) === focusKey).length - 1,
		focusTop: focused?.getBoundingClientRect().top,
	}
}

export const restoreActivityDetailFocus = (drawer: ActivityDetailFocusDrawerLike, snapshot: ActivityDetailFocusSnapshot, align?: (nextFocus: ActivityDetailFocusableLike, previousTop: number) => void): boolean => {
	if (snapshot.drawerFocused) {
		drawer.focus({ preventScroll: true })
		return true
	}
	if (snapshot.focusIndex < 0) return false
	const focusable = activityDetailFocusable(drawer)
	const keyedCandidates = snapshot.focusKey ? focusable.filter(candidate => activityDetailFocusKey(candidate) === snapshot.focusKey) : []
	const nextFocus = keyedCandidates[snapshot.focusKeyOccurrence ?? 0] ?? focusable[snapshot.focusIndex]
	if (nextFocus === undefined) return false
	if (snapshot.focusTop !== undefined) align?.(nextFocus, snapshot.focusTop)
	nextFocus.focus({ preventScroll: true })
	return true
}

interface ActivityDetailEscapeEvent {
	readonly key: string
	preventDefault(): void
	stopPropagation(): void
}

export const handleActivityDetailDrawerEscape = (event: ActivityDetailEscapeEvent, close: () => void): boolean => {
	if (event.key !== 'Escape') return false
	event.preventDefault()
	event.stopPropagation()
	close()
	return true
}

interface ActivityLogCountFeedLike {
	querySelectorAll(selectors: string): ArrayLike<unknown>
}

export const visibleActivityLogCount = (feed: ActivityLogCountFeedLike): number => feed.querySelectorAll('.log-row').length

interface DisclosureLike {
	dataset: DOMStringMap
	open?: boolean
}

interface DisclosureContainerLike {
	querySelectorAll(selectors: string): ArrayLike<DisclosureLike>
}

export const captureDisclosureState = (container: DisclosureContainerLike): Readonly<Record<string, boolean>> =>
	Object.fromEntries(Array.from(container.querySelectorAll('.detail-disclosure[data-disclosure-key]')).flatMap(item => (item.dataset['disclosureKey'] === undefined ? [] : [[item.dataset['disclosureKey'], item.open === true] as const])))

export const restoreDisclosureState = (container: DisclosureContainerLike, state: Readonly<Record<string, boolean>>): void => {
	for (const item of Array.from(container.querySelectorAll('.detail-disclosure[data-disclosure-key]'))) {
		const key = item.dataset['disclosureKey']
		if (key === undefined || state[key] === undefined) continue
		item.open = state[key]
	}
}

export const decodedActionLabel = (actionSummary: string | null, toAddress: string | null, contractLabel: string | null, emitterAddress?: string | null, deployedContractAddress?: string | null): string => {
	if (toAddress !== null) return actionSummary?.startsWith('Unknown call ') ? `${actionSummary.replace('Unknown call', 'Unrecognized function')} · no matching ABI` : (actionSummary ?? 'No decoded calldata')
	const verifiedLabel = contractLabel && emitterAddress && deployedContractAddress && emitterAddress.toLowerCase() === deployedContractAddress.toLowerCase() ? contractLabel : undefined
	return `Deploy ${verifiedLabel ?? 'contract'}`
}

export const urlWithoutLogDetail = (url: URL): URL => {
	const next = new URL(url)
	next.searchParams.delete('log')
	return next
}

export const reconcileTransactionDialogSnapshot = (snapshot: TransactionDialogSnapshot, availableKeys: ReadonlySet<string>): TransactionDialogSnapshot => ({
	...snapshot,
	expandedKeys: snapshot.expandedKeys.filter(key => key !== undefined && availableKeys.has(key)),
	anchorKey: snapshot.anchorKey !== undefined && availableKeys.has(snapshot.anchorKey) ? snapshot.anchorKey : undefined,
	focusKey: snapshot.focusKey !== undefined && availableKeys.has(snapshot.focusKey) ? snapshot.focusKey : undefined,
	focusIndex: snapshot.focusKey !== undefined && availableKeys.has(snapshot.focusKey) ? snapshot.focusIndex : -1,
})
