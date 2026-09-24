import type { ActivityRecord, DetailContextSnapshot, LoadOptions } from './browser-types.ts'
import type { ActivityRouteState } from './activity-route-state.ts'
import type { ActivityDetailState } from './activity-detail-state.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-update.ts'
import { collectCanonicalPages, isCurrentCanonicalGeneration, isCurrentContextRequest, paginationRequestAllowed, queuedPaginationPresentation, refreshPresentation, resolveActivityRefreshDepth, retainedPaginationAvailable, visibleActivityLogCount } from './live-update.ts'
import { decodeItemsPage, isActivityRecord } from './api-decoding.ts'
import { logKeyFor } from './activity-row.ts'

interface ActivityRouteDeps {
	lookup: {
		(selector: '#event-filter' | '#address-filter'): HTMLInputElement
		(selector: '#more' | '#clear-filters' | '#filters button[type="submit"]'): HTMLButtonElement
		(selector: string): HTMLElement
	}
	feed: HTMLElement
	feedState: HTMLElement
	activityRoute: ActivityRouteState
	activityDetailState: ActivityDetailState
	canonicalState: CanonicalState
	getViewContextVersion: () => number
	requiredChainId: () => string
	selectedChainId: () => string
	api: (path: string, options?: { signal?: AbortSignal }) => Promise<unknown>
	rowFor: (log: ActivityRecord) => HTMLElement
	liveSnapshot: (container: ParentNode, selector?: string) => Map<string, string>
	applyLiveChanges: (container: ParentNode, previous: ReadonlyMap<string, string>, options?: { live?: boolean; selector?: string }) => { added: number; changed: number }
	eventDrawers: () => HTMLElement[]
	captureDetailContext: (drawer: HTMLElement) => DetailContextSnapshot
	placeEventDrawer: (drawer: HTMLElement, options?: { allowOutsideShellFallback?: boolean }) => boolean
	updateLogDisclosures: () => void
	restoreDetailContext: (snapshot: DetailContextSnapshot, drawer?: HTMLElement) => void
	clearDetailUrl: () => void
	getRequestRouteRefresh: () => (count?: number, force?: boolean) => Promise<boolean>
	renderRetryStatus: (status: HTMLElement, message: string, retry: () => Promise<boolean>) => void
	errorMessage: (error: unknown) => string
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	logRefreshGate: RefreshGate
}

export const createActivityRoute = (deps: ActivityRouteDeps) => {
	const {
		feed,
		feedState,
		activityRoute,
		activityDetailState,
		canonicalState,
		requiredChainId,
		selectedChainId,
		api,
		rowFor,
		liveSnapshot,
		applyLiveChanges,
		eventDrawers,
		captureDetailContext,
		placeEventDrawer,
		updateLogDisclosures,
		restoreDetailContext,
		clearDetailUrl,
		renderRetryStatus,
		errorMessage,
		element,
		logRefreshGate,
	} = deps
	const $ = deps.lookup
	const queryPath = (cursor: string, limit = 100) => {
		const params = new URLSearchParams({ limit: String(limit) })
		params.set('chainId', requiredChainId())
		if (activityRoute.appliedFilters.event) params.set('event', activityRoute.appliedFilters.event)
		if (activityRoute.appliedFilters.address) params.set('address', activityRoute.appliedFilters.address)
		if (cursor) params.set('cursor', cursor)
		return `/api/v1/logs?${params}`
	}

	const activityFilterValues = () => ({
		event: $('#event-filter').value.trim(),
		address: $('#address-filter').value.trim(),
	})

	const syncActivityFilterUrl = () => {
		const url = new URL(location.href)
		url.searchParams.delete('decoded')
		for (const [name, value] of Object.entries(activityRoute.appliedFilters)) {
			if (typeof value === 'string' && value !== '') url.searchParams.set(name, value)
			else url.searchParams.delete(name)
		}
		const chainId = selectedChainId()
		if (chainId) url.searchParams.set('chainId', chainId)
		else url.searchParams.delete('chainId')
		history.replaceState(null, '', url)
	}

	const validateAddressFilter = (report = false) => {
		const input = $('#address-filter')
		const value = input.value.trim()
		input.setCustomValidity(value === '' || /^0x[0-9a-fA-F]{40}$/.test(value) ? '' : 'Enter a complete 20-byte EVM address (0x plus 40 hexadecimal characters).')
		return report ? input.reportValidity() : input.validity.valid
	}

	const showInvalidAddressFilter = () => {
		feed.replaceChildren()
		feed.setAttribute('aria-busy', 'false')
		feedState.hidden = false
		feedState.textContent = $('#address-filter').validationMessage
		$('#activity-summary').textContent = 'Invalid address filter'
		$('#more').hidden = true
		setLogControlsBusy(false)
	}

	const hasActivityFilters = () => Object.values(activityFilterValues()).some(Boolean)

	const setLogControlsBusy = (busy: boolean) => {
		for (const control of [$('#filters button[type="submit"]'), $('#more')]) control.disabled = busy
		$('#clear-filters').disabled = busy || !hasActivityFilters()
	}

	const performLoadLogs = async ({ append = false, live = false, replaceDepth, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== deps.getViewContextVersion()) return false
		const canonicalGeneration = canonicalState.dataGeneration
		if (!paginationRequestAllowed(append, canonicalState.refreshRequired)) {
			$('#more').hidden = true
			$('#more').disabled = true
			return false
		}
		activityRoute.abortController?.abort()
		activityRoute.abortController = new AbortController()
		const requestSignal = activityRoute.abortController?.signal
		const requestVersion = ++activityRoute.requestVersion
		const moreButton = $('#more')
		const paginationStatus = $('#activity-more-status')
		const hadRows = feed.querySelector<HTMLElement>('.log-row') !== null
		const previousRows = liveSnapshot(feed, '.log-row[data-live-key]')
		const presentation = refreshPresentation({ live, append })
		feed.setAttribute('aria-busy', String(presentation.busy))
		setLogControlsBusy(presentation.busy)
		if (append) {
			paginationStatus.hidden = true
			paginationStatus.replaceChildren()
			moreButton.hidden = false
			moreButton.setAttribute('aria-busy', 'true')
			moreButton.textContent = 'Loading more…'
		}
		if (!append && !hadRows) $('#more').hidden = true
		if (presentation.loadingState && !append) {
			feedState.hidden = false
			feedState.textContent = hadRows ? 'Refreshing activity…' : 'Loading activity…'
		}
		if (presentation.loadingState && !append && !hadRows) feed.replaceChildren(...Array.from({ length: 6 }, () => element('div', 'loading-line')))
		try {
			const payload =
				!append && replaceDepth !== undefined
					? await collectCanonicalPages(async (cursor, limit) => decodeItemsPage(await api(queryPath(cursor ?? '', limit), { signal: requestSignal }), isActivityRecord, 'Activity'), replaceDepth, logKeyFor)
					: decodeItemsPage(await api(queryPath(append ? (activityRoute.nextCursor ?? '') : '')), isActivityRecord, 'Activity')
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, activityRoute.requestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			const anchor = live && window.scrollY >= 420 ? [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].find(row => row.getBoundingClientRect().bottom > 0) : undefined
			const anchorKey = anchor?.dataset.liveKey
			const anchorTop = anchor?.getBoundingClientRect().top
			const renderScrollY = window.scrollY
			const retainedDrawers = append ? [] : eventDrawers()
			const activeDrawer = retainedDrawers.find(drawer => drawer.contains(document.activeElement)) ?? retainedDrawers[0]
			const activeDrawerContext = activeDrawer ? captureDetailContext(activeDrawer) : undefined
			if (!append) {
				for (const drawer of retainedDrawers) drawer.remove()
				feed.replaceChildren()
			}
			const refreshedKeys = new Set(append ? [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].flatMap(row => (row.dataset.liveKey === undefined ? [] : [row.dataset.liveKey])) : [])
			for (const log of payload.items) {
				const row = rowFor(log)
				const rowKey = row.dataset.liveKey
				if (rowKey !== undefined && refreshedKeys.has(rowKey)) continue
				if (rowKey !== undefined) refreshedKeys.add(rowKey)
				feed.append(row)
			}
			applyLiveChanges(feed, previousRows, { live, selector: '.log-row[data-live-key]' })
			for (const drawer of retainedDrawers) placeEventDrawer(drawer, { allowOutsideShellFallback: false })
			const drawerReanchored = activeDrawer?.isConnected ?? false
			updateLogDisclosures()
			if (activeDrawer && !drawerReanchored) {
				activityDetailState.detailContextVersion++
				activityDetailState.detailRequestVersion++
				activityDetailState.activeLog = undefined
				activityDetailState.pendingCanonicalLog = undefined
				if (canonicalState.recovery !== undefined) canonicalState.recovery.logToRefresh = undefined
				clearDetailUrl()
			}
			if (live) window.scrollTo({ top: renderScrollY, behavior: 'instant' })
			if (anchorKey !== undefined && anchorTop !== undefined) {
				const currentAnchor = [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].find(row => row.dataset.liveKey === anchorKey)
				if (currentAnchor !== undefined) window.scrollBy(0, currentAnchor.getBoundingClientRect().top - anchorTop)
			}
			if (drawerReanchored && activeDrawerContext) restoreDetailContext(activeDrawerContext, activeDrawer)
			activityRoute.nextCursor = payload.nextCursor
			$('#more').hidden = !retainedPaginationAvailable(activityRoute.nextCursor !== undefined, canonicalState.refreshRequired)
			paginationStatus.hidden = true
			paginationStatus.replaceChildren()
			const visibleCount = visibleActivityLogCount(feed)
			feedState.hidden = visibleCount > 0
			if (visibleCount === 0) feedState.textContent = 'No project logs match these filters yet.'
			$('#activity-summary').textContent = visibleCount === 0 ? '' : `${visibleCount} log${visibleCount === 1 ? '' : 's'} shown`
			return true
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') return false
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, activityRoute.requestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			if (!append && !hadRows) feed.replaceChildren()
			$('#more').hidden = !retainedPaginationAvailable(activityRoute.nextCursor !== undefined, canonicalState.refreshRequired)
			const retryAction = () => (canonicalState.refreshRequired ? deps.getRequestRouteRefresh()(1, true) : loadLogs({ append }))
			if (append) {
				const visibleCount = visibleActivityLogCount(feed)
				feedState.hidden = visibleCount > 0
				$('#activity-summary').textContent = `${visibleCount} logs shown · could not load more`
				renderRetryStatus(paginationStatus, `Could not load more activity; showing logs: ${errorMessage(error)}`, retryAction)
				moreButton.hidden = true
			} else {
				feedState.hidden = false
				const message = element('span', '', hadRows ? `Showing last known activity: ${errorMessage(error)}` : `Activity unavailable: ${errorMessage(error)}`)
				const visibleCount = visibleActivityLogCount(feed)
				$('#activity-summary').textContent = hadRows ? `${visibleCount} logs shown · refresh failed` : ''
				const retry = element('button', 'state-retry', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', retryAction)
				feedState.replaceChildren(message, retry)
			}
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, activityRoute.requestVersion)) {
				feed.setAttribute('aria-busy', 'false')
				setLogControlsBusy(false)
				if (canonicalState.refreshRequired) {
					moreButton.hidden = true
					moreButton.disabled = true
				}
				moreButton.removeAttribute('aria-busy')
				moreButton.textContent = 'Show more'
			}
		}
	}

	const loadLogs = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = deps.getViewContextVersion()
		const paginationIntentVersion = options.append === true ? ++activityRoute.paginationIntentVersion : undefined
		if (paginationIntentVersion !== undefined) {
			const more = $('#more')
			const presentation = queuedPaginationPresentation(canonicalState.refreshRequired)
			more.hidden = presentation.hidden
			more.disabled = presentation.disabled
			more.textContent = presentation.label
			if (presentation.busy) more.setAttribute('aria-busy', 'true')
			else more.removeAttribute('aria-busy')
			$('#activity-more-status').hidden = true
			$('#activity-more-status').replaceChildren()
		}
		const operation = () => {
			const { retainVisibleDepth, ...loadOptions } = options
			const replaceDepth = retainVisibleDepth ? resolveActivityRefreshDepth(loadOptions.replaceDepth, activityDetailState.pendingCanonicalActivityCount, feed.querySelectorAll<HTMLElement>('.log-row').length) : loadOptions.replaceDepth
			return performLoadLogs({ ...loadOptions, replaceDepth, contextVersion })
		}
		const request = options.live === true ? logRefreshGate.runBackground(operation) : logRefreshGate.runForeground(operation)
		if (paginationIntentVersion !== undefined) {
			const clearPending = () => {
				if (paginationIntentVersion !== activityRoute.paginationIntentVersion || contextVersion !== deps.getViewContextVersion()) return
				const more = $('#more')
				more.removeAttribute('aria-busy')
				more.textContent = 'Show more'
				more.disabled = canonicalState.refreshRequired
				if (canonicalState.refreshRequired) more.hidden = true
			}
			void request.then(clearPending, clearPending)
		}
		return request
	}

	return { queryPath, activityFilterValues, syncActivityFilterUrl, validateAddressFilter, showInvalidAddressFilter, hasActivityFilters, setLogControlsBusy, loadLogs }
}
