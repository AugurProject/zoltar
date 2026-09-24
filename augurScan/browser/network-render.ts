import type { CanonicalRecovery, NetworkRecord } from './browser-types.ts'
import { canReuseNetworkStatusPresentation, indexerHeadFreshness, indexerHeadFreshnessTransitionDelay, indexerLagLabel, indexerProgressEstimate, showIndexerSyncDetails } from './live-update.ts'

export interface NetworkRenderState {
	latestNetworks: NetworkRecord[]
	progressSamples: Map<string, { indexedBlock: number; sampledAt: number; blocksPerSecond?: number }>
	headFreshnessTimer: number | undefined
	polledReorgRefreshTimer: number | undefined
}

export const createNetworkRenderState = (): NetworkRenderState => ({ latestNetworks: [], progressSamples: new Map(), headFreshnessTimer: undefined, polledReorgRefreshTimer: undefined })

export interface NetworkRendererDeps {
	readonly state: NetworkRenderState
	readonly networkCards: HTMLElement
	readonly selectedChainId: () => string
	readonly invalidateAddressIdentityCache: (chainId: string, missesOnly?: boolean) => void
	readonly getActiveReorgRecovery: () => CanonicalRecovery | undefined
	readonly refreshCanonicalViews: (title: string, detail: string) => Promise<boolean>
	readonly getClockOffset: () => number
	readonly getAwaitingResumedStatus: () => boolean
	readonly getLastRequestFailed: () => boolean
	readonly updateConnectionStatus: () => void
	readonly updateFreshness: () => void
	readonly setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly isDemo: boolean
	readonly time: (value: string | number | Date | null | undefined) => string
	readonly exactTimestamp: (value: string | number | Date | null | undefined) => string
	readonly age: (value: string | number | Date | null | undefined) => string
	readonly until: (value: string | number | Date | null | undefined) => string
}

export const createNetworkRenderer = (deps: NetworkRendererDeps) => {
	const { state, networkCards, selectedChainId, invalidateAddressIdentityCache, getActiveReorgRecovery, refreshCanonicalViews, getClockOffset, getAwaitingResumedStatus, getLastRequestFailed, updateConnectionStatus, updateFreshness, setLiveRecord, element, number, isDemo, time, exactTimestamp, age, until } = deps
	const headFreshnessState = (stale: boolean) => (stale ? 'stale' : 'current')

	const networkBadgeLabel = (phase: string, stale: boolean) => {
		if (getAwaitingResumedStatus()) return getLastRequestFailed() ? 'status unavailable' : 'refreshing'
		return stale ? 'stale head' : phase
	}

	const progressCompletionLabel = (progress: { percentage: string | undefined; eta: string }) => (progress.percentage === undefined ? progress.eta : `${progress.percentage}% complete · ${progress.eta}`)

	const renderNetworks = (networks: NetworkRecord[]) => {
		const previouslySelectedNetwork = state.latestNetworks.find(network => String(network.chain_id) === selectedChainId())
		let selectedReorgAdvanced = false
		for (const network of networks) {
			const previous = state.latestNetworks.find(item => String(item.chain_id) === String(network.chain_id))
			const reorgAdvanced = previous && network.last_reorg_at && previous.last_reorg_at !== network.last_reorg_at
			if (reorgAdvanced) {
				invalidateAddressIdentityCache(network.chain_id)
				if (String(network.chain_id) === selectedChainId()) selectedReorgAdvanced = true
			} else if (previous && previous.indexed_hash !== network.indexed_hash) invalidateAddressIdentityCache(network.chain_id, true)
		}
		state.latestNetworks = networks
		const selectedNetwork = networks.find(item => String(item.chain_id) === selectedChainId())
		const currentTime = Date.now() + getClockOffset()
		const selectedHeadFreshness = selectedNetwork === undefined ? undefined : indexerHeadFreshness(selectedNetwork, currentTime)
		const renderedNetworkCard = networkCards.querySelector<HTMLElement>('.network-card[data-live-key]')
		const recovery = getActiveReorgRecovery()
		if (selectedReorgAdvanced && recovery !== undefined) recovery.pendingRefresh = true
		else if (selectedReorgAdvanced && state.polledReorgRefreshTimer === undefined) {
			const chainId = selectedChainId()
			state.polledReorgRefreshTimer = window.setTimeout(() => {
				state.polledReorgRefreshTimer = undefined
				if (selectedChainId() === chainId && getActiveReorgRecovery() === undefined) void refreshCanonicalViews('Canonical history reset detected', 'Address identities and views are refreshing from the latest data.')
			}, 0)
		}
		if (
			!getAwaitingResumedStatus() &&
			previouslySelectedNetwork !== undefined &&
			selectedNetwork !== undefined &&
			selectedHeadFreshness !== undefined &&
			canReuseNetworkStatusPresentation(previouslySelectedNetwork, selectedNetwork, renderedNetworkCard?.dataset.liveKey, renderedNetworkCard?.dataset.headFreshness, String(selectedNetwork.chain_id), selectedHeadFreshness.stale ? 'stale' : 'current')
		) {
			networkCards.setAttribute('aria-busy', 'false')
			updateConnectionStatus()
			return
		}
		networkCards.classList.remove('empty')
		networkCards.replaceChildren()
		for (const network of selectedNetwork === undefined ? [] : [selectedNetwork]) {
			const headFreshness = indexerHeadFreshness(network, currentTime)
			const progress = indexerProgressEstimate(network, state.progressSamples.get(String(network.chain_id)), currentTime)
			if (progress.sample !== undefined) state.progressSamples.set(String(network.chain_id), progress.sample)
			const card = setLiveRecord(element('article', 'network-card'), String(network.chain_id), {
				indexedBlock: network.indexed_block,
				indexedHash: network.indexed_hash,
				indexedTimestamp: network.indexed_timestamp,
				observedBlock: network.observed_block,
				phase: network.phase,
				failures: network.consecutive_failures,
			})
			card.dataset.phase = network.phase
			card.dataset.headFreshness = getAwaitingResumedStatus() ? 'refreshing' : headFreshnessState(headFreshness.stale)
			const title = element('div', 'network-title')
			const badge = element('span', 'badge', networkBadgeLabel(network.phase, headFreshness.stale))
			title.append(badge)
			const block = element(network.indexed_block ? 'a' : 'p', 'block-number', network.indexed_block ? `#${number(network.indexed_block)}` : 'Awaiting first block')
			if (block instanceof HTMLAnchorElement) {
				block.href = `/block/${network.indexed_block}?chainId=${network.chain_id}${isDemo ? '&demo=1' : ''}`
				block.title = `Open indexed block ${network.indexed_block}`
			}
			const meta = element('div', 'block-meta')
			const indexedTime = element('time', '', network.indexed_timestamp ? time(network.indexed_timestamp) : 'No timestamp')
			if (network.indexed_timestamp) indexedTime.dateTime = exactTimestamp(network.indexed_timestamp)
			indexedTime.title = exactTimestamp(network.indexed_timestamp)
			const ageNode = element('span', 'age', age(network.indexed_timestamp))
			ageNode.dataset.time = network.indexed_timestamp ?? ''
			ageNode.title = exactTimestamp(network.indexed_timestamp)
			const lag = indexerLagLabel(network)
			const displaySyncDetails = showIndexerSyncDetails(network, currentTime)
			meta.append(indexedTime, ageNode)
			if (displaySyncDetails) meta.append(element('span', '', lag))
			const progressLabel = headFreshness.stale ? `${progress.percentage ?? '100.00'}% indexed · RPC head ${age(network.indexed_timestamp).replace(/ ago$/, '')} old (limit 1m)` : progressCompletionLabel(progress)
			title.prepend(block)
			card.append(title, meta)
			if (displaySyncDetails && !getAwaitingResumedStatus()) card.append(element('p', 'network-progress', progressLabel))
			if (Number(network.consecutive_failures) > 0) {
				const retry = network.next_retry_at ? `next retry ${until(network.next_retry_at)}` : 'retry scheduled'
				card.append(element('p', 'network-retry', `${number(network.consecutive_failures)} consecutive failures · ${retry}`))
			}
			if (network.last_error) card.append(element('p', 'network-error', network.last_error))
			networkCards.append(card)
		}
		if (state.headFreshnessTimer !== undefined) clearTimeout(state.headFreshnessTimer)
		state.headFreshnessTimer = undefined
		if (selectedNetwork !== undefined) {
			const transitionDelay = indexerHeadFreshnessTransitionDelay(selectedNetwork, currentTime)
			if (transitionDelay !== undefined) {
				state.headFreshnessTimer = window.setTimeout(
					() => {
						state.headFreshnessTimer = undefined
						renderNetworks(state.latestNetworks)
						updateFreshness()
					},
					Math.min(transitionDelay, 2_147_483_647),
				)
			}
		}
		networkCards.setAttribute('aria-busy', String(getAwaitingResumedStatus() && !getLastRequestFailed()))
		updateConnectionStatus()
	}

	return renderNetworks
}
