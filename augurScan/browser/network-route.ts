import type { NetworkRecord } from './browser-types.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { ScannerLiveState } from './scanner-live-state.ts'
import { decodeNetworkResponse } from './api-decoding.ts'
import { isCurrentCanonicalGeneration } from './live-refresh.ts'
import { nativeSymbolFor, unavailableNetworkNotice } from './network-freshness.ts'
import { applyNetworkSelection, unappliedNetworkChoice } from './network-selection.ts'

interface NetworkRouteDeps {
	lookup: (selector: string) => HTMLElement
	globalNetworkFilter: HTMLSelectElement
	networkCards: HTMLElement
	selectedChainId: () => string
	isDemo: boolean
	setPageUrl: (url: URL) => void
	liveState: ScannerLiveState
	canonicalState: CanonicalState
	api: (path: string) => Promise<unknown>
	writeSnapshot: (snapshot: { items: NetworkRecord[]; freshnessThresholdMs?: number; clientClockOffsetMs: number; writtenAt: number }) => void
	/** Called after the applied network changed; block numbers are kept only when no network had been applied yet. */
	resetSelectedNetworkContext: (options: { readonly keepBlockNumbers: boolean }) => void
	renderNetworks: (items: NetworkRecord[]) => void
	getLatestNetworks: () => NetworkRecord[]
	updateFreshness: () => void
	updateConnectionStatus: () => void
	loadRouteAfterNetworkChange: () => Promise<unknown>
}

export const createNetworkRoute = (deps: NetworkRouteDeps) => {
	const { globalNetworkFilter, networkCards, selectedChainId, isDemo, liveState, canonicalState, api, resetSelectedNetworkContext, renderNetworks, updateFreshness, updateConnectionStatus } = deps
	const $ = deps.lookup
	const syncNetworkUrl = () => {
		const url = new URL(location.href)
		const chainId = selectedChainId()
		if (chainId) url.searchParams.set('chainId', chainId)
		else url.searchParams.delete('chainId')
		// The periodic status poll calls this with an unchanged network; an unchanged URL and links are left alone.
		if (url.href !== location.href) history.replaceState(null, '', url)
		deps.setPageUrl(url)
		for (const link of document.querySelectorAll<HTMLAnchorElement>('.brand-block, .product-nav a, .operations-nav a')) {
			const destination = new URL(link.href)
			if (chainId) destination.searchParams.set('chainId', chainId)
			else destination.searchParams.delete('chainId')
			if (isDemo) destination.searchParams.set('demo', '1')
			if (link.href !== destination.href) link.href = destination.href
		}
	}

	const updateNetworkLabels = () => {
		const symbol = nativeSymbolFor(selectedChainId())
		$('#rich-native-sort-option').textContent = symbol
		$('#rich-native-heading').textContent = `${symbol} / WETH`
	}

	const showNetworkNotice = (message: string) => {
		const main = document.querySelector('main')
		if (main === null) return
		document.querySelector('#network-notice')?.remove()
		const notice = document.createElement('div')
		notice.id = 'network-notice'
		notice.className = 'system-status'
		notice.setAttribute('role', 'status')
		const text = document.createElement('span')
		text.textContent = message
		const dismiss = document.createElement('button')
		dismiss.type = 'button'
		dismiss.className = 'secondary compact'
		dismiss.textContent = 'Dismiss'
		dismiss.addEventListener('click', () => notice.remove())
		notice.append(text, dismiss)
		main.prepend(notice)
	}

	const reconcileNetworkOptions = (items: NetworkRecord[]) => {
		const selected = selectedChainId()
		const unappliedChoice = unappliedNetworkChoice(globalNetworkFilter)
		// Rebuilding unchanged options every poll would reset an open or keyboard-focused network picker.
		const optionsChanged = globalNetworkFilter.options.length !== items.length || items.some((network, index) => globalNetworkFilter.options[index]?.value !== String(network.chain_id) || globalNetworkFilter.options[index]?.text !== network.name)
		if (optionsChanged) globalNetworkFilter.replaceChildren(...items.map((network: { name: string; chain_id: string }) => new Option(network.name, network.chain_id)))
		const selectedIsIndexed = [...globalNetworkFilter.options].some(option => option.value === selected)
		applyNetworkSelection(globalNetworkFilter, selectedIsIndexed ? selected : String(items[0]?.chain_id ?? ''), unappliedChoice)
		const shown = items[0]
		if (selected !== '' && !selectedIsIndexed && shown !== undefined) showNetworkNotice(unavailableNetworkNotice(selected, shown.name))
		syncNetworkUrl()
		updateNetworkLabels()
	}

	const loadNetworks = async ({ synchronizeActivity = true, refreshAfterCurrent = false } = {}): Promise<boolean> => {
		if (liveState.networkLoadPromise !== undefined) {
			if (!refreshAfterCurrent) return await liveState.networkLoadPromise
			if (refreshAfterCurrent && liveState.networkFollowUpPromise !== undefined) return await liveState.networkFollowUpPromise
			const activeLoad = liveState.networkLoadPromise
			const followUp: Promise<boolean> = activeLoad
				.then(async () => {
					if (liveState.networkLoadPromise === activeLoad) liveState.networkLoadPromise = undefined
					return await loadNetworks({ synchronizeActivity })
				})
				.finally(() => {
					if (liveState.networkFollowUpPromise === followUp) liveState.networkFollowUpPromise = undefined
				})
			if (refreshAfterCurrent) liveState.networkFollowUpPromise = followUp
			return await followUp
		}
		const resumeGeneration = liveState.networkResumeGeneration
		if (liveState.awaitingResumedNetworkStatus) {
			liveState.lastNetworkRequestFailed = false
			renderNetworks(deps.getLatestNetworks())
			updateFreshness()
		}
		const canonicalGeneration = canonicalState.dataGeneration
		const run = (async () => {
			try {
				const { items, serverTime, freshnessThresholdMs } = decodeNetworkResponse(await api('/api/v1/networks'))
				if (!isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
				if (serverTime) liveState.serverClockOffsetMs = new Date(serverTime).getTime() - Date.now()
				deps.writeSnapshot({ items, ...(freshnessThresholdMs === undefined ? {} : { freshnessThresholdMs }), clientClockOffsetMs: liveState.serverClockOffsetMs, writtenAt: Date.now() })
				if (freshnessThresholdMs !== undefined && Number.isFinite(freshnessThresholdMs) && freshnessThresholdMs > 0) liveState.networkFreshnessThresholdMs = freshnessThresholdMs
				const previousNetwork = selectedChainId()
				reconcileNetworkOptions(items)
				// A page opened without a chain adopts the default network, which its block numbers were written for; any later change is a switch.
				if (previousNetwork !== selectedChainId()) resetSelectedNetworkContext({ keepBlockNumbers: previousNetwork === '' })
				if (resumeGeneration === liveState.networkResumeGeneration) liveState.awaitingResumedNetworkStatus = false
				liveState.lastNetworkRequestFailed = false
				renderNetworks(items)
				updateFreshness()
				updateConnectionStatus()
				if (synchronizeActivity && previousNetwork !== selectedChainId()) await deps.loadRouteAfterNetworkChange()
				return true
			} catch (error) {
				if (!isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
				console.error(`Network status refresh failed (${error instanceof Error ? error.name : typeof error})`)
				liveState.lastNetworkRequestFailed = true
				if (liveState.awaitingResumedNetworkStatus) renderNetworks(deps.getLatestNetworks())
				updateConnectionStatus()
				networkCards.setAttribute('aria-busy', 'false')
				if (networkCards.childElementCount === 0) networkCards.classList.add('empty')
				updateFreshness()
				return false
			}
		})()
		const tracked = run.finally(() => {
			if (liveState.networkLoadPromise === tracked) liveState.networkLoadPromise = undefined
		})
		liveState.networkLoadPromise = tracked
		return await tracked
	}

	return { syncNetworkUrl, updateNetworkLabels, reconcileNetworkOptions, loadNetworks }
}
