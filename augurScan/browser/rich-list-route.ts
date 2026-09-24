import type { LoadOptions, ProtocolAddressLinkOptions, RichListRecord } from './browser-types.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-update.ts'
import { isCurrentCanonicalGeneration, isCurrentContextRequest, paginatedSnapshotWasReplaced, paginationRequestAllowed, queuedPaginationPresentation, refreshPresentation, retainedPaginationAvailable } from './live-update.ts'
import { decodeItemsPage, isRichListRecord } from './api-decoding.ts'
import { renderRichListPage } from './rich-list-page.ts'

interface RichListRouteDeps {
	lookup: {
		(selector: '#rich-sort'): HTMLSelectElement
		(selector: '#richlist-more'): HTMLButtonElement
		(selector: string): HTMLElement
	}
	getPageUrl: () => URL
	selectedChainId: () => string
	requiredChainId: () => string
	isDemo: boolean
	setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	protocolAddressLink: (address: string | null, options?: ProtocolAddressLinkOptions) => HTMLAnchorElement
	nativeSymbol: (chainId?: string) => string
	number: (value: string | number | bigint | null | undefined) => string
	counted: (value: string | number | bigint | null | undefined, singular: string, plural?: string) => string
	openAccountTransactions: (item: RichListRecord) => Promise<boolean>
	canonicalState: CanonicalState
	getViewContextVersion: () => number
	api: (path: string) => Promise<unknown>
	refreshGate: RefreshGate
	renderRetryStatus: (status: HTMLElement, message: string, retry: () => Promise<boolean>) => void
	richListError: (detail: string, append: boolean, empty: boolean) => string
	errorMessage: (error: unknown) => string
	retryCanonicalViewOr: (fallback: () => Promise<boolean>) => Promise<boolean>
}

export const createRichListRoute = (deps: RichListRouteDeps) => {
	const { selectedChainId, requiredChainId, isDemo, setLiveRecord, element, protocolAddressLink, nativeSymbol, number, counted, openAccountTransactions, canonicalState, api, renderRetryStatus, richListError, errorMessage, retryCanonicalViewOr } = deps
	const $ = deps.lookup
	let richListItems: RichListRecord[] = []
	let richListTotal = 0
	let richListRequestVersion = 0
	let richListPaginationIntentVersion = 0
	const renderRichList = () =>
		renderRichListPage({
			lookup: $,
			pageUrl: deps.getPageUrl(),
			richListItems,
			richListTotal,
			selectedChainId,
			isDemo,
			setLiveRecord,
			element,
			protocolAddressLink,
			nativeSymbol,
			number,
			counted,
			openAccountTransactions,
			canonicalRefreshRequired: canonicalState.refreshRequired,
		})

	const performLoadRichList = async ({ append = false, live = false, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== deps.getViewContextVersion()) return false
		const canonicalGeneration = canonicalState.dataGeneration
		if (!paginationRequestAllowed(append, canonicalState.refreshRequired)) {
			$('#richlist-more').hidden = true
			$('#richlist-more').disabled = true
			return false
		}
		const requestVersion = ++richListRequestVersion
		const status = $('#richlist-status')
		const paginationStatus = $('#richlist-more-status')
		const more = $('#richlist-more')
		const nextOffset = append ? richListItems.length : 0
		const presentation = refreshPresentation({ live, append })
		if (presentation.loadingState) {
			if (append) {
				paginationStatus.hidden = false
				paginationStatus.className = 'system-status sr-only'
				paginationStatus.textContent = 'Loading more known addresses…'
				more.hidden = false
				more.setAttribute('aria-busy', 'true')
				more.textContent = 'Loading more…'
			} else {
				status.hidden = false
				status.textContent = richListItems.length === 0 ? 'Loading known addresses…' : 'Refreshing known addresses…'
			}
		}
		more.disabled = presentation.busy
		$('#rich-sort').disabled = presentation.busy
		$('#richlist-rows').setAttribute('aria-busy', String(presentation.busy))
		try {
			const fetchPage = async (offset: number, limit: number) => {
				const query = new URLSearchParams({ sort: $('#rich-sort').value, offset: String(offset), limit: String(limit) })
				query.set('chainId', requiredChainId())
				return decodeItemsPage(await api(`/api/v1/richlist?${query}`), isRichListRecord, 'Rich list')
			}
			const fetchSnapshot = async (requestedCount: number) => {
				const firstLimit = Math.min(100, requestedCount)
				const firstPage = await fetchPage(0, firstLimit)
				const targetCount = Math.min(requestedCount, firstPage.total ?? firstPage.items.length)
				const remainingOffsets = []
				for (let offset = firstLimit; offset < targetCount; offset += 100) remainingOffsets.push(offset)
				const remainingPages = await Promise.all(remainingOffsets.map(offset => fetchPage(offset, Math.min(100, targetCount - offset))))
				return { ...firstPage, items: [firstPage, ...remainingPages].flatMap(page => page.items).slice(0, targetCount) }
			}
			let replace = !append
			let result = append ? await fetchPage(nextOffset, 50) : await fetchSnapshot(Math.max(50, richListItems.length))
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, richListRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			if (append && paginatedSnapshotWasReplaced(richListItems.length, result.total ?? result.items.length)) {
				result = await fetchSnapshot(Math.max(1, richListItems.length))
				if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, richListRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
				replace = true
			}
			richListItems = replace ? result.items : [...richListItems, ...result.items]
			richListTotal = result.total ?? richListItems.length
			renderRichList()
			status.hidden = true
			paginationStatus.hidden = true
			paginationStatus.replaceChildren()
			return true
		} catch (error) {
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, richListRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			$('#richlist-rows').setAttribute('aria-busy', 'false')
			const failureStatus = append ? paginationStatus : status
			renderRetryStatus(failureStatus, richListError(errorMessage(error), append, richListItems.length === 0), () => retryCanonicalViewOr(() => loadRichList({ append })))
			more.hidden = !retainedPaginationAvailable(richListItems.length < richListTotal, canonicalState.refreshRequired)
			if (append) more.hidden = true
			if (richListItems.length === 0) $('#richlist-summary').textContent = ''
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, richListRequestVersion)) {
				more.disabled = canonicalState.refreshRequired
				if (canonicalState.refreshRequired) more.hidden = true
				$('#rich-sort').disabled = false
				more.removeAttribute('aria-busy')
				more.textContent = 'Show more'
			}
		}
	}

	const loadRichList = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = deps.getViewContextVersion()
		const paginationIntentVersion = options.append === true ? ++richListPaginationIntentVersion : undefined
		if (paginationIntentVersion !== undefined) {
			const more = $('#richlist-more')
			const presentation = queuedPaginationPresentation(canonicalState.refreshRequired)
			more.hidden = presentation.hidden
			more.disabled = presentation.disabled
			more.textContent = presentation.label
			if (presentation.busy) more.setAttribute('aria-busy', 'true')
			else more.removeAttribute('aria-busy')
			const paginationStatus = $('#richlist-more-status')
			paginationStatus.hidden = !presentation.busy
			paginationStatus.className = 'system-status sr-only'
			paginationStatus.textContent = presentation.busy ? 'Loading more known addresses…' : ''
		}
		const operation = () => performLoadRichList({ ...options, contextVersion })
		const request = options.live === true && options.append !== true ? deps.refreshGate.runBackground(operation) : deps.refreshGate.runForeground(operation)
		if (paginationIntentVersion !== undefined) {
			const clearPending = () => {
				if (paginationIntentVersion !== richListPaginationIntentVersion || contextVersion !== deps.getViewContextVersion()) return
				const more = $('#richlist-more')
				more.removeAttribute('aria-busy')
				more.textContent = 'Show more'
				more.disabled = canonicalState.refreshRequired
				if (canonicalState.refreshRequired) {
					$('#richlist-more-status').hidden = true
					$('#richlist-more-status').replaceChildren()
				}
			}
			void request.then(clearPending, clearPending)
		}
		return request
	}

	return {
		get items() {
			return richListItems
		},
		get total() {
			return richListTotal
		},
		renderRichList,
		loadRichList,
		invalidate() {
			richListRequestVersion++
		},
		clear() {
			richListItems = []
			richListTotal = 0
		},
	}
}
