/**
 * Same-document history for the hash-routed applications.
 *
 * Browsers fire popstate both for Back/Forward and for every fragment navigation (a link click or a `location.hash`
 * assignment), so popstate alone cannot tell a traversal from a new page. Each history entry therefore carries a key in
 * its state: a popstate that lands on another keyed entry is a traversal, and an entry without a key is a new page,
 * which is keyed in place.
 */

const ENTRY_KEY_PROPERTY = 'appHistoryEntryKey'

type LocationChangeListener = () => void

const locationChangeListeners = new Set<LocationChangeListener>()
let entryKeyCount = 0
let currentEntryKey: string | undefined
let traversedEntryKey: string | undefined
let redirectDepth = 0
let observedWindow: Window | undefined

function createEntryKey() {
	entryKeyCount += 1
	return `${Date.now().toString(36)}-${entryKeyCount.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function readEntryKey(state: unknown) {
	if (typeof state !== 'object' || state === null || !(ENTRY_KEY_PROPERTY in state)) return undefined
	const key = state[ENTRY_KEY_PROPERTY]
	return typeof key === 'string' ? key : undefined
}

function withEntryKey(state: unknown, key: string) {
	// Object state keeps its other fields; any other state is replaced, because only an object can carry the key.
	if (typeof state === 'object' && state !== null) return { ...state, [ENTRY_KEY_PROPERTY]: key }
	return { [ENTRY_KEY_PROPERTY]: key }
}

function keyCurrentEntry() {
	const existingKey = readEntryKey(window.history.state)
	if (existingKey !== undefined) return existingKey
	const key = createEntryKey()
	window.history.replaceState(withEntryKey(window.history.state, key), '')
	return key
}

function recordLocationChange(event: Event) {
	const key = readEntryKey(window.history.state)
	if (key === undefined) {
		// A link, a hash assignment, or a history write without a key opened a new page.
		currentEntryKey = keyCurrentEntry()
		traversedEntryKey = undefined
		return
	}
	if (key === currentEntryKey) return
	// Only Back and Forward report another entry that already has a key through popstate.
	if (event.type === 'popstate') traversedEntryKey = key
	currentEntryKey = key
}

function notifyLocationChange(event: Event) {
	recordLocationChange(event)
	// Every subscriber updates inside this one event callback, so route and search state that change together render once.
	for (const listener of [...locationChangeListeners]) listener()
}

function stopObservingWindow() {
	observedWindow?.removeEventListener('popstate', notifyLocationChange)
	observedWindow?.removeEventListener('hashchange', notifyLocationChange)
	observedWindow = undefined
}

function observeWindow() {
	if (observedWindow === window) return
	stopObservingWindow()
	observedWindow = window
	currentEntryKey = keyCurrentEntry()
	traversedEntryKey = undefined
	window.addEventListener('popstate', notifyLocationChange)
	window.addEventListener('hashchange', notifyLocationChange)
}

/**
 * Calls the listener after every same-document URL change the window reports: Back and Forward, link and hash
 * navigations, and the hashchange or popstate events dispatched after history writes.
 */
export function subscribeToLocationChanges(listener: LocationChangeListener) {
	observeWindow()
	locationChangeListeners.add(listener)
	return () => {
		locationChangeListeners.delete(listener)
		if (locationChangeListeners.size === 0) stopObservingWindow()
	}
}

/** Whether Back or Forward reached the current history entry, as opposed to a link or a programmatic navigation. */
export function isHistoryTraversal() {
	return traversedEntryKey !== undefined && traversedEntryKey === readEntryKey(window.history.state)
}

/** Rewrites the current history entry's URL; the entry keeps its state and identity. */
export function replaceHistoryUrl(url: string) {
	const key = readEntryKey(window.history.state) ?? createEntryKey()
	window.history.replaceState(withEntryKey(window.history.state, key), '', url)
	currentEntryKey = key
}

/** Adds a history entry for a same-document URL, or replaces the current entry while a redirect runs. */
export function pushHistoryUrl(url: string) {
	if (redirectDepth > 0) {
		replaceHistoryUrl(url)
		return
	}
	const key = createEntryKey()
	window.history.pushState(withEntryKey(undefined, key), '', url)
	currentEntryKey = key
}

/**
 * Runs a redirect: a navigation it performs through `pushHistoryUrl` replaces the current history entry instead of
 * adding one, so Back skips the address that was redirected away from instead of reopening it and redirecting again.
 */
export function redirectInPlace(navigate: () => void) {
	redirectDepth += 1
	try {
		navigate()
	} finally {
		redirectDepth -= 1
	}
}

/** Opens a same-document URL and tells route and search state about it; the current URL adds no history entry. */
export function navigateToUrl(url: string) {
	if (new URL(url, window.location.href).href === window.location.href) return
	pushHistoryUrl(url)
	// History writes do not fire hashchange; route and search state still have to observe the change.
	window.dispatchEvent(new Event('hashchange'))
}
